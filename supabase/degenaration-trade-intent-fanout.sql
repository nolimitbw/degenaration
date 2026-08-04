-- Write a durable trade intent BEFORE capital is committed.
--
-- WHY THIS IS THE MOST URGENT STEP
--
-- app_user_withdrawable_state derives locked capital from app_private.trade_intents. Nothing
-- has ever written that table, so lockedLamports is STRUCTURALLY always zero -- including at
-- the moment the worker has reserved a user's SOL against their daily cap and is about to
-- submit a buy. A user can therefore withdraw capital that is already spoken for, and no
-- surface reports it. Step 2 of docs/ai/ACCOUNTING_MODEL.md.
--
-- WHERE THE INTENT IS CREATED
--
-- Inside worker_claim_call_execution, in the same transaction that reserves the daily cap.
-- That is the exact instant capital stops being free, so any other placement leaves a window
-- where the reservation exists and the lock does not. The queue row in call_executions is
-- untouched in shape and meaning; the intent is written alongside it and linked by intent_id.
--
-- WHY reserved_lamports IS A COLUMN AND NOT A STATE LIST
--
-- The obvious implementation locks capital for intents whose `state` is in an in-flight list.
-- That is fragile in the one direction that loses money: adding a state to the enum later and
-- forgetting to add it to the list silently unlocks capital that is still committed. Here
-- release is an explicit write of reserved_lamports = 0, so an unrecognised state stays
-- locked. Over-locking is recoverable; under-locking is not.
--
-- Forward safety: every column added is nullable or defaulted, the CHECK is widened rather
-- than narrowed, and the claim RPC is replaced with a superset of its previous behaviour.
-- Existing call_executions rows keep working with intent_id NULL.
-- Rollback: restore the previous worker_claim/submit/settle bodies, drop the added columns
-- and the helper. No execution history is rewritten.

-- ---------------------------------------------------------------------------------------
-- 1. The intent record
-- ---------------------------------------------------------------------------------------

alter table app_private.trade_intents
  add column if not exists reserved_lamports bigint not null default 0,
  add column if not exists max_allowed_lamports bigint,
  add column if not exists wallet_address text,
  add column if not exists source_group_id uuid,
  add column if not exists strategy_id uuid,
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists subscriber_config_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists released_at timestamptz;

alter table app_private.trade_intents
  drop constraint if exists trade_intents_reserved_nonnegative;
alter table app_private.trade_intents
  add constraint trade_intents_reserved_nonnegative check (reserved_lamports >= 0);

-- The required lifecycle. The pre-existing states are retained rather than replaced: the
-- deployed worker RPCs and app_user_withdrawable_state both reference them, and a migration
-- that narrows a CHECK under live code is how you turn a schema change into an outage.
alter table app_private.trade_intents
  drop constraint if exists trade_intents_state_check;
alter table app_private.trade_intents
  add constraint trade_intents_state_check check (state = any (array[
    -- required lifecycle
    'created', 'validated', 'capital_reserved', 'quoted', 'simulated',
    'submitted', 'confirmed', 'reconciled',
    -- required terminal
    'rejected', 'failed', 'expired', 'cancelled', 'reversed',
    -- retained from the original constraint
    'validating', 'ready', 'claimed', 'submitting', 'quarantined'
  ]));

-- Locked capital is read per owner on every withdrawal availability check.
create index if not exists trade_intents_owner_reserved_idx
  on app_private.trade_intents (owner_privy_user_id)
  where reserved_lamports > 0;

create index if not exists trade_intents_correlation_idx
  on app_private.trade_intents (correlation_id);

-- ---------------------------------------------------------------------------------------
-- 2. Terminal-state release
-- ---------------------------------------------------------------------------------------

-- Capital is released exactly once, by trigger, the moment the intent reaches a state where
-- the lamports are either spent or provably not spent. Doing it in a trigger rather than in
-- each caller means a settle path that forgets to release cannot exist.
--
-- 'confirmed' and 'reconciled' release because the SOL has LEFT the wallet -- the on-chain
-- balance already reflects it, so continuing to subtract it would double-count and wrongly
-- refuse a legitimate withdrawal. The failure states release because the SOL never left.
create or replace function app_private.release_intent_capital()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state in ('confirmed', 'reconciled', 'rejected', 'failed',
                   'expired', 'cancelled', 'reversed', 'quarantined')
     and new.reserved_lamports > 0 then
    new.reserved_lamports := 0;
    new.released_at := now();
    if new.terminal_at is null
       and new.state not in ('confirmed', 'reconciled') then
      new.terminal_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trade_intents_release_capital on app_private.trade_intents;
create trigger trade_intents_release_capital
before insert or update of state on app_private.trade_intents
for each row execute function app_private.release_intent_capital();

revoke execute on function app_private.release_intent_capital() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Idempotent creation
-- ---------------------------------------------------------------------------------------

-- Returns the EXISTING intent when the idempotency key repeats, so a retried signal or a
-- second worker instance reuses one intent instead of reserving the same capital twice.
create or replace function app_private.open_trade_intent(
  p_owner_privy_user_id text,
  p_idempotency_key text,
  p_mint text,
  p_side text,
  p_intent_kind text,
  p_execution_mode text,
  p_requested_lamports bigint,
  p_max_allowed_lamports bigint,
  p_wallet_address text,
  p_source_group_id uuid,
  p_strategy_id uuid,
  p_config_snapshot jsonb
)
returns app_private.trade_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent app_private.trade_intents%rowtype;
begin
  perform app_private.ensure_app_user(p_owner_privy_user_id);

  insert into app_private.trade_intents (
    owner_privy_user_id, idempotency_key, mint, side, intent_kind, execution_mode,
    requested_input_base_units, reserved_lamports, max_allowed_lamports,
    wallet_address, source_group_id, strategy_id, subscriber_config_snapshot, state
  ) values (
    p_owner_privy_user_id, p_idempotency_key, p_mint, p_side, p_intent_kind, p_execution_mode,
    p_requested_lamports,
    -- A buy commits SOL from the wallet. A sell commits the TOKEN, not SOL, so it must not
    -- reduce withdrawable SOL -- reserving here would freeze funds no trade will spend.
    case when p_side = 'buy' then p_requested_lamports else 0 end,
    p_max_allowed_lamports, p_wallet_address, p_source_group_id, p_strategy_id,
    coalesce(p_config_snapshot, '{}'::jsonb),
    'capital_reserved'
  )
  on conflict (idempotency_key) do nothing
  returning * into v_intent;

  if not found then
    select * into v_intent
    from app_private.trade_intents
    where idempotency_key = p_idempotency_key;
  end if;

  return v_intent;
end;
$$;

revoke execute on function app_private.open_trade_intent(
  text, text, text, text, text, text, bigint, bigint, text, uuid, uuid, jsonb
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Link the queue row to the intent
-- ---------------------------------------------------------------------------------------

alter table app_private.call_executions
  add column if not exists intent_id uuid references app_private.trade_intents(id);
alter table app_private.copy_executions
  add column if not exists intent_id uuid references app_private.trade_intents(id);

create index if not exists call_executions_intent_idx
  on app_private.call_executions (intent_id) where intent_id is not null;
create index if not exists copy_executions_intent_idx
  on app_private.copy_executions (intent_id) where intent_id is not null;

-- ---------------------------------------------------------------------------------------
-- 5. Advance the intent alongside the queue row
-- ---------------------------------------------------------------------------------------

-- These wrap the existing worker transitions rather than replacing them. The queue keeps its
-- own status vocabulary ('claimed' / 'submitted' / 'confirmed' / 'failed'); the intent keeps
-- the accounting lifecycle. Mapping happens in one place so the two cannot drift.
create or replace function app_private.advance_intent_for_execution(
  p_intent_id uuid,
  p_queue_status text,
  p_tx_signature text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if p_intent_id is null then
    return;
  end if;

  -- The queue's status vocabulary is exactly this, fixed by call_executions_status_check and
  -- copy_executions_status_check: claimed, submitted, succeeded, failed, skipped. Mapping any
  -- other value would be dead code pretending to be a safety net, so unknown values fall
  -- through and leave the intent alone -- which keeps its capital reserved, the safe default.
  --
  -- 'succeeded' maps to 'confirmed', not 'reconciled'. The queue marks success when the
  -- transaction landed; reconciliation against the on-chain record is a separate step that
  -- nothing performs yet, and claiming it here would assert a check that never happened.
  v_state := case p_queue_status
    when 'submitted' then 'submitted'
    when 'succeeded' then 'confirmed'
    when 'failed'    then 'failed'
    when 'skipped'   then 'rejected'
    else null
  end;

  if v_state is null then
    return;
  end if;

  -- Never regress. A late-arriving failure callback must not move a confirmed intent back,
  -- because 'confirmed' means lamports left the wallet and that fact does not un-happen.
  update app_private.trade_intents
  set state = v_state,
      claimed_at = coalesce(claimed_at, case when v_state = 'submitted' then now() end)
  where id = p_intent_id
    and state not in ('confirmed', 'reconciled', 'reversed')
    and (p_tx_signature is null or true);
end;
$$;

revoke execute on function app_private.advance_intent_for_execution(uuid, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 6. Bind the intent to the queue row by trigger, not by editing each caller
-- ---------------------------------------------------------------------------------------

-- worker_claim_call_execution is ~150 lines of cap arithmetic with eight early-return paths.
-- Reproducing it here to add two statements would mean maintaining two copies of the most
-- safety-critical function in the system, and the copies WOULD drift. A trigger on the queue
-- row instead covers every insert path that exists or will exist, including any future RPC
-- or a manual operator insert.
--
-- The status test is what makes this correct: the claim function inserts 'skipped' rows for
-- every refusal (cap reached, wallet unavailable, limits invalid) WITHOUT reserving anything,
-- and those must not create a reservation. Only 'claimed' reserved capital.
create or replace function app_private.attach_call_execution_intent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_call public.calls%rowtype;
  v_intent app_private.trade_intents%rowtype;
  v_lamports bigint;
begin
  if new.status is distinct from 'claimed' or new.intent_id is not null then
    return new;
  end if;

  select * into v_sub from public.subscriptions where id = new.subscription_id;
  if not found or nullif(v_sub.privy_user_id, '') is null then
    return new;
  end if;
  select * into v_call from public.calls where id = new.call_id;

  -- amount_sol is double precision in this legacy table. Converting to integer lamports at
  -- this boundary is the whole point: nothing downstream of the intent touches a float.
  v_lamports := floor(greatest(coalesce(new.amount_sol, 0), 0)::numeric * 1000000000)::bigint;
  if v_lamports <= 0 then
    return new;
  end if;

  v_intent := app_private.open_trade_intent(
    v_sub.privy_user_id,
    -- One intent per signal per subscriber. A retry or a second worker instance collides
    -- here and reuses the existing intent instead of reserving the same capital twice.
    'call:' || new.call_id::text || ':' || new.subscription_id::text,
    coalesce(v_call.mint, 'unknown'),
    'buy',
    'entry',
    'solana-mainnet',
    v_lamports,
    floor(greatest(coalesce(v_sub.daily_cap_sol, 0), 0)::numeric * 1000000000)::bigint,
    v_sub.user_pubkey,
    v_sub.group_id,
    null,
    coalesce(v_sub.extended_config, '{}'::jsonb)
  );

  new.intent_id := v_intent.id;
  return new;
end;
$$;

drop trigger if exists call_executions_attach_intent on app_private.call_executions;
create trigger call_executions_attach_intent
before insert on app_private.call_executions
for each row execute function app_private.attach_call_execution_intent();

create or replace function app_private.sync_execution_intent_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.intent_id is not null and new.status is distinct from old.status then
    perform app_private.advance_intent_for_execution(new.intent_id, new.status, new.tx_signature);
  end if;
  return new;
end;
$$;

drop trigger if exists call_executions_sync_intent on app_private.call_executions;
create trigger call_executions_sync_intent
after update of status on app_private.call_executions
for each row execute function app_private.sync_execution_intent_state();

drop trigger if exists copy_executions_sync_intent on app_private.copy_executions;
create trigger copy_executions_sync_intent
after update of status on app_private.copy_executions
for each row execute function app_private.sync_execution_intent_state();

revoke execute on function app_private.attach_call_execution_intent() from public, anon, authenticated;
revoke execute on function app_private.sync_execution_intent_state() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 7. The intent records the transaction that fulfilled it
-- ---------------------------------------------------------------------------------------
--
-- Spec 5.3 lists a signature among the fields a durable intent must carry, and it was the one
-- missing. Without it the intent can only reach its transaction by joining back through the
-- queue row -- so a queue row that is archived, or a copy execution that carries the signature
-- on a different table, leaves the intent unable to name what spent the capital it reserved.
--
-- Written by the same trigger that advances state, so it arrives at the moment of submission
-- and cannot drift from it. Immutable once set: a signature is evidence that lamports moved,
-- and overwriting it would destroy the only link between reserved capital and the transaction
-- that consumed it.

alter table app_private.trade_intents
  add column if not exists tx_signature text;

create unique index if not exists trade_intents_signature_unique
  on app_private.trade_intents (tx_signature) where tx_signature is not null;

create or replace function app_private.advance_intent_for_execution(
  p_intent_id uuid,
  p_queue_status text,
  p_tx_signature text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if p_intent_id is null then
    return;
  end if;

  v_state := case p_queue_status
    when 'submitted' then 'submitted'
    when 'succeeded' then 'confirmed'
    when 'failed'    then 'failed'
    when 'skipped'   then 'rejected'
    else null
  end;

  if v_state is null then
    return;
  end if;

  update app_private.trade_intents
  set state = v_state,
      -- coalesce, never overwrite: the first signature recorded is the one that moved lamports.
      tx_signature = coalesce(tx_signature, nullif(trim(coalesce(p_tx_signature, '')), '')),
      claimed_at = coalesce(claimed_at, case when v_state = 'submitted' then now() end)
  where id = p_intent_id
    and state not in ('confirmed', 'reconciled', 'reversed');
end;
$$;

revoke execute on function app_private.advance_intent_for_execution(uuid, text, text)
  from public, anon, authenticated;
