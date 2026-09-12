-- Rollback of degenaration-stop-breach-state.sql
--
-- Drops the one new function and the one new column. No existing function was replaced, so
-- there is nothing to reapply.
--
-- WHAT ROLLING THIS BACK MEANS. `stopLoss.delaySeconds` returns to persisted-but-unenforced:
-- the stop fires on the first tick past the threshold, so a single noisy print liquidates a
-- position that would have recovered. Note that server/engine/store.js SELECTS
-- stop_breached_at — PostgREST answers an unknown column with 400 — so the worker must be
-- rolled back to a build that predates it, or it will fail on every position load.
--
-- Dropping the column discards any breach clock currently armed. The effect is that an
-- in-flight breach restarts on the next tick, which is the safe direction.
--
-- Rerun-safe: every statement is `if exists`.

drop function if exists public.worker_record_stop_breach(uuid, boolean);

alter table public.positions
  drop column if exists stop_breached_at;
