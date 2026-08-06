-- Rollback of degenaration-worker-liveness.sql
--
-- One new read-only function, so the rollback is one drop. Nothing else is touched: the
-- migration adds no table, column, index, constraint or grant, and writes no row.

drop function if exists public.app_worker_liveness(text);

-- WHAT ROLLING THIS BACK MEANS. The RUN readiness check loses its only answer to "is a worker
-- alive". It fails CLOSED — lib/bot-readiness.js treats an unreadable liveness answer as
-- undefined, and undefined is not true — so no bot can be activated until this is reapplied.
-- That is the correct direction: activating on a fact we cannot establish is exactly what the
-- check exists to prevent.
--
-- app_private.worker_leases and public.worker_heartbeat are NOT touched. The worker keeps
-- heartbeating into a table the app can no longer read, which is recoverable; dropping the
-- writer as well would lose the liveness history the Admin Console reads through
-- admin_product_overview.
