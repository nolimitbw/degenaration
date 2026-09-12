# Codex review

Updated: 2026-08-02

Codex has not reviewed this work — its usage limit was reached before `0d40b15`. The table
below is Claude's own adversarial review of the handoff state, recorded so Codex can
challenge it rather than repeat it. No finding is closed by source inspection alone; each
carries a reproduction.

## Findings

| ID | Severity | Area | Finding | Reproduction | Status |
| --- | --- | --- | --- | --- | --- |
| C-1 | BLOCKER | Migration | `copy_subscriptions.size_sol` is `double precision` in production; `legacy_subscriber_config` declared `numeric`. `float8 → numeric` is an assignment cast, so the trigger's call is unresolvable and every write to the table raises, aborting the backfill part-applied. | Apply the pre-fix migration to a production-shaped fixture: `function app_private.legacy_subscriber_config(text, text, double precision, …) does not exist` | FIXED `0d40b15` |
| C-2 | BLOCKER | Authorization | `service_role` holds no `USAGE` on `app_private`. A trigger function without definer rights runs as the invoker, and its nested `app_private` calls are permission-checked, so every worker and bridge write fails. | Invoker-rights control in `verify:subscriber-config` fails with `permission denied` | FIXED `0d40b15` |
| C-3 | BLOCKER | Arithmetic | `::integer` ran before its clamp. `size_sol = 0` with a cap above 2.147 overflows int4 through the 1e-9 divisor floor; a large `tp1` does the same through the bps conversion. | Fixture row with `size_sol = 0, daily_cap_sol = 3, tp1 = 1000000` | FIXED `0d40b15` |
| C-4 | HIGH | Validation | `subscriber_config_valid` returned NULL for an absent key. `not NULL` is not true, so the guard did not fire and an unvalidated configuration was versioned silently. | Update `extended_config` to a builder payload with `safetyFilters` removed | FIXED `0d40b15` |
| C-5 | HIGH | Authorization | `subscriber_config_snapshot` was directly writable. `public.subscriptions` carries a table-level UPDATE grant to `authenticated`, which cannot be narrowed per column. Defence in depth today: the RLS policy is `auth.uid() = user_id` and the one live row has `user_id` null. | Write a forged snapshot as `service_role`; it is recomputed and discarded | FIXED `0d40b15` |
| C-6 | HIGH | Worker safety | `server/engine/store.js` preferred `subscriber_config_snapshot` on truthiness. The column is `NOT NULL DEFAULT '{}'` and `{}` is truthy, so an empty default shadowed a real `extended_config` and ran a configured bot with no filters. | `server/test/run.js`: "an empty snapshot column does not shadow the row's real filters" | FIXED `0d40b15` |
| C-7 | HIGH | Coverage | The marketplace fixture left `profile_sync_grace_started_at` nullable and NULL where production has `NOT NULL DEFAULT now()`. The listing rule is `coalesce(failed_at, grace_started_at) >= now() - '7 days'`, and `coalesce(null, null) >= …` is NULL, so the seven-day grace window was unreachable in every run. Both live sources take that branch. | Grace and expired-grace sources in `verify:marketplace-migration` | FIXED `10942cf` |
| C-8 | BLOCKER | Bot safety | `enforce_bot_lifecycle()` blocked archival by querying `app_private.positions`, which nothing writes. A bot holding open funded positions archived cleanly. | Control run: `Missing expected rejection: archival must fail closed on the worker's position ledger too` | FIXED `37d5e19` |
| C-9 | HIGH | Honesty | A closed position produced "Fresh token and SOL market evidence is unavailable", blaming price providers for a product limit — no ledger links a position to its closing executions. | `GET /api/product/pnl-card?type=position&id=<closed>` | FIXED `37d5e19` |
| C-10 | ARCHITECTURE | Ledger | Two position ledgers exist and only `public.positions` is written. The product ledger the Portfolio, PnL cards, admin counts and the archive guard read is never populated. C-8 and C-9 are both symptoms. | No INSERT into `app_private.positions` or `app_private.position_lots` in `supabase/`, `server/`, `app/`, `lib/` | OPEN — owner decision, `OPEN_BLOCKERS.md` I-1 |

## What Codex should challenge first

1. **C-10 is the one that matters.** C-8 and C-9 were patched at the symptom. If the
   product ledger is meant to be authoritative, the worker must write it and the archive
   guard's `public.positions` branch becomes redundant. If `public.positions` is
   authoritative, the Portfolio read model and the lot-based PnL design need rework.
2. **C-5's residual risk.** The trigger recomputes a forged snapshot from `extended_config`,
   which `authenticated` can also write once a row exists with `user_id` set. That is a
   user editing their own bot's risk settings, so it was accepted — challenge it if the
   threat model says otherwise.
3. **Deploy order.** `server/engine/store.js` now selects three columns that only exist
   after the subscriber-config migration. Confirm the deployment sequence before the worker
   ships.
4. **Fixture parity coverage.** `verify-performance-journal.mjs` still hand-writes its
   fixture. Given three defects came from exactly that, it is the next one to convert.
