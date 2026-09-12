-- Rollback for migration 32, degenaration-withdrawal-reconciliation.sql
--
-- WHAT ROLLING BACK RESTORES: the defect. With no reconciler, a withdrawal that succeeds on
-- chain stays `submitted` forever, and `app_user_withdrawable_state` keeps counting it toward
-- pendingWithdrawalLamports — permanently subtracting that amount from the owner's spendable
-- balance. The user is shown nothing to withdraw while their money sits in their own wallet.
--
-- Prefer rolling forward. This exists because every migration in this repository has an
-- executable rollback, not because running it is advisable.
--
-- Fully additive to reverse: one function, nothing replaced, no data written by the migration
-- itself. Rows it already settled stay settled, which is correct — they were reconciled
-- against the network and that observation does not become untrue.

drop function if exists public.app_user_reconcile_withdrawal(text, text, uuid, boolean, boolean, text);
