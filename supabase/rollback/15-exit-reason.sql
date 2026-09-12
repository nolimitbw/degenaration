-- Rollback of degenaration-exit-reason.sql
--
-- `worker_settle_position_exit` is replaced at an UNCHANGED arity of 9, so there is nothing to
-- drop. The body is restored by the reapply step in supabase/rollback/plan.mjs:
--
--     degenaration-exit-plan-state.sql
--
-- WHAT ROLLING THIS BACK MEANS. The exit kind goes back to being discarded at settlement, so
-- nothing records whether a position stopped out or took profit. `stopLoss.freezeAfterStop`
-- stops being enforceable, trade history cannot say how a trade ended, and a source's record
-- cannot separate stopped-out calls from calls closed in profit.
--
-- Dropping the column discards reasons already recorded. They describe real closed positions
-- and cannot be reconstructed — the value they came from was cleared in the same statement.
-- Copy them out first if they matter.
--
-- Rerun-safe: every statement is `if exists`.

drop index if exists public.positions_stopped_out_idx;

alter table public.positions
  drop constraint if exists positions_exit_reason_check;

alter table public.positions
  drop column if exists exit_reason;
