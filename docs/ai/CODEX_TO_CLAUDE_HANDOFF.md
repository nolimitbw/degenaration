# Codex → Claude handoff

Written 2026-08-02 by Claude Code, after Codex reached its usage limit mid-task.

Nothing Codex left behind was discarded. Its uncommitted migration, verification script,
worker change and tests were preserved, verified against the real production schema,
corrected where that check found defects, and committed.

## Position

| | |
|---|---|
| Branch | `claude/continue-codex-unfinished-2026-08-02` |
| Last Codex commit | `a0c8359` — Verify bot lifecycle and activity journal |
| Claude commits since | `0d40b15`, `10942cf` |
| Suite | `npm run check` exit 0 · 174 tests |
| Production database | `uqccguunmjabjheeivhx` · read-only queries only · **unchanged** |

`CLAUDE.md` names `claude/degenaration-launch-remediation` as the remediation branch. This
session was opened on `claude/continue-codex-unfinished-2026-08-02` and stayed there rather
than switching mid-handoff. Merge or rename before release.

## What Codex had uncommitted

| Path | State | Disposition |
|---|---|---|
| `supabase/degenaration-subscriber-config-versioning.sql` | untracked, complete | Preserved, five defects fixed, committed |
| `scripts/verify-subscriber-config-migration.mjs` | untracked, passing | Preserved, fixture regenerated from production, cases added |
| `server/engine/store.js` | modified | Preserved, one defect fixed |
| `server/test/run.js` | modified | Preserved, two tests added |
| `package.json` | modified | Preserved as-is (`verify:subscriber-config` wired into `check`) |
| `docs/activity-log.md` | modified | **Left uncommitted**, per the existing policy in `docs/coordination/AI_HANDOFF.md` |

Codex's own report was accurate on both counts: `npm run verify:subscriber-config` did
pass locally, and `app_private.subscriber_config_versions` does not exist in the connected
database. Both were re-confirmed here.

## The verification was passing for the wrong reason

`npm run verify:subscriber-config` passed and the migration would still have failed on
production. The fixture was wrong, not the migration right.

Every `verify-*.mjs` script hand-wrote its PGlite fixture schema. That fixture declared
`public.copy_subscriptions.size_sol` as `numeric`. Production declares it
`double precision`. `float8 → numeric` is an **assignment** cast (`pg_cast.castcontext =
'a'`), not an implicit one, so PostgreSQL discards `legacy_subscriber_config(..., numeric,
...)` during function resolution and raises.

Reproduced, not reasoned about — applying the pre-fix migration to a production-shaped
fixture fails with:

```
function app_private.legacy_subscriber_config(text, text, double precision,
double precision, integer, numeric, integer, numeric, integer, integer,
boolean, boolean) does not exist
```

Every insert and update on `copy_subscriptions` would have raised, and the migration's own
backfill would have aborted part-applied.

Fixtures are no longer hand-written. `scripts/lib/production-schema.mjs` holds the captured
production shapes and generates the DDL; `scripts/lib/README-schema-capture.sql` is the
read-only query that re-captures them.

## Defects found and fixed

All five were found by checking against production rather than against a fixture.

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | BLOCKER | `float8 → numeric` unresolvable on the copy path | Explicit casts at every call site |
| 2 | BLOCKER | `service_role` holds **no USAGE on `app_private`**; an invoker-rights trigger function's nested `app_private` calls are permission-checked, so every worker and bridge write would fail | Five trigger functions are now `security definer`, matching `accrue_commission_for_execution` |
| 3 | BLOCKER | `::integer` cast ran before its clamp — `size_sol = 0` with a cap above 2.147 overflows int4 through the 1e-9 divisor floor, as does a large `tp1` through the bps conversion | Clamp, then cast |
| 4 | HIGH | `subscriber_config_valid` returned NULL for an absent key, and `not NULL` is not true, so an unvalidated configuration was versioned **silently** instead of refused | Every branch returns a boolean; outer `coalesce(..., false)` |
| 5 | HIGH | `subscriber_config_snapshot` was directly writable. `public.subscriptions` carries a table-level UPDATE grant to `authenticated`, which cannot be narrowed per column | Both snapshot columns are in the UPDATE trigger list, so writing one re-enters the trigger, which recomputes it and discards the supplied value |
| 6 | HIGH | `server/engine/store.js` preferred `subscriber_config_snapshot` on truthiness. The column is `NOT NULL DEFAULT '{}'` and `{}` is truthy, so an empty default shadowed a real `extended_config` and ran a configured bot with **no filters at all** | Empty object is treated as absent |

Defect 5 is defence in depth today: the RLS policy on both tables is
`auth.uid() = user_id`, and the one live subscription row has `user_id = null`, so
`authenticated` cannot reach it through PostgREST at all. It becomes reachable the moment a
row is created with `user_id` set.

## Marketplace migration (`18f4f23`)

Same defect class, three divergences:

- `approved_groups.profile_sync_grace_started_at` is `NOT NULL DEFAULT now()`; the fixture
  left it nullable and NULL. The listing rule is
  `coalesce(profile_sync_failed_at, profile_sync_grace_started_at) >= now() - interval '7 days'`,
  and `coalesce(null, null) >= …` is NULL, never true — so the seven-day integration grace
  window was **unreachable in every run**. Both live sources carry a non-null grace
  timestamp, so that is the branch production actually takes.
- `public.calls` and `public.call_channels` carry **no** foreign key to `approved_groups` in
  production. The fixture invented one, so orphaned calls could never be exercised.
- `trade_executions.retained_fee_lamports` is `GENERATED ALWAYS … STORED`, not a DEFAULT.

The migration's logic was correct in all three cases; the coverage was not. Both sides of
the grace window and an orphaned call are now asserted.

## Verification available

```
npm run check                     # exit 0 — typecheck, lint, 174 tests, all verifiers, build
npm run verify:subscriber-config  # 19 checks, incl. an invoker-rights control that MUST fail
npm run verify:marketplace-migration
npm run verify:bot-lifecycle
npm run verify:fee-ledger
npm run verify:performance-journal
```

Stop the dev server before `npm run check`: `next build` clobbers a running `next dev`'s
`.next` directory and produces a spurious failure.

`verify:subscriber-config` reproduces production's grant model — `service_role` writing
`public.subscriptions` and `public.copy_subscriptions` with `app_private` closed to it — and
carries a negative control that recreates one trigger function with invoker rights and
asserts it fails with `permission denied`. Without that control the definer result would be
unfalsifiable.

## Production observations, all read-only

| Fact | Value |
|---|---|
| `app_private.subscriber_config_versions` | does not exist |
| `public.subscriptions` | 1 row, `user_id` null, `privy_user_id` set, `extended_config` `{}` |
| `copy_subscriptions` · `kol_subscriptions` | 0 · 0 |
| `call_executions` · `copy_executions` | 0 · 0 |
| `bot_config_versions` · `trading_wallets` | 0 · 0 |
| `approved_groups` | 2, both approved, visible, healthy, avatars present |
| `has_schema_privilege('service_role','app_private','USAGE')` | **false** |
| RLS on both subscription tables | `auth.uid() = user_id`, USING and WITH CHECK |

The database holds no trading history, so applying the migration is low risk — but it stays
unapplied because only production is reachable and the prompt forbids applying an unverified
migration to it.

## Deploy ordering — read before deploying the worker

`server/engine/store.js` now selects `kill_switch`, `subscriber_config_version_id` and
`subscriber_config_snapshot`. PostgREST answers a select naming an unknown column with 400,
so **the migration must be applied before this worker build runs**. A note to that effect
sits at the call site. The worker is not deployed, so nothing is broken today.

## Next safe actions

1. Confirm a staging target, or authorize applying the two verified migrations to
   production (E-1). Both are rerun-safe and preserve every fixture row.
2. Give `verify-bot-lifecycle.mjs` and `verify-performance-journal.mjs` the same
   production-shaped fixtures. They are the two remaining hand-written ones.
3. Priority 5, durable PnL exit pricing, is the largest remaining internally solvable item.
4. Priorities 4, 8 and 9 need external access — see `docs/ai/OPEN_BLOCKERS.md`.

## Codex review checkpoint

Codex has not seen `0d40b15` or `10942cf`. When its allowance resets, the highest-value
review is those two commits against the canonical spec, written to
`docs/ai/CODEX_REVIEW.md`. Do not re-run the audit Claude already did; review the diff.
