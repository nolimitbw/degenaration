-- Rollback of degenaration-bot-entry-limits.sql
--
-- Drops the two helper functions, the added column, its constraint and its index.
-- `worker_claim_call_execution`, `attach_call_execution_intent` and
-- `attach_call_execution_config` are all replaced at UNCHANGED arities — (uuid, uuid) and () —
-- so no overload was created and none needs an explicit drop. All three bodies are restored by
-- the reapply step in supabase/rollback/plan.mjs:
--
--     automation-execution-integrity.sql            -- worker_claim_call_execution
--     degenaration-trade-intent-fanout.sql          -- attach_call_execution_intent
--     degenaration-subscriber-config-versioning.sql -- attach_call_execution_config
--
-- Restoring the third one restores a defect: with the emergency stop engaged, or on a
-- subscription that predates versioning, an insert of a `skipped` audit row RAISES instead of
-- recording why the trade was refused. Rolling back therefore returns the emergency stop to
-- erasing its own audit trail.
--
-- WHAT ROLLING THIS BACK MEANS, IN PRODUCT TERMS
--
-- Maximum open trades, maximum capital, per-token exposure, the token cooldown, first-call-only,
-- the automatic-entry switch and the emergency stop go back to being persisted, versioned,
-- reloaded — and unenforced. A bot configured for three concurrent positions will open as many
-- as its daily cap allows, and its editor will still show three. Only the daily cap survives.
--
-- That is a silent regression, not a loud one: nothing errors and no user is told. Prefer
-- rolling FORWARD unless the claim function itself is refusing trades it should allow, which
-- would show up as `skipped` call_executions rows carrying one of this migration's reasons.
--
-- Dropping `amount_lamports` discards the integer capital recorded on each queue row. Nothing
-- reads it once the predecessor bodies are restored — both fall back to converting amount_sol,
-- which is what they did before — so no history becomes unreadable. Reserved capital on
-- existing trade_intents rows is untouched.
--
-- Rerun-safe: every statement is `if exists`.

drop function if exists app_private.subscription_exposure(uuid, text);
drop function if exists app_private.subscription_entry_config(uuid);

drop trigger if exists subscriptions_apply_kill_switch_update on public.subscriptions;
drop trigger if exists subscriptions_apply_kill_switch_insert on public.subscriptions;
drop function if exists app_private.apply_config_kill_switch();

drop index if exists app_private.call_executions_subscription_status_idx;

alter table app_private.call_executions
  drop constraint if exists call_executions_amount_lamports_nonnegative;

alter table app_private.call_executions
  drop column if exists amount_lamports;
