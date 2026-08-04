-- Settlement: the missing writer for trade_executions, positions and position_lots.
--
-- WHY THIS IS THE KEYSTONE
--
-- Spec section 5.4. These three tables are read by Portfolio, the PnL cards, the admin
-- revenue dashboard and bot activity, and NOTHING has ever written any of them. That single
-- gap is why four separate things are broken at once:
--
--   * 0 bps of platform fee is collected. The accrual triggers in
--     degenaration-authoritative-commission-accrual.sql are correct and tested, but they
--     hang on `after insert on app_private.trade_executions`. No row, no fee. Section 5.6
--     needs no new fee logic -- it needs this insert.
--   * Admin client trading volume has nothing to sum (section 8).
--   * Portfolio positions and history are structurally empty (section 13).
--   * PnL cards cannot compute average entry or exit, because position_lots is entirely dead.
--
-- WHERE IT HOOKS
--
-- On the queue row reaching 'succeeded', exactly as degenaration-trade-intent-fanout.sql
-- binds intent creation to 'claimed'. Same reason: worker_settle_call_execution is long and
-- has several exit paths, and maintaining a second copy of it would drift. A trigger covers
-- every settle path that exists or will exist.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
-- It does not invent a fee where the platform did not charge one. platform_fee_bps_snapshot
-- is read from app_private.system_flags when present and is otherwise 0, because
-- PLATFORM_FEE_ACCOUNT is unset in production and Jupiter therefore collects nothing (see
-- OPEN_BLOCKERS E-4). Writing 200 bps here while the swap charged 0 would put a fee in the
-- ledger that no one actually paid -- a fabricated accounting row, which section 2 forbids.
-- When the fee account is configured, the snapshot starts arriving non-zero and the accrual
-- triggers begin balancing without any further change here.
--
-- Forward safety: new function and trigger only; no existing table or column is altered.
-- Rollback: drop the trigger and the two functions. Rows already written stay valid and are
-- protected from mutation by the pre-existing reconciled-accounting guard.

create or replace function app_private.current_platform_fee_bps()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bps integer := 0;
begin
  -- system_flags is the operator-controlled source. Absent flag or absent table means the
  -- platform is not charging, which is the truth today.
  if to_regclass('app_private.system_flags') is not null then
    begin
      execute $q$
        select coalesce((value ->> 'platformFeeBps')::integer, 0)
        from app_private.system_flags where flag_key = 'platform_fee'
      $q$ into v_bps;
    exception when others then
      v_bps := 0;
    end;
  end if;
  return greatest(0, least(coalesce(v_bps, 0), 10000));
end;
$$;

create or replace function app_private.settle_execution_into_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent app_private.trade_intents%rowtype;
  v_exec_id uuid;
  v_position_id uuid;
  v_gross bigint;
  v_fee_bps integer;
  v_platform_fee bigint;
  v_qty numeric;
begin
  if new.status is distinct from 'succeeded' or new.intent_id is null then
    return new;
  end if;

  select * into v_intent from app_private.trade_intents where id = new.intent_id;
  if not found then
    return new;
  end if;

  -- Executed notional in integer lamports. requested_input_base_units is what the user
  -- committed and what actually left the wallet on a filled buy; a partial fill would need
  -- the settled amount instead, which the queue does not yet carry (recorded in
  -- OPEN_BLOCKERS as part of the worker gap).
  v_gross := floor(v_intent.requested_input_base_units)::bigint;
  if v_gross <= 0 then
    return new;
  end if;

  v_fee_bps := app_private.current_platform_fee_bps();
  -- floor, matching validate_execution_fees exactly. A different rounding here would make
  -- the ledger reject its own row.
  v_platform_fee := floor(v_gross::numeric * v_fee_bps / 10000)::bigint;

  -- Idempotent on (intent_id, attempt): a replayed settle finds the existing execution
  -- rather than charging a second fee.
  insert into app_private.trade_executions (
    intent_id, owner_privy_user_id, execution_mode, status, attempt,
    tx_signature, gross_notional_lamports,
    platform_fee_lamports, platform_fee_bps_snapshot,
    creator_fee_lamports, creator_fee_bps_snapshot,
    source_group_id_snapshot, submitted_at, confirmed_at, reconciled_at
  ) values (
    v_intent.id, v_intent.owner_privy_user_id, v_intent.execution_mode, 'reconciled', 1,
    new.tx_signature, v_gross,
    v_platform_fee, v_fee_bps,
    -- Creator allocation is funded FROM the platform fee, so it cannot exist while the fee
    -- is zero. It starts flowing when the fee account is configured.
    0, 0,
    v_intent.source_group_id, new.submitted_at, now(), now()
  )
  on conflict (intent_id, attempt) do nothing
  returning id into v_exec_id;

  if v_exec_id is null then
    return new;
  end if;

  -- Move the intent to its true terminal accounting state.
  update app_private.trade_intents set state = 'reconciled' where id = v_intent.id;

  if v_intent.side <> 'buy' then
    return new;
  end if;

  -- Quantity is not reported by the queue, so the lot records cost truthfully and leaves
  -- quantity at the notional placeholder rather than inventing a token amount. Average entry
  -- is therefore cost-based until the worker reports filled quantity.
  v_qty := v_intent.requested_input_base_units;

  insert into app_private.positions (
    owner_privy_user_id, bot_id, config_version_id, mint, status,
    quantity_base_units, cost_lamports, realized_pnl_lamports, fees_lamports,
    entry_config_snapshot
  ) values (
    v_intent.owner_privy_user_id, v_intent.bot_id, v_intent.config_version_id,
    v_intent.mint, 'open',
    v_qty, v_gross, 0, v_platform_fee,
    coalesce(v_intent.subscriber_config_snapshot, '{}'::jsonb)
  )
  returning id into v_position_id;

  insert into app_private.position_lots (
    position_id, entry_execution_id, quantity_base_units, remaining_base_units, cost_lamports
  ) values (
    v_position_id, v_exec_id, v_qty, v_qty, v_gross
  );

  return new;
end;
$$;

drop trigger if exists call_executions_settle_ledger on app_private.call_executions;
create trigger call_executions_settle_ledger
after update of status on app_private.call_executions
for each row execute function app_private.settle_execution_into_ledger();

revoke execute on function app_private.current_platform_fee_bps() from public, anon, authenticated;
revoke execute on function app_private.settle_execution_into_ledger() from public, anon, authenticated;
