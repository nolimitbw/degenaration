-- Controller section 4: the exit plan the user configured, and the state trailing needs.
--
-- Apply after degenaration-position-bot-attribution.sql (which this supersedes for
-- worker_open_position) and degenaration-position-exit-state.sql.
-- Rollback: run supabase/rollback/05-exit-plan-state.sql, THEN reapply, in order,
-- degenaration-position-exit-state.sql, degenaration-buy-settlement.sql,
-- degenaration-copy-execution-integrity.sql, degenaration-position-bot-attribution.sql.
--
-- This header previously read "reapply those two files", and that was wrong in a way that
-- would have broken the worker during an incident. This migration widens
-- worker_open_position 15 -> 16 arguments and worker_settle_position_exit 8 -> 9, and
-- `create or replace function` at a different arity creates an OVERLOAD rather than
-- replacing. Reapplying the predecessors alone therefore leaves both arities installed and
-- every worker call then fails with "function ... is not unique". The rollback script drops
-- the widened signatures first, which is what makes the reapply single-valued.
--
-- The three columns added here are additive and nullable/defaulted, so a rolled-back
-- function simply stops writing them and every existing row stays valid. Proven end to end
-- by npm run verify:migration-rollback, including a control run that reproduces the broken
-- rollback this note replaces.
--
-- WHAT WAS MISSING
--
-- components/product/BotBuilder.tsx collects a LIST of take-profit levels, each with its
-- own trailing retracement, plus a trailing stop, a dynamic stop, a stop delay, a freeze
-- after stop, and DCA levels. All of it validates, persists and reloads.
--
-- public.positions carries tp1, tp1_sell, tp2, tp2_sell, stop_loss. Five scalars. The exit
-- monitor reads exactly those and nothing else — no grep of server/ finds `trailing`,
-- `dynamic` or `dca` outside a comment. So a user configuring a third level, or any
-- trailing behaviour, got controls that persisted and changed nothing, which the master
-- spec forbids in as many words: every visible control must affect real behaviour or be
-- disabled with a truthful reason.
--
-- Three columns close it:
--
--   entry_config    the immutable exit plan this position was opened under. Controller
--                   section 3 requires exactly this — the configuration snapshot the trade
--                   was opened with — and the worker's own ledger had nowhere to put it.
--                   Editing the bot later cannot change how an open position exits.
--   peak_price_usd  the high-water mark. Trailing is meaningless without it, and holding
--                   it only in worker memory would re-arm from a lower peak after any
--                   restart, selling later than the user asked.
--   filled_levels   which levels have been taken, for plans with more than two.
--
-- The legacy scalars are kept and still honoured when entry_config is absent, so nothing
-- has to be backfilled and a position opened by an older worker still exits correctly.

alter table public.positions
  add column if not exists entry_config jsonb not null default '{}'::jsonb,
  add column if not exists peak_price_usd numeric,
  add column if not exists filled_levels jsonb not null default '[]'::jsonb;

-- DROP THE SUPERSEDED SIGNATURES FIRST.
--
-- Both functions below gain a trailing argument. `create or replace` does not replace a
-- function whose argument list differs — it creates an OVERLOAD. Postgres then cannot
-- resolve a call that omits the new argument and fails with
--
--     function public.worker_settle_position_exit(uuid, uuid, unknown, integer, boolean,
--     boolean, integer, unknown) is not unique
--
-- which is worse than the missing column it replaces, because it breaks a worker that was
-- working. Caught by verify:exit-plan-state on the first run; dropping the old signature
-- makes the new one the only candidate.
drop function if exists public.worker_settle_position_exit(
  uuid, uuid, text, numeric, boolean, boolean, integer, text
);
drop function if exists public.worker_open_position(
  text, text, text, numeric, numeric, text, integer, numeric, integer, numeric,
  integer, integer, text, uuid, uuid
);

-- The high-water mark can only rise. Written by the monitor when a new high is seen, so a
-- concurrent or out-of-order tick can never lower the peak and loosen a trailing stop.
create or replace function public.worker_record_position_peak(
  p_id uuid,
  p_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_peak numeric;
begin
  if p_price is null or p_price <= 0 then
    return jsonb_build_object('ok', false, 'error', 'price must be positive', 'status', 400);
  end if;

  update public.positions
  set peak_price_usd = greatest(coalesce(peak_price_usd, entry_price_usd, p_price), p_price)
  where id = p_id
  returning peak_price_usd into v_peak;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'position not found', 'status', 404);
  end if;
  return jsonb_build_object('ok', true, 'peakPriceUsd', v_peak);
end;
$$;

revoke execute on function public.worker_record_position_peak(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.worker_record_position_peak(uuid, numeric) to service_role;

-- worker_open_position, with the entry plan and the peak seeded at entry.
--
-- Seeding the peak at the entry price matters: a trailing stop measured from a null peak
-- would be measured from the current price, so it could never fire on the first tick after
-- a fall. Seeded at entry, a trailing stop starts exactly where a fixed stop would and
-- only ever tightens.
create or replace function public.worker_open_position(
  p_user_pubkey text,
  p_wallet_id text,
  p_mint text,
  p_entry_price_usd numeric,
  p_amount_raw numeric,
  p_entry_sig text,
  p_slippage_bps integer default 300,
  p_tp1 numeric default null,
  p_tp1_sell integer default 0,
  p_tp2 numeric default null,
  p_tp2_sell integer default 0,
  p_stop_loss integer default null,
  p_privy_user_id text default null,
  p_group_id uuid default null,
  p_user_id uuid default null,
  p_entry_config jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.positions%rowtype;
  v_bot_profile_id uuid;
begin
  if nullif(trim(p_entry_sig), '') is null then
    return jsonb_build_object('ok', false, 'error', 'entry signature required', 'status', 400);
  end if;
  if p_amount_raw is null or p_amount_raw <= 0 then
    return jsonb_build_object('ok', false, 'error', 'amount must be positive', 'status', 400);
  end if;
  if p_entry_price_usd is null or p_entry_price_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'entry price required', 'status', 400);
  end if;

  -- Resolved from the subscription that produced this buy. Scoped to the owner as well as
  -- the source: a Discord source is shared, so group alone would attribute another user's
  -- position to this bot. Copy buys pass p_group_id = null and resolve to null.
  if p_group_id is not null then
    select s.bot_profile_id into v_bot_profile_id
    from public.subscriptions s
    where s.group_id = p_group_id
      and s.bot_profile_id is not null
      and (
        (p_privy_user_id is not null and s.privy_user_id = p_privy_user_id)
        or (p_user_id is not null and s.user_id = p_user_id)
      )
    limit 1;
  end if;

  insert into public.positions (
    user_id, privy_user_id, user_pubkey, wallet_id, group_id, mint,
    entry_price_usd, amount_raw, original_amount_raw,
    tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps, entry_sig, status,
    bot_profile_id, entry_config, peak_price_usd, filled_levels
  ) values (
    p_user_id, p_privy_user_id, p_user_pubkey, p_wallet_id, p_group_id, p_mint,
    p_entry_price_usd, p_amount_raw, p_amount_raw,
    p_tp1, coalesce(p_tp1_sell, 0), p_tp2, coalesce(p_tp2_sell, 0),
    p_stop_loss, coalesce(p_slippage_bps, 300), trim(p_entry_sig), 'open',
    v_bot_profile_id,
    case when jsonb_typeof(p_entry_config) = 'object' then p_entry_config else '{}'::jsonb end,
    p_entry_price_usd,
    '[]'::jsonb
  )
  on conflict (entry_sig) where entry_sig is not null do nothing
  returning * into v_row;

  if not found then
    -- Already captured. Idempotent by design: the caller retried, which must not open a
    -- second position for one buy.
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'position', to_jsonb(v_row));
end;
$$;

revoke execute on function public.worker_open_position(
  text, text, text, numeric, numeric, text, integer, numeric, integer, numeric,
  integer, integer, text, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.worker_open_position(
  text, text, text, numeric, numeric, text, integer, numeric, integer, numeric,
  integer, integer, text, uuid, uuid, jsonb
) to service_role;

-- Settlement, carrying the generalised fill list alongside the two legacy booleans.
--
-- Both are written because filled_tp1 and filled_tp2 remain real columns that other
-- readers use. They are derived from one set in the worker, so a third level cannot
-- silently un-mark the first two. p_filled_levels defaults to null, so a worker build that
-- predates this keeps settling correctly through the boolean columns alone.
create or replace function public.worker_settle_position_exit(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_amount_raw numeric,
  p_filled_tp1 boolean,
  p_filled_tp2 boolean,
  p_attempts integer,
  p_error text default null,
  p_filled_levels jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('open', 'closed', 'error') then
    return jsonb_build_object('ok', false, 'error', 'invalid settlement status', 'status', 400);
  end if;
  if p_amount_raw is null or p_amount_raw < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid amount', 'status', 400);
  end if;
  if p_filled_levels is not null and jsonb_typeof(p_filled_levels) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'filled levels must be an array', 'status', 400);
  end if;

  -- Matching on the claim token is what stops a stale worker settling an exit that a
  -- different instance now owns.
  update public.positions
  set status = p_status,
      amount_raw = p_amount_raw,
      filled_tp1 = coalesce(p_filled_tp1, filled_tp1),
      filled_tp2 = coalesce(p_filled_tp2, filled_tp2),
      filled_levels = coalesce(p_filled_levels, filled_levels),
      exit_attempts = coalesce(p_attempts, exit_attempts),
      last_exit_error = left(nullif(trim(coalesce(p_error, '')), ''), 300),
      closed_at = case when p_status = 'closed' then now() else closed_at end,
      pending_exit_kind = null,
      pending_exit_sig = null,
      pending_exit_amount_raw = null,
      pending_exit_claim_token = null,
      pending_exit_at = null
  where id = p_id
    and status = 'exiting'
    and pending_exit_claim_token = p_claim_token;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.worker_settle_position_exit(
  uuid, uuid, text, numeric, boolean, boolean, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function public.worker_settle_position_exit(
  uuid, uuid, text, numeric, boolean, boolean, integer, text, jsonb
) to service_role;

-- A level beyond the second must be claimable.
--
-- Both the CHECK and worker_claim_position_exit hard-listed 'SL', 'TP1', 'TP2'. The
-- builder lets a user add a third take-profit level, so that level would fire TP3, the
-- claim would be refused with "invalid exit kind", and the position would sit unable to
-- take profit with nothing surfaced to the user. Widening, not weakening: the shape is
-- still constrained, it simply admits the levels the product can produce.
alter table public.positions
  drop constraint if exists positions_pending_exit_kind_check;
alter table public.positions
  add constraint positions_pending_exit_kind_check
  check (pending_exit_kind is null or pending_exit_kind = 'SL' or pending_exit_kind ~ '^TP[1-9][0-9]?$');

create or replace function public.worker_claim_position_exit(
  p_id uuid,
  p_kind text,
  p_amount_raw numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim uuid := gen_random_uuid();
  v_row public.positions%rowtype;
begin
  if p_kind is null or not (p_kind = 'SL' or p_kind ~ '^TP[1-9][0-9]?$') then
    return jsonb_build_object('ok', false, 'error', 'invalid exit kind', 'status', 400);
  end if;

  -- `status = 'open'` is the gate. A position already 'exiting' has an unresolved
  -- signature, so this UPDATE matches no row and the caller is told to stand down. That is
  -- what makes a second worker instance — or a tick that overlaps a slow in-flight sell —
  -- lose rather than submit a duplicate.
  update public.positions
  set status = 'exiting',
      pending_exit_kind = p_kind,
      pending_exit_amount_raw = p_amount_raw,
      pending_exit_claim_token = v_claim,
      pending_exit_at = now(),
      pending_exit_sig = null
  where id = p_id
    and status = 'open'
    and pending_exit_claim_token is null
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'exit unavailable', 'status', 409);
  end if;

  return jsonb_build_object('ok', true, 'claim_token', v_claim, 'position', to_jsonb(v_row));
end;
$$;

revoke execute on function public.worker_claim_position_exit(uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.worker_claim_position_exit(uuid, text, numeric) to service_role;

-- Carry the execution's configuration snapshot to the settlement loader.
--
-- This is the link that makes the entry plan provably the one the trade was opened under
-- rather than a copy taken later. degenaration-subscriber-config-versioning.sql stamps
-- call_executions.subscriber_config_snapshot by trigger at execution time; the loader
-- previously selected only s.tp1/tp2/stop_loss from the subscription, which is the LIVE
-- configuration and would follow a later edit. Selecting the execution's own snapshot
-- means an open position keeps exiting on the terms it was opened with even if the bot is
-- edited the next minute.
--
-- Requires degenaration-subscriber-config-versioning.sql to be applied first.
create or replace function public.worker_load_submitted_executions(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
  from (
    -- BOTH branches, and the discriminator, are load-bearing. An earlier draft of this
    -- migration carried only the call branch, because it was written from the definition in
    -- degenaration-buy-settlement.sql (c6ca8d6) without noticing that
    -- degenaration-copy-execution-integrity.sql (b15e66b, same day, later) had already
    -- superseded it with this union.
    --
    -- Applying that draft would have dropped the copy branch in production, and the failure
    -- would have been silent: server/engine/store.js:173 dispatches on `execution.source`
    -- and settles a copy leg with `execution.dedupe_key`, so every submitted copy execution
    -- would simply never be returned, never settle, and hold its reserved capital forever
    -- with no error anywhere. Nothing would have raised.
    select 'call'::text as source,
           e.call_id, e.subscription_id, null::text as dedupe_key,
           e.claim_token, e.tx_signature, e.submitted_at, e.amount_sol,
           c.mint, c.group_id,
           s.privy_user_id, s.user_pubkey, s.wallet_id, s.user_id,
           s.tp1, s.tp1_sell, s.tp2, s.tp2_sell, s.stop_loss, s.slippage_bps,
           e.subscriber_config_snapshot
    from app_private.call_executions e
    join public.calls c on c.id = e.call_id
    join public.subscriptions s on s.id = e.subscription_id
    where e.status = 'submitted'

    union all

    select 'copy'::text as source,
           null::uuid as call_id, e.subscription_id, e.dedupe_key,
           e.claim_token, e.tx_signature, e.submitted_at, e.amount_sol,
           e.mint, null::uuid as group_id,
           s.privy_user_id, s.user_pubkey, s.wallet_id, s.user_id,
           s.tp1, s.tp1_sell, s.tp2, s.tp2_sell, s.stop_loss, s.slippage_bps,
           e.subscriber_config_snapshot
    from app_private.copy_executions e
    join public.copy_subscriptions s on s.id = e.subscription_id
    where e.status = 'submitted'

    order by submitted_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;

  return jsonb_build_object('ok', true, 'executions', v_rows);
end;
$$;

revoke execute on function public.worker_load_submitted_executions(integer)
  from public, anon, authenticated;
grant execute on function public.worker_load_submitted_executions(integer) to service_role;

-- The entry plan is immutable for the life of the position. Editing the bot creates a new
-- configuration version for FUTURE signals; an open position must keep exiting on the
-- terms it was opened under, which is the same guarantee protect_position_entry_config
-- gives the product ledger.
create or replace function app_private.protect_position_entry_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.entry_config is distinct from new.entry_config and old.entry_config <> '{}'::jsonb then
    raise exception 'the entry configuration of an open position is immutable'
      using errcode = '42501';
  end if;
  -- The high-water mark is monotonic wherever it is written from, not only through
  -- worker_record_position_peak.
  if new.peak_price_usd is not null and old.peak_price_usd is not null
     and new.peak_price_usd < old.peak_price_usd then
    new.peak_price_usd := old.peak_price_usd;
  end if;
  return new;
end;
$$;

drop trigger if exists positions_protect_entry_plan on public.positions;
create trigger positions_protect_entry_plan
  before update on public.positions
  for each row execute function app_private.protect_position_entry_plan();
