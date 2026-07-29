-- Fee allocation integrity: make the non-additive fee model and the balanced-ledger
-- invariant enforceable in the database, not just in application code.
-- Spec: docs/launch/FINAL_LAUNCH_SPEC.md §13.2, §13.3, §13.5, §21.
--
-- Three gaps this closes in the previous accrual rules:
--
--   1. The additive-fee loophole. validate_execution_fees() only asserted
--      platform_fee + creator_fee <= gross_notional, which permits charging the user
--      2.00% AND paying the creator 0.70% on top. §13.2 forbids that: creator
--      commissions are funded FROM the platform fee. Now creator_fee <= platform_fee.
--
--   2. No referral allocation on the execution row. §13.5 requires balanced entries for
--      the referral payable and for DegenAration retained revenue.
--
--   3. No balance invariant. Nothing guaranteed
--      creator + referral + retained === platform_fee.
--
-- Forward-safe: new columns default to 0, the widened account_type check only adds an
-- allowed value, and the invariants live in a BEFORE trigger so existing rows are never
-- retroactively invalidated.

-- 1. Referral allocation columns on the execution row.

alter table app_private.trade_executions
  add column if not exists referral_fee_lamports bigint not null default 0
    check (referral_fee_lamports >= 0);

alter table app_private.trade_executions
  add column if not exists referral_share_bps_snapshot integer not null default 0
    check (referral_share_bps_snapshot between 0 and 10000);

alter table app_private.trade_executions
  add column if not exists referrer_privy_user_id_snapshot text;

-- 2. Retained revenue is derived, so the balance identity holds by construction and
--    cannot be written incorrectly by any caller.

alter table app_private.trade_executions
  drop column if exists retained_fee_lamports;

alter table app_private.trade_executions
  add column retained_fee_lamports bigint
  generated always as (
    platform_fee_lamports - creator_fee_lamports - referral_fee_lamports
  ) stored;

-- 3. Referral is a first-class commission account.

alter table app_private.commission_ledger_entries
  drop constraint if exists commission_ledger_entries_account_type_check;

alter table app_private.commission_ledger_entries
  add constraint commission_ledger_entries_account_type_check
  check (account_type in ('creator', 'platform', 'referral'));

alter table app_private.commission_ledger_entries
  drop constraint if exists commission_ledger_entries_source_type_check;

alter table app_private.commission_ledger_entries
  add constraint commission_ledger_entries_source_type_check
  check (source_type in ('discord', 'kol', 'referral', 'payout', 'reversal', 'adjustment'));

-- A referral entry must name the account it credits, same rule the creator account has.
alter table app_private.commission_ledger_entries
  drop constraint if exists commission_ledger_entries_owner_required_check;

alter table app_private.commission_ledger_entries
  add constraint commission_ledger_entries_owner_required_check
  check (
    (account_type in ('creator', 'referral') and account_owner_privy_user_id is not null)
    or account_type = 'platform'
  );

-- 4. Replace the fee validation trigger with the full §13 invariant set.
--
-- Rounding policy matches lib/fee-model.js bpsOf() exactly: floor(amount * bps / 10000).
-- The flooring remainder is absorbed by retained revenue, which is why retained is a
-- derived column rather than an asserted one. server/test/run.js pins the JS side to
-- this same formula.

create or replace function app_private.validate_execution_fees()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_platform bigint;
  expected_creator bigint;
  expected_referral bigint;
begin
  expected_platform := floor(
    new.gross_notional_lamports::numeric * new.platform_fee_bps_snapshot / 10000
  )::bigint;
  expected_creator := floor(
    new.gross_notional_lamports::numeric * new.creator_fee_bps_snapshot / 10000
  )::bigint;
  -- Referral is a share of the COLLECTED PLATFORM FEE, not of notional (§13.3).
  expected_referral := floor(
    new.platform_fee_lamports::numeric * new.referral_share_bps_snapshot / 10000
  )::bigint;

  if new.platform_fee_lamports <> expected_platform then
    raise exception 'platform fee does not match the snapshotted rate' using errcode = '23514';
  end if;
  if new.creator_fee_lamports <> expected_creator then
    raise exception 'creator fee does not match the snapshotted rate' using errcode = '23514';
  end if;
  if new.referral_fee_lamports <> expected_referral then
    raise exception 'referral reward does not match the snapshotted rate' using errcode = '23514';
  end if;

  -- Creator commission is funded FROM the platform fee, never added on top of it.
  if new.creator_fee_lamports > new.platform_fee_lamports then
    raise exception 'creator fee cannot exceed the collected platform fee' using errcode = '23514';
  end if;

  -- Referral is funded from retained revenue, never out of the creator's share.
  if new.creator_fee_lamports + new.referral_fee_lamports > new.platform_fee_lamports then
    raise exception 'allocations exceed the collected platform fee' using errcode = '23514';
  end if;

  -- Never pay anyone out of revenue that was not charged.
  if new.platform_fee_lamports = 0
    and (new.creator_fee_lamports > 0 or new.referral_fee_lamports > 0) then
    raise exception 'cannot allocate commission when no platform fee was collected'
      using errcode = '23514';
  end if;

  if new.platform_fee_lamports > new.gross_notional_lamports then
    raise exception 'fees exceed gross notional' using errcode = '23514';
  end if;

  if new.source_group_id_snapshot is not null and new.strategy_id_snapshot is not null then
    raise exception 'execution cannot have multiple creator sources' using errcode = '23514';
  end if;

  if new.creator_fee_lamports > 0 and (
    new.creator_privy_user_id_snapshot is null
    or new.creator_privy_user_id_snapshot = new.owner_privy_user_id
    or (
      new.source_group_id_snapshot is null
      and new.strategy_id_snapshot is null
    )
  ) then
    raise exception 'creator fee requires a distinct snapshotted creator source' using errcode = '23514';
  end if;

  -- No self-referral, and no reward without an identified referrer (§13.3).
  if new.referral_fee_lamports > 0 and (
    new.referrer_privy_user_id_snapshot is null
    or new.referrer_privy_user_id_snapshot = new.owner_privy_user_id
  ) then
    raise exception 'referral reward requires a distinct snapshotted referrer' using errcode = '23514';
  end if;

  if new.status = 'reconciled' and new.execution_mode = 'solana-mainnet' and (
    new.tx_signature is null
    or new.reconciled_at is null
  ) then
    raise exception 'reconciled mainnet execution requires signature and timestamp' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trade_executions_validate_fees
  on app_private.trade_executions;

create trigger trade_executions_validate_fees
before insert or update of
  gross_notional_lamports,
  platform_fee_lamports,
  creator_fee_lamports,
  referral_fee_lamports,
  platform_fee_bps_snapshot,
  creator_fee_bps_snapshot,
  referral_share_bps_snapshot,
  creator_privy_user_id_snapshot,
  referrer_privy_user_id_snapshot,
  source_group_id_snapshot,
  strategy_id_snapshot,
  execution_mode,
  status,
  tx_signature,
  reconciled_at
on app_private.trade_executions
for each row
execute function app_private.validate_execution_fees();
