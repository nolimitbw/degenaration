-- Make the commission ledger balance, and accrue referral rewards.
-- Spec: docs/launch/FINAL_LAUNCH_SPEC.md §13.3, §13.5, §13.6.
--
-- Two defects in app_private.accrue_commission_for_execution():
--
--   1. The ledger did not balance. A reconciled execution credited the `platform`
--      account the FULL platform_fee_lamports (200 bps) and separately credited the
--      creator 70 bps, so a 200 bps fee produced 270 bps of credits. Platform revenue
--      was overstated by exactly the creator share, and §13.6's "net retained revenue"
--      could not be derived from the ledger.
--
--   2. Referral rewards were never accrued at all. §13.3 requires a referral entry
--      funded from the retained share; the columns exist (added by
--      degenaration-fee-allocation-integrity.sql) but nothing wrote to them.
--
-- Model after this migration, for one reconciled execution:
--
--   platform  + platform_fee                 (gross collected — keeps §13.6 gross visible)
--   creator   + creator_fee                  (payable)
--   referral  + referral_fee                 (payable)
--   platform  − (creator_fee + referral_fee) (allocation offset)
--   ------------------------------------------------------------
--   sum        = platform_fee                (balanced, exactly)
--   platform net = retained_fee_lamports     (matches the generated column)
--
-- Forward-safe: replaces a function and its trigger. Historical rows are untouched, so
-- executions reconciled before this migration keep their existing (unbalanced) entries
-- and must be reconciled separately if that history matters.

create or replace function app_private.accrue_commission_for_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_type text;
  v_source_id text;
  v_allocated bigint;
  v_creator_ok boolean;
  v_referral_ok boolean;
begin
  v_source_type := case
    when new.source_group_id_snapshot is not null then 'discord'
    when new.strategy_id_snapshot is not null then 'kol'
    else 'adjustment'
  end;
  v_source_id := coalesce(
    new.source_group_id_snapshot::text,
    new.strategy_id_snapshot::text,
    new.id::text
  );

  v_creator_ok := new.creator_fee_lamports > 0
    and new.creator_privy_user_id_snapshot is not null
    and new.creator_privy_user_id_snapshot <> new.owner_privy_user_id
    and v_source_type in ('discord', 'kol');

  v_referral_ok := new.referral_fee_lamports > 0
    and new.referrer_privy_user_id_snapshot is not null
    and new.referrer_privy_user_id_snapshot <> new.owner_privy_user_id;

  if new.status = 'reconciled'
    and new.execution_mode = 'solana-mainnet'
    and new.gross_notional_lamports > 0 then

    -- Gross platform fee collected.
    if new.platform_fee_lamports > 0 then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id, account_type, source_type, source_id, execution_id,
        amount_lamports, rate_bps, gross_notional_lamports, available_at,
        idempotency_key, correlation_id, metadata
      ) values (
        null, 'platform', v_source_type, v_source_id, new.id,
        new.platform_fee_lamports, new.platform_fee_bps_snapshot, new.gross_notional_lamports,
        coalesce(new.reconciled_at, now()),
        'platform-commission:execution:' || new.id::text,
        new.correlation_id,
        jsonb_build_object('executionStatus', new.status, 'entry', 'gross-fee')
      )
      on conflict (idempotency_key) do nothing;
    end if;

    -- Creator payable, funded from the fee above.
    if v_creator_ok then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id, account_type, source_type, source_id, execution_id,
        amount_lamports, rate_bps, gross_notional_lamports, available_at,
        idempotency_key, correlation_id, metadata
      ) values (
        new.creator_privy_user_id_snapshot, 'creator', v_source_type, v_source_id, new.id,
        new.creator_fee_lamports, new.creator_fee_bps_snapshot, new.gross_notional_lamports,
        coalesce(new.reconciled_at, now()),
        'creator-commission:execution:' || new.id::text,
        new.correlation_id,
        jsonb_build_object('executionStatus', new.status, 'entry', 'creator-payable')
      )
      on conflict (idempotency_key) do nothing;
    end if;

    -- Referral payable, funded from the retained share (§13.3).
    if v_referral_ok then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id, account_type, source_type, source_id, execution_id,
        amount_lamports, rate_bps, gross_notional_lamports, available_at,
        idempotency_key, correlation_id, metadata
      ) values (
        new.referrer_privy_user_id_snapshot, 'referral', 'referral', v_source_id, new.id,
        new.referral_fee_lamports, new.referral_share_bps_snapshot, new.gross_notional_lamports,
        coalesce(new.reconciled_at, now()),
        'referral-reward:execution:' || new.id::text,
        new.correlation_id,
        jsonb_build_object('executionStatus', new.status, 'entry', 'referral-payable')
      )
      on conflict (idempotency_key) do nothing;
    end if;

    -- Offset the platform account by what was allocated away, so the ledger sums to the
    -- collected fee and the platform balance equals retained revenue.
    v_allocated := (case when v_creator_ok then new.creator_fee_lamports else 0 end)
                 + (case when v_referral_ok then new.referral_fee_lamports else 0 end);

    if v_allocated > 0 then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id, account_type, source_type, source_id, execution_id,
        amount_lamports, rate_bps, gross_notional_lamports, available_at,
        idempotency_key, correlation_id, metadata
      ) values (
        null, 'platform', 'adjustment', v_source_id, new.id,
        -v_allocated, null, new.gross_notional_lamports,
        coalesce(new.reconciled_at, now()),
        'platform-allocation-offset:execution:' || new.id::text,
        new.correlation_id,
        jsonb_build_object(
          'executionStatus', new.status,
          'entry', 'allocation-offset',
          'creatorLamports', (case when v_creator_ok then new.creator_fee_lamports else 0 end),
          'referralLamports', (case when v_referral_ok then new.referral_fee_lamports else 0 end)
        )
      )
      on conflict (idempotency_key) do nothing;
    end if;

  elsif tg_op = 'UPDATE'
    and old.status = 'reconciled'
    and new.status in ('failed', 'dropped', 'expired') then

    -- Reverse every entry proportionally (§13.3 "reverse proportionally").
    if old.platform_fee_lamports > 0 then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id, account_type, source_type, source_id, execution_id,
        amount_lamports, rate_bps, gross_notional_lamports, available_at,
        idempotency_key, correlation_id, metadata
      ) values (
        null, 'platform', 'reversal', old.id::text, old.id,
        -old.platform_fee_lamports, old.platform_fee_bps_snapshot, old.gross_notional_lamports,
        now(),
        'platform-commission-reversal:execution:' || old.id::text,
        old.correlation_id,
        jsonb_build_object('reason', 'execution invalidated after reconciliation')
      )
      on conflict (idempotency_key) do nothing;
    end if;

    if old.creator_fee_lamports > 0
      and old.creator_privy_user_id_snapshot is not null
      and old.creator_privy_user_id_snapshot <> old.owner_privy_user_id
      and (old.source_group_id_snapshot is not null or old.strategy_id_snapshot is not null) then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id, account_type, source_type, source_id, execution_id,
        amount_lamports, rate_bps, gross_notional_lamports, available_at,
        idempotency_key, correlation_id, metadata
      ) values (
        old.creator_privy_user_id_snapshot, 'creator', 'reversal', old.id::text, old.id,
        -old.creator_fee_lamports, old.creator_fee_bps_snapshot, old.gross_notional_lamports,
        now(),
        'creator-commission-reversal:execution:' || old.id::text,
        old.correlation_id,
        jsonb_build_object('reason', 'execution invalidated after reconciliation')
      )
      on conflict (idempotency_key) do nothing;
    end if;

    if old.referral_fee_lamports > 0
      and old.referrer_privy_user_id_snapshot is not null
      and old.referrer_privy_user_id_snapshot <> old.owner_privy_user_id then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id, account_type, source_type, source_id, execution_id,
        amount_lamports, rate_bps, gross_notional_lamports, available_at,
        idempotency_key, correlation_id, metadata
      ) values (
        old.referrer_privy_user_id_snapshot, 'referral', 'reversal', old.id::text, old.id,
        -old.referral_fee_lamports, old.referral_share_bps_snapshot, old.gross_notional_lamports,
        now(),
        'referral-reward-reversal:execution:' || old.id::text,
        old.correlation_id,
        jsonb_build_object('reason', 'execution invalidated after reconciliation')
      )
      on conflict (idempotency_key) do nothing;
    end if;

    -- Reverse the offset so the platform account returns to zero for this execution.
    v_allocated := old.creator_fee_lamports + old.referral_fee_lamports;
    if v_allocated > 0 then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id, account_type, source_type, source_id, execution_id,
        amount_lamports, rate_bps, gross_notional_lamports, available_at,
        idempotency_key, correlation_id, metadata
      ) values (
        null, 'platform', 'reversal', old.id::text, old.id,
        v_allocated, null, old.gross_notional_lamports,
        now(),
        'platform-allocation-offset-reversal:execution:' || old.id::text,
        old.correlation_id,
        jsonb_build_object('reason', 'allocation offset reversed with the execution')
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trade_executions_commission_accrual
  on app_private.trade_executions;
create trigger trade_executions_commission_accrual
after insert or update of status on app_private.trade_executions
for each row execute function app_private.accrue_commission_for_execution();

-- Reporting view for §13.6. Derives gross, allocations, and net retained from the
-- ledger itself rather than recomputing them, so the dashboard cannot disagree with
-- the books.
create or replace view app_private.commission_revenue_summary as
select
  date_trunc('day', created_at) as day,
  sum(case when account_type = 'platform' and metadata->>'entry' = 'gross-fee' then amount_lamports else 0 end) as gross_fee_lamports,
  sum(case when account_type = 'creator' and source_type = 'discord' then amount_lamports else 0 end) as discord_creator_lamports,
  sum(case when account_type = 'creator' and source_type = 'kol' then amount_lamports else 0 end) as kol_creator_lamports,
  sum(case when account_type = 'referral' then amount_lamports else 0 end) as referral_lamports,
  sum(case when account_type = 'platform' then amount_lamports else 0 end) as platform_net_lamports,
  sum(amount_lamports) as ledger_sum_lamports
from app_private.commission_ledger_entries
group by 1;

revoke all on app_private.commission_revenue_summary from public, anon, authenticated;
