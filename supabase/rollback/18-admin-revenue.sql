-- Rollback of degenaration-admin-revenue.sql
--
-- Drops the one new read-only function. Nothing else was touched: no table, column,
-- constraint, grant or row, and the function never wrote.
--
-- WHAT ROLLING THIS BACK MEANS. The Admin Console's Revenue section stops loading and the
-- allocation invariant stops being reported. `admin_business_summary` still carries the
-- lifetime totals, so no figure is lost — only the periods, the confirmed/pending split, the
-- available-to-withdraw calculation, and the reconciliation check.
--
-- Rerun-safe: `if exists`.

drop function if exists public.admin_revenue_summary(text, text);
