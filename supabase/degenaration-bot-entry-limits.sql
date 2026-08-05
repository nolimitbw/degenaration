-- The entry limits the builder collects, enforced at the instant capital is reserved.
--
-- THE DEFECT
--
-- `BotBuilder.buildConfig()` persists maximum open trades, maximum capital, per-token
-- exposure, a duplicate-call cooldown and a first-call-only switch. Every one of them saved,
-- versioned, reloaded into the editor — and changed nothing. `worker_claim_call_execution`
-- enforced exactly one limit, the daily cap, and no other reader existed anywhere in
-- server/engine or supabase. A user who set "maximum open trades 3" had a bot that would open
-- thirty, and the editor showed them 3 every time they looked.
--
-- That is the failure this repository has now shipped three times (take-profit levels past the
-- second, trailing stops, and these five): a control that persists is indistinguishable from a
-- control that works, because the save path is correct and nothing errors.
--
-- WHY THE ENFORCEMENT IS HERE AND NOT IN THE ENGINE
--
-- Every one of these limits is a decision about a SET of executions, so a check performed in
-- the worker before calling the claim is not merely slower — it is wrong. Ten calls arriving
-- inside one tick would each read "0 open trades", each pass a maximum of 3, and each claim.
-- `worker_claim_call_execution` already takes `for update` on the subscription and is the
-- single instant at which capital stops being free (`attach_call_execution_intent` reserves it
-- on the row this function inserts). Enforcing here makes the limit atomic against a second
-- worker instance, a retry, and a burst of calls, none of which a pre-check can do.
--
-- It also means there is exactly ONE implementation. A JS pre-check plus a SQL backstop is two
-- copies of the same rule, and the two would drift — which is the other documented failure mode
-- in this codebase.
--
-- WHAT "COMMITTED" MEANS
--
-- Capital is committed from the moment a claim reserves it until the position it bought is
-- closed. So the set is: executions still in flight (`claimed`, `submitted`), plus succeeded
-- executions whose position is still open or exiting. A succeeded execution whose position has
-- closed is NOT committed — the SOL came back — and a `skipped` row never committed anything,
-- which is what makes counting refusals safe.
--
-- Counting in-flight executions alongside open positions is deliberate and is the part that
-- closes the race: a claim that has not yet opened a position is still an open trade in the
-- making, and not counting it is how a burst overshoots the maximum.
--
-- INTEGER MONEY
--
-- `call_executions.amount_sol` is `numeric` fed from a JavaScript double, and comparing caps
-- against it is the float-money arithmetic the specification forbids. `amount_lamports` is
-- added and populated from the configuration's own integer `buyAmountLamports`, so every cap
-- comparison below is integer-to-integer. Legacy rows with a NULL fall back to a conversion of
-- amount_sol, which is exact for every value the builder can produce.
--
-- Forward safety: one nullable column added, three helper functions created, two triggers
-- added, and three functions replaced at their EXISTING arities — worker_claim_call_execution
-- (uuid, uuid), attach_call_execution_intent () and attach_call_execution_config (). No overload
-- is created and no caller changes. No table is dropped, no constraint narrowed, no grant
-- changed, and no existing row rewritten.
-- Rollback: supabase/rollback/11-bot-entry-limits.sql.

-- ---------------------------------------------------------------------------------------
-- 1. Integer capital on the queue row
-- ---------------------------------------------------------------------------------------

alter table app_private.call_executions
  add column if not exists amount_lamports bigint;

alter table app_private.call_executions
  drop constraint if exists call_executions_amount_lamports_nonnegative;
alter table app_private.call_executions
  add constraint call_executions_amount_lamports_nonnegative
  check (amount_lamports is null or amount_lamports >= 0);

-- The exposure query below scans one subscription's executions and joins each to its call.
create index if not exists call_executions_subscription_status_idx
  on app_private.call_executions (subscription_id, status);

-- ---------------------------------------------------------------------------------------
-- 2. The effective configuration for one subscription
-- ---------------------------------------------------------------------------------------

-- The immutable snapshot taken when the subscription was versioned, falling back to the live
-- extended_config for a row that predates versioning.
--
-- `subscriber_config_snapshot` is NOT NULL DEFAULT '{}', and `{}` is truthy in every language
-- that reads it, so an unversioned row carries an empty object that would shadow a real
-- extended_config and run a configured bot with NO limits at all. The emptiness test is what
-- prevents that, and it is the same trap server/engine/store.js documents for safety filters.
--
-- A legacy-baseline snapshot means "this row predates the builder": it carries no limits, and
-- reading it as a limit set of all-zero would refuse every trade.
create or replace function app_private.subscription_entry_config(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_extended jsonb;
begin
  select s.subscriber_config_snapshot, s.extended_config
  into v_snapshot, v_extended
  from public.subscriptions s
  where s.id = p_subscription_id;

  if not found then
    return '{}'::jsonb;
  end if;
  if v_snapshot is not null
     and jsonb_typeof(v_snapshot) = 'object'
     and v_snapshot <> '{}'::jsonb
     and coalesce(v_snapshot->>'compatibilityMode', '') <> 'legacy-baseline' then
    return v_snapshot;
  end if;
  if v_extended is not null and jsonb_typeof(v_extended) = 'object' then
    return v_extended;
  end if;
  return '{}'::jsonb;
end;
$$;

revoke execute on function app_private.subscription_entry_config(uuid) from public, anon, authenticated;
grant execute on function app_private.subscription_entry_config(uuid) to service_role;

-- ---------------------------------------------------------------------------------------
-- 3. What this subscription currently has committed
-- ---------------------------------------------------------------------------------------

create or replace function app_private.subscription_exposure(
  p_subscription_id uuid,
  p_mint text
)
returns table (
  open_trades integer,
  committed_lamports bigint,
  mint_committed_lamports bigint,
  last_mint_entry_at timestamptz,
  mint_ever_entered boolean
)
language sql
security definer
set search_path = ''
as $$
  with rows as (
    select
      e.status,
      e.created_at,
      c.mint,
      -- Integer authority first. The fallback is only reached by rows written before this
      -- migration, and floor() matches what attach_call_execution_intent already did.
      coalesce(
        e.amount_lamports,
        floor(greatest(coalesce(e.amount_sol, 0), 0)::numeric * 1000000000)::bigint
      ) as lamports,
      (
        e.status in ('claimed', 'submitted')
        or (
          e.status = 'succeeded'
          and exists (
            select 1
            from public.positions p
            where p.entry_sig = e.tx_signature
              and p.status in ('open', 'exiting')
          )
        )
      ) as committed
    from app_private.call_executions e
    join public.calls c on c.id = e.call_id
    where e.subscription_id = p_subscription_id
  )
  select
    coalesce(count(*) filter (where committed), 0)::integer,
    coalesce(sum(lamports) filter (where committed), 0)::bigint,
    coalesce(sum(lamports) filter (where committed and mint = p_mint), 0)::bigint,
    -- Cooldown and first-call-only ask "did this bot act on this token", so a refusal
    -- (`skipped`) must not count: a call refused for cooldown cannot itself extend the
    -- cooldown, or one refusal would silence the token forever.
    max(created_at) filter (where mint = p_mint and status <> 'skipped'),
    coalesce(bool_or(mint = p_mint and status <> 'skipped'), false)
  from rows;
$$;

revoke execute on function app_private.subscription_exposure(uuid, text) from public, anon, authenticated;
grant execute on function app_private.subscription_exposure(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------
-- 4. The claim, with the builder's limits enforced
-- ---------------------------------------------------------------------------------------

create or replace function public.worker_claim_call_execution(
  p_call_id uuid,
  p_subscription_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_mint text;
  v_sub public.subscriptions%rowtype;
  v_existing app_private.call_executions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_spent numeric;
  v_day date := (now() at time zone 'utc')::date;
  v_config jsonb;
  v_size_lamports bigint;
  v_max_open integer;
  v_max_capital bigint;
  v_per_token bigint;
  v_cooldown integer;
  v_first_only boolean;
  v_exposure record;
  v_reason text;
  v_status integer;
begin
  select c.group_id, c.mint into v_group_id, v_mint
  from public.calls c
  where c.id = p_call_id and c.executed_at is null;

  if not found or v_group_id is null then
    return jsonb_build_object('ok', false, 'error', 'call unavailable', 'status', 409);
  end if;

  select * into v_sub
  from public.subscriptions s
  where s.id = p_subscription_id
    and s.group_id = v_group_id
    and s.enabled = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription unavailable', 'status', 409);
  end if;

  select * into v_existing
  from app_private.call_executions e
  where e.call_id = p_call_id and e.subscription_id = p_subscription_id;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error', 'execution already claimed',
      'status', 409,
      'execution_status', v_existing.status
    );
  end if;

  if nullif(v_sub.wallet_id, '') is null or nullif(v_sub.user_pubkey, '') is null then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', greatest(coalesce(v_sub.size_sol, 0), 0),
      'delegated wallet unavailable', now()
    );
    return jsonb_build_object('ok', false, 'error', 'delegated wallet unavailable', 'status', 422);
  end if;

  if coalesce(v_sub.size_sol, 0) <= 0 or coalesce(v_sub.daily_cap_sol, 0) <= 0 then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', greatest(coalesce(v_sub.size_sol, 0), 0),
      'invalid trade limits', now()
    );
    return jsonb_build_object('ok', false, 'error', 'invalid trade limits', 'status', 422);
  end if;

  v_config := app_private.subscription_entry_config(p_subscription_id);

  -- The size this entry commits, in integer lamports. The configuration is the authority; the
  -- conversion from size_sol is only reached by a subscription that predates the builder.
  v_size_lamports := nullif(v_config->>'buyAmountLamports', '')::bigint;
  if v_size_lamports is null or v_size_lamports <= 0 then
    v_size_lamports := floor(greatest(coalesce(v_sub.size_sol, 0), 0)::numeric * 1000000000)::bigint;
  end if;

  -- Absent means "not configured", which is not the same as zero. A zero maximum would
  -- otherwise refuse every trade on a bot whose owner never set that limit.
  v_max_open := nullif(v_config->>'maxOpenTrades', '')::integer;
  v_max_capital := nullif(v_config->>'maximumCapitalLamports', '')::bigint;
  v_per_token := nullif(v_config->>'perTokenExposureLamports', '')::bigint;
  v_cooldown := nullif(v_config->>'cooldownSeconds', '')::integer;
  v_first_only := coalesce((v_config->>'firstCallOnly')::boolean, false);

  select * into v_exposure
  from app_private.subscription_exposure(p_subscription_id, v_mint);

  -- Refusals, most decisive first. Every one writes a `skipped` row carrying the reason, so
  -- the owner's activity journal says which limit stopped the trade rather than showing a
  -- silent gap that is indistinguishable from a quiet source.
  if coalesce((v_config->>'killSwitch')::boolean, false) then
    v_reason := 'emergency stop is on'; v_status := 423;
  elsif coalesce((v_config->>'autoEntry')::boolean, true) = false then
    v_reason := 'automatic entries are off'; v_status := 423;
  elsif v_max_open is not null and v_max_open > 0 and v_exposure.open_trades >= v_max_open then
    v_reason := 'maximum open trades reached'; v_status := 429;
  elsif v_first_only and v_exposure.mint_ever_entered then
    v_reason := 'first call only: this token was already traded'; v_status := 429;
  elsif v_cooldown is not null and v_cooldown > 0
    and v_exposure.last_mint_entry_at is not null
    and v_exposure.last_mint_entry_at > now() - make_interval(secs => v_cooldown) then
    v_reason := 'token cooldown active'; v_status := 429;
  elsif v_per_token is not null and v_per_token > 0
    and v_exposure.mint_committed_lamports + v_size_lamports > v_per_token then
    v_reason := 'per-token exposure limit reached'; v_status := 429;
  elsif v_max_capital is not null and v_max_capital > 0
    and v_exposure.committed_lamports + v_size_lamports > v_max_capital then
    v_reason := 'maximum capital reached'; v_status := 429;
  end if;

  if v_reason is not null then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, amount_lamports,
      error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', v_sub.size_sol, v_size_lamports,
      v_reason, now()
    );
    return jsonb_build_object('ok', false, 'error', v_reason, 'status', v_status);
  end if;

  v_spent := case when v_sub.daily_spent_on = v_day then coalesce(v_sub.daily_spent, 0) else 0 end;
  if v_spent + v_sub.size_sol > v_sub.daily_cap_sol then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, amount_lamports,
      error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', v_sub.size_sol, v_size_lamports,
      'daily cap reached', now()
    );
    return jsonb_build_object('ok', false, 'error', 'daily cap reached', 'status', 429);
  end if;

  update public.subscriptions
  set daily_spent = v_spent + v_sub.size_sol,
      daily_spent_on = v_day
  where id = v_sub.id;

  insert into app_private.call_executions (
    call_id, subscription_id, claim_token, status, amount_sol, amount_lamports
  ) values (
    p_call_id, p_subscription_id, v_claim, 'claimed', v_sub.size_sol, v_size_lamports
  );

  return jsonb_build_object(
    'ok', true,
    'claim_token', v_claim,
    'subscription_id', v_sub.id,
    'privy_user_id', v_sub.privy_user_id,
    'user_pubkey', v_sub.user_pubkey,
    'wallet_id', v_sub.wallet_id,
    'size_sol', v_sub.size_sol,
    'size_lamports', v_size_lamports,
    'slippage_bps', greatest(1, least(coalesce(v_sub.slippage_bps, 300), 5000)),
    'daily_spent', v_spent + v_sub.size_sol,
    'daily_cap_sol', v_sub.daily_cap_sol,
    -- What the entry was allowed to use, so the worker can log the decision rather than
    -- inferring it. Diagnostics only; no execution branches on these.
    'open_trades', v_exposure.open_trades,
    'committed_lamports', v_exposure.committed_lamports
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'execution already claimed', 'status', 409);
end;
$$;

revoke execute on function public.worker_claim_call_execution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_claim_call_execution(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------
-- 5. The emergency stop reaches the column the rest of the system reads
-- ---------------------------------------------------------------------------------------

-- `public.app_user_save_bot` writes fourteen columns of public.subscriptions from the submitted
-- configuration and does NOT write `kill_switch`. So a builder switch that persists
-- `killSwitch: true` into extended_config would have changed nothing at all: the versioning
-- trigger overwrites the snapshot's `killSwitch` from the COLUMN
-- (`jsonb_build_object('killSwitch', new.kill_switch)`), and server/engine/store.js filters
-- subscribers on the COLUMN. The toggle would show the user their own value back forever —
-- exactly the class of defect this migration exists to close, reintroduced by the fix for it.
--
-- A trigger rather than a rewrite of app_user_save_bot, for the reason
-- `attach_call_execution_intent` gives for the same choice: that function is long and
-- safety-critical, a second copy of it would drift, and a trigger covers every write path that
-- exists or is added later — including an operator's direct UPDATE during an incident.
--
-- ORDERING IS LOAD-BEARING. PostgreSQL fires same-timing triggers in NAME order, and the
-- snapshot is built by `subscriptions_config_version_insert`. This trigger is named
-- `subscriptions_apply_kill_switch_*` so that "apply" sorts before "config" and the column is
-- already correct when the snapshot copies it. Renaming it can silently make the stop take one
-- extra save to appear in the snapshot.
create or replace function app_private.apply_config_kill_switch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Absent means "this caller does not manage the stop" — an older client, or an update that
  -- touches something else — and must leave the column alone rather than clearing it.
  if jsonb_typeof(new.extended_config) = 'object'
     and new.extended_config ? 'killSwitch' then
    new.kill_switch := coalesce((new.extended_config->>'killSwitch')::boolean, new.kill_switch);
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_apply_kill_switch_insert on public.subscriptions;
create trigger subscriptions_apply_kill_switch_insert
before insert on public.subscriptions
for each row execute function app_private.apply_config_kill_switch();

drop trigger if exists subscriptions_apply_kill_switch_update on public.subscriptions;
create trigger subscriptions_apply_kill_switch_update
before update of extended_config on public.subscriptions
for each row execute function app_private.apply_config_kill_switch();

revoke execute on function app_private.apply_config_kill_switch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 6. A refusal must be able to record itself
-- ---------------------------------------------------------------------------------------

-- FOUND WHILE WIRING THE LIMITS ABOVE, and a defect in its own right.
--
-- `attach_call_execution_config` raises `subscriber configuration unavailable` on ANY insert
-- into call_executions whose subscription has `kill_switch = true` (the lookup filters it out,
-- so the snapshot comes back null) or whose snapshot is still the empty default because the row
-- predates versioning.
--
-- Every refusal this function writes is a `skipped` row — an audit record, not an execution.
-- So with the emergency stop engaged, `worker_claim_call_execution` could not write the row
-- explaining why it stopped: the whole call raised instead, server/engine/calls.js caught it as
-- a generic CLAIM_ERROR, and the owner's activity journal recorded nothing at all. An emergency
-- stop that erases its own audit trail is indistinguishable, from the outside, from a broken
-- worker — which is the worst moment to be unable to tell those apart.
--
-- The guard is kept exactly where it matters and dropped where it does not: a row that will
-- execute must still carry the immutable configuration it executes under, and a `skipped` row
-- never executes anything. The snapshot is still copied when one is available, so a refusal
-- still records the configuration it was judged against whenever there is one.
create or replace function app_private.attach_call_execution_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.subscriber_config_version_id is distinct from old.subscriber_config_version_id
      or new.subscriber_config_snapshot is distinct from old.subscriber_config_snapshot then
      raise exception 'execution subscriber configuration is immutable' using errcode = '55000';
    end if;
    return new;
  end if;

  -- The kill_switch filter is deliberately gone from this lookup: it belonged to a guard about
  -- whether a trade may proceed, and that decision now lives in worker_claim_call_execution,
  -- which refuses with a reason. Leaving it here only made the refusal unrecordable.
  select s.subscriber_config_version_id, s.subscriber_config_snapshot
  into new.subscriber_config_version_id, new.subscriber_config_snapshot
  from public.subscriptions s
  where s.id = new.subscription_id;

  if new.status = 'skipped' then
    return new;
  end if;

  if new.subscriber_config_version_id is null or new.subscriber_config_snapshot = '{}'::jsonb then
    raise exception 'subscriber configuration unavailable' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function app_private.attach_call_execution_config() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 7. The intent reserves the same integer the cap was measured against
-- ---------------------------------------------------------------------------------------

-- Replaced at the same arity, changing one line: the reservation prefers `amount_lamports`.
-- Without this the cap arithmetic above and the capital actually locked would come from two
-- different numbers — the integer from the configuration, and a float conversion of size_sol —
-- and they would disagree by a lamport or two on values a double cannot represent exactly.
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

  v_lamports := coalesce(
    new.amount_lamports,
    floor(greatest(coalesce(new.amount_sol, 0), 0)::numeric * 1000000000)::bigint
  );
  if v_lamports <= 0 then
    return new;
  end if;

  v_intent := app_private.open_trade_intent(
    v_sub.privy_user_id,
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
    -- The snapshot the limits above were evaluated against, so the intent records the exact
    -- configuration that authorised it rather than whatever extended_config holds later.
    app_private.subscription_entry_config(new.subscription_id)
  );

  new.intent_id := v_intent.id;
  return new;
end;
$$;

revoke execute on function app_private.attach_call_execution_intent() from public, anon, authenticated;
