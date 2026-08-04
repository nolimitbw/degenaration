-- Rollback of degenaration-admin-client-volume-periods.sql
--
-- Nothing to drop. The migration is a single `create or replace function` for
-- public.admin_client_ledger(text, integer, text) at an unchanged arity of 3, with no table
-- DDL and no DML. It is read-only: it computes volume windows and warning counts from rows
-- other code writes.
--
-- The restore is the reapply step in supabase/rollback/plan.mjs:
--
--     degenaration-admin-client-ledger.sql
--
-- Rolling back loses only the added response fields — volume today / 7D / 30D, failed
-- executions and withdrawals, and the reconciliation-warning count. The console falls back
-- to a single lifetime volume figure. No client data changes and no other surface depends
-- on the added fields, so this is the safest rollback in the package.

do $$
begin
  if to_regprocedure('public.admin_client_ledger(text, integer, text)') is null then
    raise notice 'admin_client_ledger is absent; nothing to restore';
  end if;
end
$$;
