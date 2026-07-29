-- Accrue platform and creator commission only from authoritative reconciled
-- Solana Mainnet executions, with append-only reversals.

create or replace function app_private.validate_execution_fees()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.platform_fee_lamports::numeric + new.creator_fee_lamports >
    new.gross_notional_lamports::numeric then
    raise exception 'fees exceed gross notional' using errcode = '23514';
  end if;
  if new.platform_fee_lamports <>
    floor(new.gross_notional_lamports::numeric * new.platform_fee_bps_snapshot / 10000)::bigint then
    raise exception 'platform fee does not match the snapshotted rate' using errcode = '23514';
  end if;
  if new.creator_fee_lamports <>
    floor(new.gross_notional_lamports::numeric * new.creator_fee_bps_snapshot / 10000)::bigint then
    raise exception 'creator fee does not match the snapshotted rate' using errcode = '23514';
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
  platform_fee_bps_snapshot,
  creator_fee_bps_snapshot,
  creator_privy_user_id_snapshot,
  source_group_id_snapshot,
  strategy_id_snapshot,
  execution_mode,
  status,
  tx_signature,
  reconciled_at
on app_private.trade_executions
for each row execute function app_private.validate_execution_fees();

create or replace function app_private.protect_reconciled_execution_accounting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('failed', 'dropped', 'expired')
    and new.status is distinct from old.status then
    raise exception 'terminal execution cannot transition' using errcode = '23514';
  end if;
  if old.status = 'reconciled' then
    if new.status not in ('reconciled', 'failed', 'dropped', 'expired') then
      raise exception 'reconciled execution cannot transition backward' using errcode = '23514';
    end if;
    if new.execution_mode is distinct from old.execution_mode
      or new.gross_notional_lamports is distinct from old.gross_notional_lamports
      or new.platform_fee_lamports is distinct from old.platform_fee_lamports
      or new.creator_fee_lamports is distinct from old.creator_fee_lamports
      or new.platform_fee_bps_snapshot is distinct from old.platform_fee_bps_snapshot
      or new.creator_fee_bps_snapshot is distinct from old.creator_fee_bps_snapshot
      or new.creator_privy_user_id_snapshot is distinct from old.creator_privy_user_id_snapshot
      or new.source_group_id_snapshot is distinct from old.source_group_id_snapshot
      or new.strategy_id_snapshot is distinct from old.strategy_id_snapshot
      or new.tx_signature is distinct from old.tx_signature
      or new.reconciled_at is distinct from old.reconciled_at then
      raise exception 'reconciled execution accounting is immutable' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trade_executions_protect_reconciled_accounting
  on app_private.trade_executions;
create trigger trade_executions_protect_reconciled_accounting
before update on app_private.trade_executions
for each row execute function app_private.protect_reconciled_execution_accounting();

create or replace function app_private.accrue_commission_for_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_type text;
  v_source_id text;
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

  if new.status = 'reconciled'
    and new.execution_mode = 'solana-mainnet'
    and new.gross_notional_lamports > 0 then
    if new.platform_fee_lamports > 0 then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id,
        account_type,
        source_type,
        source_id,
        execution_id,
        amount_lamports,
        rate_bps,
        gross_notional_lamports,
        available_at,
        idempotency_key,
        correlation_id,
        metadata
      ) values (
        null,
        'platform',
        v_source_type,
        v_source_id,
        new.id,
        new.platform_fee_lamports,
        new.platform_fee_bps_snapshot,
        new.gross_notional_lamports,
        coalesce(new.reconciled_at, now()),
        'platform-commission:execution:' || new.id::text,
        new.correlation_id,
        jsonb_build_object('executionStatus', new.status)
      )
      on conflict (idempotency_key) do nothing;
    end if;

    if new.creator_fee_lamports > 0
      and new.creator_privy_user_id_snapshot is not null
      and new.creator_privy_user_id_snapshot <> new.owner_privy_user_id
      and v_source_type in ('discord', 'kol') then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id,
        account_type,
        source_type,
        source_id,
        execution_id,
        amount_lamports,
        rate_bps,
        gross_notional_lamports,
        available_at,
        idempotency_key,
        correlation_id,
        metadata
      ) values (
        new.creator_privy_user_id_snapshot,
        'creator',
        v_source_type,
        v_source_id,
        new.id,
        new.creator_fee_lamports,
        new.creator_fee_bps_snapshot,
        new.gross_notional_lamports,
        coalesce(new.reconciled_at, now()),
        'creator-commission:execution:' || new.id::text,
        new.correlation_id,
        jsonb_build_object('executionStatus', new.status)
      )
      on conflict (idempotency_key) do nothing;
    end if;
  elsif tg_op = 'UPDATE'
    and old.status = 'reconciled'
    and new.status in ('failed', 'dropped', 'expired') then
    if old.platform_fee_lamports > 0 then
      insert into app_private.commission_ledger_entries (
        account_owner_privy_user_id,
        account_type,
        source_type,
        source_id,
        execution_id,
        amount_lamports,
        rate_bps,
        gross_notional_lamports,
        available_at,
        idempotency_key,
        correlation_id,
        metadata
      ) values (
        null,
        'platform',
        'reversal',
        old.id::text,
        old.id,
        -old.platform_fee_lamports,
        old.platform_fee_bps_snapshot,
        old.gross_notional_lamports,
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
        account_owner_privy_user_id,
        account_type,
        source_type,
        source_id,
        execution_id,
        amount_lamports,
        rate_bps,
        gross_notional_lamports,
        available_at,
        idempotency_key,
        correlation_id,
        metadata
      ) values (
        old.creator_privy_user_id_snapshot,
        'creator',
        'reversal',
        old.id::text,
        old.id,
        -old.creator_fee_lamports,
        old.creator_fee_bps_snapshot,
        old.gross_notional_lamports,
        now(),
        'creator-commission-reversal:execution:' || old.id::text,
        old.correlation_id,
        jsonb_build_object('reason', 'execution invalidated after reconciliation')
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trade_executions_commission_accrual
  on app_private.trade_executions;
drop trigger if exists trade_executions_commission_accrual_insert
  on app_private.trade_executions;
drop trigger if exists trade_executions_commission_accrual_update
  on app_private.trade_executions;
create trigger trade_executions_commission_accrual_insert
after insert on app_private.trade_executions
for each row execute function app_private.accrue_commission_for_execution();
create trigger trade_executions_commission_accrual_update
after update of
  status,
  execution_mode,
  gross_notional_lamports,
  platform_fee_lamports,
  creator_fee_lamports,
  platform_fee_bps_snapshot,
  creator_fee_bps_snapshot
on app_private.trade_executions
for each row execute function app_private.accrue_commission_for_execution();

revoke execute on function app_private.validate_execution_fees()
  from public, anon, authenticated;
revoke execute on function app_private.protect_reconciled_execution_accounting()
  from public, anon, authenticated;
revoke execute on function app_private.accrue_commission_for_execution()
  from public, anon, authenticated;
