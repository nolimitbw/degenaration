-- Rollback of degenaration-withdrawal-settlement.sql
--
-- Drops the one new function and the one new index. public.app_user_settle_withdrawal is
-- replaced at an unchanged arity of 5, so it is restored by the reapply step in
-- supabase/rollback/plan.mjs:
--
--     degenaration-withdrawal-intents.sql
--
-- WHAT ROLLING THIS BACK MEANS. The migration made app_user_settle_withdrawal write
-- app_private.cash_movements in the same transaction as the state change. Rolling back
-- stops that write; it does not remove movements already written, and it does not
-- invalidate them — each one still corresponds to a real settled withdrawal with its own
-- signature. Portfolio's deposit-and-withdrawal history simply stops gaining new rows and
-- becomes structurally incomplete again, which is the condition this migration fixed.
--
-- Dropping cash_movements_signature_unique removes the constraint that made the movement
-- insert idempotent. Existing rows stay unique because they were written under it; a
-- rolled-back build no longer inserts, so nothing can duplicate them afterwards.
--
-- Rerun-safe: every statement is `if exists`.

drop function if exists public.app_user_pending_withdrawals(text, text, integer);

drop index if exists app_private.cash_movements_signature_unique;
