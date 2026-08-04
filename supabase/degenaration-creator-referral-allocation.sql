-- Resolve the creator and the referrer at settlement, so the allocation layer has something
-- to allocate.
--
-- WHY
--
-- §13.2 and §13.3 are implemented and validated: validate_execution_fees enforces the exact
-- integer relationship between platform, creator and referral, accrue_commission_for_execution
-- writes the four balanced entries, and retained_fee_lamports holds by construction. All of
-- that hangs on five columns of the execution row:
--
--   creator_privy_user_id_snapshot, creator_fee_bps_snapshot,
--   referrer_privy_user_id_snapshot, referral_share_bps_snapshot, strategy_id_snapshot
--
-- Settlement wrote a literal 0 into the fee columns, never wrote either identity, and never
-- wrote strategy_id_snapshot at all. So even with PLATFORM_FEE_ACCOUNT configured and the fee
-- arriving at 200 bps, no creator would ever be paid and no referrer would ever be credited:
-- the ledger would show 200 bps of platform revenue and nothing else, indefinitely, with no
-- error anywhere. This closes that.
--
-- WHERE THE RATES COME FROM
--
--   Discord creator   public.approved_groups.creator_fee_bps        (default 70)
--   KOL creator       app_private.kol_strategies.creator_fee_bps    (default 20)
--   Referral share    app_private.system_flags 'referral_share'     (default 1000 = 10%
--                                                                    OF THE COLLECTED FEE)
--
-- Each is read at settlement and snapshotted onto the execution, so a later rate change never
-- rewrites a historical trade (§13.3).
--
-- CLAMPS, AND WHY EACH ONE EXISTS
--
--   * A zero platform fee allocates nothing. Commission is funded FROM the fee, so paying a
--     creator out of a fee nobody paid is inventing money. It is also what happens today:
--     PLATFORM_FEE_ACCOUNT is unset, the fee is 0 bps, and every allocation is therefore 0.
--   * The creator rate is capped at the platform rate, so the creator can never be owed more
--     than was collected.
--   * The referral rate is capped at whatever share of the fee remains after the creator, so
--     the reward comes out of DegenAration's retained revenue and never out of the creator's.
--   * A creator who is also the trader is not paid (§13.3, no reward on a creator's own copy
--     activity), and a referrer who is the trader is not credited (no self-referral).
--
-- APPLY ORDER
--
-- Last of the settlement chain: after degenaration-settlement-writer.sql,
-- degenaration-execution-record-fields.sql and degenaration-exit-settlement.sql. It replaces
-- settle_execution_into_ledger with a superset of all three.
--
-- Forward safety: one new function, one function replaced. No table, column or constraint
-- changes. Rollback: restore the previous settle body; existing rows keep their snapshots.

-- ---------------------------------------------------------------------------------------
-- 1. The configured referral share
-- ---------------------------------------------------------------------------------------

create or replace function app_private.current_referral_share_bps()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bps integer := 1000;
begin
  if to_regclass('app_private.system_flags') is not null then
    begin
      execute $q$
        select coalesce((value ->> 'shareBpsOfPlatformFee')::integer, 1000)
        from app_private.system_flags where flag_key = 'referral_share'
      $q$ into v_bps;
    exception when others then
      v_bps := 1000;
    end;
  end if;
  return greatest(0, least(coalesce(v_bps, 1000), 10000));
end;
$$;

revoke execute on function app_private.current_referral_share_bps() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. Settlement, with the creator and referrer resolved
-- ---------------------------------------------------------------------------------------

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
  v_creator text;
  v_creator_bps integer := 0;
  v_creator_fee bigint := 0;
  v_referrer text;
  v_referral_bps integer := 0;
  v_referral_fee bigint := 0;
  v_referral_cap integer;
begin
  if new.status is distinct from 'succeeded' or new.intent_id is null then
    return new;
  end if;

  select * into v_intent from app_private.trade_intents where id = new.intent_id;
  if not found then
    return new;
  end if;

  if v_intent.side = 'buy' then
    v_gross := floor(v_intent.requested_input_base_units)::bigint;
    if v_gross <= 0 then
      return new;
    end if;
  else
    v_gross := coalesce(new.proceeds_lamports, 0);
  end if;

  v_fee_bps := app_private.current_platform_fee_bps();
  v_platform_fee := floor(v_gross::numeric * v_fee_bps / 10000)::bigint;

  -- ---- creator ------------------------------------------------------------------------
  -- An execution has one creator source or none; the validator rejects two.
  if v_intent.source_group_id is not null then
    select g.owner_privy_user_id, coalesce(g.creator_fee_bps, 70)
      into v_creator, v_creator_bps
      from public.approved_groups g where g.id = v_intent.source_group_id;
  elsif v_intent.strategy_id is not null then
    select s.owner_privy_user_id, coalesce(s.creator_fee_bps, 20)
      into v_creator, v_creator_bps
      from app_private.kol_strategies s where s.id = v_intent.strategy_id;
  end if;

  if v_creator is null
    or v_creator = v_intent.owner_privy_user_id
    or v_platform_fee <= 0 then
    v_creator := null;
    v_creator_bps := 0;
  else
    v_creator_bps := greatest(0, least(coalesce(v_creator_bps, 0), v_fee_bps));
  end if;
  v_creator_fee := floor(v_gross::numeric * v_creator_bps / 10000)::bigint;

  -- ---- referrer -----------------------------------------------------------------------
  if v_platform_fee > 0 then
    select a.referrer_privy_user_id into v_referrer
      from app_private.referral_attributions a
     where a.referred_privy_user_id = v_intent.owner_privy_user_id
       and a.status = 'verified'
       and a.attribution_expires_at > now()
     limit 1;
  end if;

  if v_referrer is not null and v_referrer <> v_intent.owner_privy_user_id then
    -- The most the reward can be without eating into the creator's share.
    v_referral_cap := floor((v_fee_bps - v_creator_bps)::numeric * 10000 / v_fee_bps)::integer;
    v_referral_bps := greatest(0, least(app_private.current_referral_share_bps(), v_referral_cap));
  else
    v_referrer := null;
    v_referral_bps := 0;
  end if;
  v_referral_fee := floor(v_platform_fee::numeric * v_referral_bps / 10000)::bigint;

  insert into app_private.trade_executions (
    intent_id, owner_privy_user_id, execution_mode, status, attempt,
    tx_signature, slot, gross_notional_lamports,
    executed_base_units, average_price_usd, slippage_bps, price_impact_bps,
    platform_fee_lamports, platform_fee_bps_snapshot,
    creator_fee_lamports, creator_fee_bps_snapshot, creator_privy_user_id_snapshot,
    referral_fee_lamports, referral_share_bps_snapshot, referrer_privy_user_id_snapshot,
    source_group_id_snapshot, strategy_id_snapshot,
    submitted_at, confirmed_at, reconciled_at
  ) values (
    v_intent.id, v_intent.owner_privy_user_id, v_intent.execution_mode, 'reconciled', 1,
    new.tx_signature, new.slot, v_gross,
    new.executed_base_units, new.average_price_usd, new.slippage_bps, new.price_impact_bps,
    v_platform_fee, v_fee_bps,
    v_creator_fee, v_creator_bps, v_creator,
    v_referral_fee, v_referral_bps, v_referrer,
    v_intent.source_group_id,
    case when v_intent.source_group_id is null then v_intent.strategy_id end,
    new.submitted_at, now(), now()
  )
  on conflict (intent_id, attempt) do nothing
  returning id into v_exec_id;

  if v_exec_id is null then
    return new;
  end if;

  update app_private.trade_intents set state = 'reconciled' where id = v_intent.id;

  v_qty := coalesce(new.executed_base_units, v_intent.requested_input_base_units);

  if v_intent.side = 'sell' then
    perform app_private.apply_exit_to_position(
      v_exec_id,
      v_intent.owner_privy_user_id,
      v_intent.bot_id,
      v_intent.mint,
      v_qty,
      new.proceeds_lamports
    );
    return new;
  end if;

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

revoke execute on function app_private.settle_execution_into_ledger() from public, anon, authenticated;
