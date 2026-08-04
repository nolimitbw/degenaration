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

All ten are forward-safe by construction: additive nullable columns, widened rather than
narrowed CHECKs, new tables, and functions replaced with supersets. No file rewrites an
existing row, drops a column carrying data, or narrows an existing constraint.

Rollback for every one is recorded in the file header. Rows already written by a rolled-back
migration stay valid.

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
