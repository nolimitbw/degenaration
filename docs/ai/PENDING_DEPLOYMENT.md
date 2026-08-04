# Pending deployment package

Written 2026-08-04. **Migration status re-read directly from production 2026-08-04**, not
carried forward from the previous revision of this file, which said "nothing here has been
deployed" after ten of these had in fact been applied.

## Already applied — verified in production

Each confirmed by querying `pg_proc` / `information_schema` for the object the file creates.

| File | Object confirmed present |
|---|---|
| `degenaration-settlement-writer.sql` | `settle_execution_into_ledger` |
| `degenaration-signal-fanout.sql` | `app_private.fan_out_parsed_signal` |
| `degenaration-intent-reconciliation.sql` | `worker_reconcile_stale_intents`, `admin_stuck_intents` |
| `degenaration-execution-record-fields.sql` | settlement body carries the measurement fields |
| `degenaration-exit-settlement.sql` | `apply_exit_to_position` |
| `degenaration-creator-referral-allocation.sql` | `current_referral_share_bps` |
| `degenaration-performance-snapshots.sql` | `refresh_performance_snapshot` |
| `degenaration-admin-client-ledger.sql` | `admin_client_ledger`, `admin_business_summary` |
| `degenaration-position-exit-detail.sql` | `app_user_position_exits` |
| `degenaration-admin-client-detail.sql` | `admin_client_detail` |
| `degenaration-position-bot-attribution.sql` | `positions.bot_id` |

## Still to apply, in order

Three of these were verified long ago and were never in this package. One of them is a hard
dependency of the worker, which is the reason this section exists at all.

| # | File | What it adds | Verifier |
|---|---|---|---|
| 1 | `degenaration-subscriber-config-versioning.sql` | `kill_switch`, `subscriber_config_version_id`, `subscriber_config_snapshot`, the version table and the stamping triggers | `verify:subscriber-config` |
| 2 | `degenaration-bot-lifecycle-safety.sql` | `enforce_bot_lifecycle`, `protect_position_entry_config` — archive guard and entry-snapshot immutability | `verify:bot-lifecycle` |
| 3 | `degenaration-discord-marketplace-parity.sql` | accepted/rejected/executed counts, freshness, period snapshots | `verify:marketplace-migration` |
| 4 | `degenaration-discord-call-performance.sql` | the `-50%` bucket, win rate separated from 2x rate, best/worst call, confirmed copied volume | `verify:marketplace-migration` |
| 5 | `degenaration-exit-plan-state.sql` | `entry_config`, `peak_price_usd`, `filled_levels`; a claimable third take-profit level; the execution's config snapshot reaching the position | `verify:exit-plan-state` |
| 6 | `degenaration-admin-client-volume-periods.sql` | client-table volume today/7D/30D, failed executions and withdrawals, reconciliation warnings — spec §8 | `verify:admin-client-ledger` |
| 7 | `degenaration-withdrawal-settlement.sql` | the `cash_movements` writer — the last table of the accounting model that had none — plus `app_user_pending_withdrawals` | `verify:withdrawal-settlement` |

**1 is required before the worker is ever started.** `server/engine/store.js` selects
`kill_switch`, `subscriber_config_version_id` and `subscriber_config_snapshot` from both
`copy_subscriptions` and `subscriptions`. None of those columns exists in production today.
PostgREST answers an unknown column with **400**, so the worker fails on its first subscriber
load, on every tick — the same shape as the funds incident, and for the same reason: two
individually correct halves that were never checked against each other.

`npm run check:worker-schema-contract` is now that check. It fails if the worker reads a
column that neither production nor this package provides.

**4 must follow 3.** Both replace `app_public_list_discord_marketplace` in full; 4 is a
superset, so an application build that predates it keeps working and simply does not read
the new fields.

**5 must follow 1**, because it selects `call_executions.subscriber_config_snapshot`, which
1 adds. It also **drops two superseded function signatures before recreating them**: both
`worker_open_position` and `worker_settle_position_exit` gain a trailing argument, and
`create or replace` would leave the old arity in place as an overload rather than replacing
it — after which a call omitting the new argument fails with *"function ... is not unique"*.
That is a worse failure than the one being fixed, because it breaks a worker that was
working. `verify:exit-plan-state` caught it on its first run and now covers it.

## Why the order matters

Four of the already-applied files replace `app_private.settle_execution_into_ledger()` in
sequence, each with a superset of the last. That ordering is recorded here because a
rollback-and-reapply must repeat it: applying them out of order leaves an earlier, less
complete version installed — no error, just a settlement that silently stops doing part of
its job. The verifiers apply them in that order, so a run of `npm run check` is a rehearsal.

## Edge function

`supabase/functions/app-bridge/index.ts` — the deployed copy is **v11**. The repository adds
`admin_refresh_performance`, `app_user_position_exits` and `admin_client_detail`, which makes it **v12**. Without the redeploy the new Clients-tab
refresh returns `400 unknown operation`, exactly the failure mode the funds incident was.

Deploy with `verify_jwt: false`. The default is `true`, and flipping it 401s every call.

## Application release

`release/funds-runtime-hotfix-2026-08-04` @ `78a4af0` — wallet registration and withdrawal
idempotency, extracted as runtime-only application behavior. Still awaiting the promotion
decision; unchanged since it was prepared.

**Measure it against what production runs, not against `master`.** Production is
`29291c9`; the branch is that commit plus exactly one, touching 9 files and 443 insertions.
Diffed against `master` it looks like 159 files, because `master` is 79 commits behind
production — that number describes how stale `master` is, not how large this release is.

```
git diff --stat 29291c9..78a4af0     # the real scope of the release
```

## The three parts are independently approvable

| Part | Depends on |
|---|---|
| A — application release `78a4af0` | nothing |
| B — the ten migrations | nothing |
| C — app-bridge v12 | **B**. Deployed first, its three new operations reach functions that do not exist yet |

A may go alone. B may go alone. C must not precede B.

## What each migration is safe about

All seven are forward-safe by construction: additive nullable columns, widened rather than
narrowed CHECKs, new tables, and functions replaced with supersets. No file rewrites an
existing row, drops a column carrying data, or narrows an existing constraint.

Rows already written by a rolled-back migration stay valid.

## Rollback — executable, and tested

Written 2026-08-05. Until then every rollback in this package was **prose in a file header
that had never been run**. Running them for the first time found two defects, both of the
class this project keeps hitting: two individually correct halves never checked against
each other.

**Finding 1 — the documented rollback for #5 breaks the worker.**
`degenaration-exit-plan-state.sql` widens `worker_open_position` from 15 to 16 arguments and
`worker_settle_position_exit` from 8 to 9. Its header said *"Rollback: reapply those two
files"* — but `create or replace function` at a **different arity creates an overload, not a
replacement**. Reapplying the predecessors leaves both arities installed, after which the
worker's own call fails with `function public.worker_open_position(...) is not unique`.

That is the identical defect the forward migration was already corrected for, reintroduced
in the direction you only ever run during an incident. Backing the change out would have
left the worker unable to open **or** settle any position, with no further rollback to
recover with. Reproduced by the control run in `verify:migration-rollback`.

**Finding 2 — #5 would have silently killed the copy-trade path.** Its
`worker_load_submitted_executions` was written from `degenaration-buy-settlement.sql`
(`c6ca8d6`) without noticing that `degenaration-copy-execution-integrity.sql` (`b15e66b`,
same day, later) had already superseded it with a `union all` over
`app_private.copy_executions`. Applying it as drafted would have dropped that branch in
production. `server/engine/store.js:173` dispatches on `execution.source` and settles a copy
leg with `execution.dedupe_key`, so **every submitted copy execution would have stopped
being returned, never settled, and held its reserved capital indefinitely — with nothing
raising anywhere.** Fixed in the migration; the union is now a superset carrying
`subscriber_config_snapshot` on both branches.

Rollback is now executable, one script per migration:

| # | Rollback script | Then reapply, in order |
|---|---|---|
| 1 | `supabase/rollback/01-subscriber-config-versioning.sql` | — (everything it adds is new) |
| 2 | `supabase/rollback/02-bot-lifecycle-safety.sql` | — |
| 3 | `supabase/rollback/03-discord-marketplace-parity.sql` | `degenaration-discord-public-profiles.sql` |
| 4 | `supabase/rollback/04-discord-call-performance.sql` | `degenaration-discord-marketplace-parity.sql` |
| 5 | `supabase/rollback/05-exit-plan-state.sql` | `degenaration-position-exit-state.sql`, `degenaration-buy-settlement.sql`, `degenaration-copy-execution-integrity.sql`, `degenaration-position-bot-attribution.sql` |
| 6 | `supabase/rollback/06-admin-client-volume-periods.sql` | `degenaration-admin-client-ledger.sql` |
| 7 | `supabase/rollback/07-withdrawal-settlement.sql` | `degenaration-withdrawal-intents.sql` |

**Roll back in reverse order, 7 → 1.** `supabase/rollback/plan.mjs` is the single source of
truth for both directions; this table is a rendering of it.

Two rollbacks **refuse rather than destroy**, and say why:

- #1 stops if any `subscriber_config_versions` row exists — dropping the table takes the
  configuration snapshot an open position was opened under with it.
- #5 stops if a position is parked above TP2 (the restored CHECK cannot express it) or
  carries a non-empty `entry_config` (the exit plan cannot be reconstructed from the bot,
  which may have been edited since).

Both check **before** dropping anything, so a refusal leaves the schema untouched rather
than half-reverted. Override deliberately with
`set local degenaration.force_rollback = 'on';`.

`npm run verify:migration-rollback` proves nine properties against real PostgreSQL: the
package applies in order, is rerun-safe, rolls back to a byte-identical baseline catalog
(functions **and** bodies, columns, indexes, triggers, constraints), re-applies cleanly
afterwards, leaves no duplicate arity, keeps the copy branch, **executes**
`worker_load_submitted_executions` rather than only parsing it, and — as a control — that
the previously documented prose rollback is broken.

## What deploying them does NOT do

- **It does not start trading.** No worker is running (E-3), so nothing calls the queue.
- **It does not collect a fee.** `PLATFORM_FEE_ACCOUNT` is unset (E-4), so
  `current_platform_fee_bps()` returns 0 and every allocation computes to 0.
- **It does not populate the marketplace.** `raw_signals` = 0 because no Discord bot is
  deployed (E-2). The refresh writes no snapshot for a source with no executions, so the two
  approved sources keep showing "tracking" — which stays the honest state.

What it does do is make every one of those things work the moment its blocker is lifted,
instead of surfacing a fourth missing writer with live money moving.

## Verifying after deployment

```
npm run verify:bridge-live      # every operation must answer 401, never 400
npm run check                   # the full suite, including all eight migrations
```

Then, in the console's Clients tab, **Recompute performance** must return "No reconciled
trades yet" — the truthful answer while the ledger is empty. Any other answer means something
wrote a row that nothing should have written.
