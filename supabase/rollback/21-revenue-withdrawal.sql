-- Rollback of degenaration-revenue-withdrawal.sql
--
-- REFUSES rather than destroys when a withdrawal exists. `app_private.revenue_withdrawals` is
-- the only record that company money left, and the only record of the signature it left under.
-- Dropping it takes the reconciliation evidence with it — an operator asking "was that 1.1 SOL
-- ever withdrawn, and under which signature?" would have nothing to read.
--
-- Override deliberately with:
--     set local degenaration.force_rollback = 'on';

-- The guard is written as separate statements with a dynamic count, NOT as one IF condition
-- with a subquery in it. PL/pgSQL plans an IF condition as a single SQL expression, so
-- `to_regclass(...) is not null and exists (select 1 from the_table)` resolves the table at
-- plan time and fails with "relation does not exist" on the rerun after the drop — the guard
-- would break the very rerun-safety it is part of. Found by verify:migration-rollback.
do $$
declare
  v_withdrawals bigint := 0;
begin
  if coalesce(current_setting('degenaration.force_rollback', true), '') = 'on' then
    return;
  end if;
  if to_regclass('app_private.revenue_withdrawals') is null then
    return; -- never applied, or this rollback already ran
  end if;
  execute 'select count(*) from app_private.revenue_withdrawals' into v_withdrawals;
  if v_withdrawals > 0 then
    raise exception
      'refusing to roll back: % revenue withdrawal(s) recorded. This table is the only record '
      'that company money moved and the only record of the signature it moved under; dropping '
      'it destroys the reconciliation evidence. '
      'To proceed anyway: set local degenaration.force_rollback = ''on'';', v_withdrawals
      using errcode = '55006';
  end if;
end
$$;

drop function if exists public.admin_list_revenue_withdrawals(text, text, integer);
drop function if exists public.admin_settle_revenue_withdrawal(text, text, uuid, text, text);
drop function if exists public.admin_record_revenue_withdrawal_signature(text, text, uuid, text);
drop function if exists public.admin_open_revenue_withdrawal(text, text, text, text, bigint);
drop function if exists app_private.revenue_available(text);
drop trigger if exists revenue_withdrawals_protect_terms on app_private.revenue_withdrawals;
drop function if exists app_private.protect_revenue_withdrawal_terms();
drop table if exists app_private.revenue_withdrawals;

-- WHAT ROLLING THIS BACK MEANS. `Withdraw fees` returns to disabled with a truthful reason, and
-- admin_revenue_summary keeps reporting `revenueWithdrawalLedger: 'not-implemented'` — which is
-- again accurate. No client ledger, no accrual and no payout record is touched: this migration
-- reads trade_executions and writes only its own table.
