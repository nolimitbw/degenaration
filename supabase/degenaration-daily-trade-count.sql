-- Migration 33 — a daily trade COUNT, and one trading day for both daily limits.
--
-- WHAT THIS ADDS
--
-- "Max trades daily": stop after N entries in a day and resume the next day. The owner's
-- words: "max trade daily is 10 — if the bot already traded 10 today it stops at the 11th and
-- starts again tomorrow, reset every 6am EST."
--
-- Nothing like it existed. `dailyLossLimitLamports` caps SOL SPENT; this caps how many times
-- the bot enters. A bot with a 1 SOL daily budget and a 0.02 margin could take fifty entries
-- in an hour and stay inside every existing limit.
--
-- WHY IT IS ENFORCED HERE AND NOT IN THE WORKER
--
-- Every entry limit is a question about a SET of executions. Checked in the worker before the
-- claim it is not merely slower, it is wrong: ten calls arriving in one tick each read
-- "0 trades today" and each claim. `worker_claim_call_execution` already holds `for update` on
-- the subscription and is the instant capital stops being free, so the count is atomic against
-- a burst, a retry, and a second worker instance — and there is one implementation rather than
-- a JS pre-check and a SQL backstop that would drift.
--
-- THE TRADING DAY MOVES, AND IT MOVES FOR THE EXISTING CAP TOO
--
-- The day was `(now() at time zone 'utc')::date` — a UTC-midnight boundary. It is now 6am in
-- America/New_York, which is what the owner asked for, expressed in a named zone so it follows
-- daylight saving and stays 6am for them all year rather than drifting an hour twice a year.
--
-- The existing daily SPEND cap moves onto the same boundary deliberately. Two limits both
-- labelled "daily" that reset at different hours is a defect waiting to be reported, and the
-- owner would have no way to tell which one stopped their bot.
--
-- One-off consequence, stated because it is real: on the deploy day the window shifts. A bot
-- that spent against the UTC day gets its counters re-based to the new day boundary on the
-- next claim, which can grant or withhold up to one window's budget once. It cannot exceed the
-- configured cap within any window after that.
--
-- ABSENT IS NOT ZERO
--
-- `maxTradesPerDay` missing from the configuration means the owner never set it, so no refusal
-- applies. A zero maximum would otherwise refuse every trade on every bot saved before this
-- migration. Same rule the other four limits already follow.
--
-- MUST BE APPLIED BEFORE THE APP THAT READS IT. `public.subscriptions.daily_trades` is a new
-- column and PostgREST answers an unknown column with 400 — the same shape as the funds
-- incident. `npm run check:worker-schema-contract` is what makes that impossible to forget.
--
-- Rollback: supabase/rollback/33-daily-trade-count.sql

-- ---------------------------------------------------------------------------------------
-- 1. The counter
-- ---------------------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists daily_trades integer not null default 0;

comment on column public.subscriptions.daily_trades is
  'Entries claimed inside the current trading day, which starts at 06:00 America/New_York. '
  'Reset lazily by worker_claim_call_execution when daily_spent_on rolls over, so the two '
  'daily counters share one window and cannot disagree about what "today" means.';

-- ---------------------------------------------------------------------------------------
-- 2. The claim, with the trade count enforced
-- ---------------------------------------------------------------------------------------

-- SUPERSEDES degenaration-auto-reentry.sql, and is built from ITS body rather than from
-- degenaration-bot-entry-limits.sql. Three migrations have replaced worker_claim_call_execution
-- since that one: the channel scope, the post-stop freeze, and auto re-entry. A first draft of
-- this file was written from the older body and silently reverted all three -- the channel-scope
-- property in verify:bot-entry-limits caught it. Anything that replaces this function again must
-- start from THIS body.

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
  v_call_channel text;
  v_sub public.subscriptions%rowtype;
  v_existing app_private.call_executions%rowtype;
  v_claim uuid := gen_random_uuid();
  v_spent numeric;
  -- The trading day starts at 06:00 America/New_York. Subtracting six hours from the local
  -- clock and taking the date makes "today" run 06:00 -> 06:00. The named zone is load-bearing:
  -- a fixed UTC offset would drift an hour across daylight saving and stop being 6am for the
  -- person who configured it.
  v_day date := ((now() at time zone 'America/New_York') - interval '6 hours')::date;
  v_trades integer;
  v_max_trades_per_day integer;
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
  v_limits jsonb;
  v_daily_cap_on boolean;
  v_freeze_after_stop boolean;
  v_stopped_out_at timestamptz;
  v_auto_reentry boolean;
  v_closed_position boolean := false;
begin
  select c.group_id, c.mint, c.channel_id into v_group_id, v_mint, v_call_channel
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
  --
  -- `limits` is the switch layer. Each limit keeps a number at all times — the configuration
  -- validator requires several of them to be present and numeric, so an off switch cannot be
  -- expressed by removing the value — and `limits.<name> = false` is what turns it off. Absent
  -- reads as ON, which is correct in both directions: a bot saved before the switches existed
  -- gets the limit its owner typed, and one saved before the limits were enforced at all is in
  -- exactly the state this migration is fixing.
  v_limits := case
    when jsonb_typeof(v_config->'limits') = 'object' then v_config->'limits'
    else '{}'::jsonb
  end;

  if coalesce((v_limits->>'maxOpenTrades')::boolean, true) then
    v_max_open := nullif(v_config->>'maxOpenTrades', '')::integer;
  end if;
  if coalesce((v_limits->>'maximumCapital')::boolean, true) then
    v_max_capital := nullif(v_config->>'maximumCapitalLamports', '')::bigint;
  end if;
  if coalesce((v_limits->>'perTokenExposure')::boolean, true) then
    v_per_token := nullif(v_config->>'perTokenExposureLamports', '')::bigint;
  end if;
  if coalesce((v_limits->>'cooldown')::boolean, true) then
    v_cooldown := nullif(v_config->>'cooldownSeconds', '')::integer;
  end if;
  -- Absent value means the owner never set a trade count, so nothing is refused. A zero
  -- maximum would otherwise refuse every entry on every bot saved before this migration.
  if coalesce((v_limits->>'maxTradesPerDay')::boolean, true) then
    v_max_trades_per_day := nullif(v_config->>'maxTradesPerDay', '')::integer;
  end if;
  v_daily_cap_on := coalesce((v_limits->>'dailyLoss')::boolean, true);
  v_first_only := coalesce((v_config->>'firstCallOnly')::boolean, false);
  -- Absent reads as ON: it is the builder default, and re-entering a token that just stopped
  -- you out is the looser behaviour of the two.
  v_freeze_after_stop := coalesce((v_config #>> '{stopLoss,freezeAfterStop}')::boolean, true);
  -- Absent reads as ON. See the header: silence in an older snapshot is not the owner choosing
  -- "off", it is a control that did not exist when they saved.
  v_auto_reentry := coalesce((v_config->>'autoReentry')::boolean, true);

  -- Has this wallet already finished a cycle in this token? Only a CLOSED position counts --
  -- an open one is governed by per-token exposure, not by re-entry.
  if not v_auto_reentry then
    select exists (
      select 1
      from public.positions p
      where p.user_pubkey = v_sub.user_pubkey
        and p.mint = v_mint
        and p.closed_at is not null
    ) into v_closed_position;
  end if;

  -- When did this wallet last STOP OUT of this token? Only answerable since
  -- degenaration-exit-reason.sql: settlement used to clear pending_exit_kind before anything
  -- read it, so "closed" and "stopped out" were the same row and the switch was unimplementable.
  if v_freeze_after_stop and v_cooldown is not null and v_cooldown > 0 then
    select max(p.closed_at) into v_stopped_out_at
    from public.positions p
    where p.user_pubkey = v_sub.user_pubkey
      and p.mint = v_mint
      and p.exit_reason = 'SL'
      and p.closed_at is not null;
  end if;

  select * into v_exposure
  from app_private.subscription_exposure(p_subscription_id, v_mint);

  -- Refusals, most decisive first. Every one writes a `skipped` row carrying the reason, so
  -- the owner's activity journal says which limit stopped the trade rather than showing a
  -- silent gap that is indistinguishable from a quiet source.
  if coalesce((v_config->>'killSwitch')::boolean, false) then
    v_reason := 'emergency stop is on'; v_status := 423;
  elsif coalesce((v_config->>'autoEntry')::boolean, true) = false then
    v_reason := 'automatic entries are off'; v_status := 423;
  -- The channel scope. Checked before the capital limits because it is not a limit at all: the
  -- call is simply not for this bot, and reporting it as "maximum capital reached" would send
  -- the owner to the wrong setting. NULL or empty means every approved channel of the source,
  -- which is the default and what every subscription written before the control existed holds.
  elsif nullif(trim(coalesce(v_sub.channel_id, '')), '') is not null
    and nullif(trim(coalesce(v_call_channel, '')), '') is not null
    and v_sub.channel_id <> v_call_channel then
    v_reason := 'call is from a channel this bot does not follow'; v_status := 409;
  elsif v_max_open is not null and v_max_open > 0 and v_exposure.open_trades >= v_max_open then
    v_reason := 'maximum open trades reached'; v_status := 429;
  elsif v_first_only and v_exposure.mint_ever_entered then
    v_reason := 'first call only: this token was already traded'; v_status := 429;
  elsif v_cooldown is not null and v_cooldown > 0
    and v_exposure.last_mint_entry_at is not null
    and v_exposure.last_mint_entry_at > now() - make_interval(secs => v_cooldown) then
    v_reason := 'token cooldown active'; v_status := 429;
  -- Frozen after a stop. Reported separately from the ordinary cooldown because they are
  -- different settings with different fixes: one is "you traded this recently", the other is
  -- "this token stopped you out and you asked not to re-enter it yet".
  elsif v_freeze_after_stop and v_stopped_out_at is not null
    and v_stopped_out_at > now() - make_interval(secs => v_cooldown) then
    v_reason := 'token frozen after a stop loss'; v_status := 429;
  -- Auto re-entry off. Reported with its own reason for the same purpose every other refusal
  -- here has one: the owner's activity journal has to name the control that stopped the trade,
  -- or they go looking in the cooldown for a setting that is not there.
  elsif not v_auto_reentry and v_closed_position then
    v_reason := 'auto re-entry is off: this token was already traded to close'; v_status := 429;
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

  -- Both daily counters share one window, so one rollover test governs both.
  v_spent := case when v_sub.daily_spent_on = v_day then coalesce(v_sub.daily_spent, 0) else 0 end;
  v_trades := case when v_sub.daily_spent_on = v_day then coalesce(v_sub.daily_trades, 0) else 0 end;

  -- A budget bounds how MUCH the bot spends, never how OFTEN it enters: 1 SOL at a 0.02 margin
  -- is fifty entries, every one inside the cap. Like the spend cap, the count keeps ACCRUING
  -- whether or not it is enforced, so switching the limit back on does not hand the bot a
  -- fresh day's allowance it has already used. Only the refusal is switched.
  if v_max_trades_per_day is not null and v_max_trades_per_day > 0
    and v_trades >= v_max_trades_per_day then
    insert into app_private.call_executions (
      call_id, subscription_id, claim_token, status, amount_sol, amount_lamports,
      error, finished_at
    ) values (
      p_call_id, p_subscription_id, v_claim, 'skipped', v_sub.size_sol, v_size_lamports,
      'daily trade limit reached', now()
    );
    return jsonb_build_object('ok', false, 'error', 'daily trade limit reached', 'status', 429);
  end if;
  -- The daily cap keeps ACCRUING whether or not it is enforced, so switching it back on does
  -- not hand the bot a fresh day's budget. Only the refusal is switched.
  if v_daily_cap_on and v_spent + v_sub.size_sol > v_sub.daily_cap_sol then
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
      daily_trades = v_trades + 1,
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
    'daily_trades', v_trades + 1,
    'max_trades_per_day', v_max_trades_per_day,
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
