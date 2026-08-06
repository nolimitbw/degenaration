# Pending deployment package

Written 2026-08-04. **Migration status re-read directly from production 2026-08-04**, not
carried forward from the previous revision of this file, which said "nothing here has been
deployed" after ten of these had in fact been applied.

## APPLIED 2026-08-05 — migrations 8, 9 and 10

Owner approved. Applied one at a time to `uqccguunmjabjheeivhx`, each verified before the next
was started. Nothing was skipped and nothing failed, so no rollback ran.

All three corrected defects in code that was **already live**, found by composing stages that
each had a passing verifier of their own. None raised; all were silent. None could be triggered
before an automated Discord call arrived, and all would have fired on the first one.

Verification per migration: `md5(prosrc)` byte-identical to this repository (expected digests
from `node scripts/deploy-checksums.mjs 10`); exactly one definition, so no overload; SECURITY
DEFINER with `search_path=""`; anon and authenticated denied EXECUTE; and every row count equal
to the pre-flight baseline.

| # | Result |
|---|---|
| 8 | `3d37de97…` MATCH, 1 definition, `still_has_broken_join` **false**. **Functional proof on the real production row**: `discord:1520209045544374342:1521876069693526158` now resolves to channel `1521876069693526158` and its approved group — the old join returned NULL for that exact row. Trigger `parsed_signals_fan_out` intact |
| 9 | `f0df0b78…` MATCH, 1 definition at arity 17, deferred-supersede branch present, `retractedCalls` in the response, service_role granted |
| 10 | `51a785b9…` MATCH, 1 definition at arity 4. Guard raises `insufficient_privilege` on an invalid secret, so the function is callable; the new aggregates were **executed** against real rows: `DegenAration` → measuredCurrent 1, medianCurrentX 1.0000, currentWinRate 0.00 (flat is not up); `SLPR DEGEN` → measuredCurrent 0 with all three statistics **null**, not fabricated zeros |

### Row counts, baseline → after all three

Unchanged, every one: `raw_signals` 1, `parsed_signals` 1, `signal_deliveries` 0, `calls` 1
(0 retracted), `approved_groups` 2, `call_channels` 2, `trade_intents` 0, `trade_executions` 0,
both `positions` 0, `cash_movements` 0, `commission_ledger_entries` 0, `worker_leases` 0,
`durable_jobs` 0. `mainnet_execution_enabled` remains **`false`**.

**No transaction was signed or broadcast, no worker or signer was started, and no funds moved.**

Supabase security advisors after the change: only the pre-existing INFO `rls_enabled_no_policy`
on `app_private` tables — the deliberate deny-all posture — and the pre-existing WARN about
Supabase Auth leaked-password protection, which this product does not use (identity is Privy).
**No new finding.**

### What was NOT deployed, by instruction

The two corrected legacy SQL files (`admin-dashboard-secret-rpcs.sql`,
`public-source-profiles.sql`). Production already denies `anon` and `authenticated` on those
five functions, so the correction changes nothing live; it exists so a future replay cannot
re-grant the admin API. No application code was deployed and the bridge was not redeployed —
none of the three migrations adds or changes a bridge operation, and `verify:bridge-live`
reported `deploymentDrift: NONE` beforehand.

### Original finding, kept for the record

| # | File | The defect | Verifier |
|---|---|---|---|
| 8 | `degenaration-signal-fanout-source-ref.sql` | `fan_out_parsed_signal` joined `call_channels.channel_id = raw_signals.source_ref`, and ingestion writes `source_ref` as `discord:<guild>:<channel>`. The join **can never match**. Every real call would be journaled as accepted, counted by the marketplace, and offered to **zero** subscribers — with nothing raising, because `fan_out_on_parse` is an AFTER INSERT trigger that discards the return value | `verify:discord-replay` (control run reproduces it) |
| 10 | `degenaration-discord-current-return.sql` | Every return figure the marketplace showed was a **peak** multiple and nothing said so. A source whose ten calls each touched 2x and then went to zero reported `Win rate 100% · Average return 2.00x · Reached 2x: 10`. `current_x` was computed per call and used for one thing only, max drawdown. Adds `averageCurrentX`, `medianCurrentX`, `currentWinRate` and `measuredCurrent` beside the peak family, and both surfaces now label which is which | `verify:marketplace-migration` |
| 9 | `degenaration-discord-edit-retraction.sql` | The edit branch superseded the previous call **before** the same-token cooldown could refuse the edit. When it does refuse, the previous call is left retracted with no successor, and the response says `accepted:false, status:"duplicate"` — the caller told nothing happened by a call that removed a measured call from the source's record | `verify:discord-replay` |

All three are `create or replace` at an unchanged arity, no DDL, no DML, no grant change.
**8 and 9 are independent of everything and may be applied alone. 10 supersedes 4 in full and
must follow it** — both replace `app_public_list_discord_marketplace` at arity 4, so applying
10 before 4 leaves 4's body installed with no error.

Confirmed against production before writing either fix:

```
source_ref          discord:1520209045544374342:1521876069693526158
join_on_source_ref  NULL          -- what fan-out uses
join_on_payload     1521876069693526158
```

and `pg_proc` shows the deployed `fan_out_parsed_signal` still contains
`ch.channel_id = rs.source_ref`.

**Why 8 was green for so long.** `verify:signal-fanout` built its own raw signal with
`source_ref = 'chan-1'` — a bare channel id ingestion has never once written. The fixture
agreed with the reader instead of the writer. That fixture is corrected in the same change,
and `verify:discord-replay` now drives the real listener, the real payload builder, the real
route transformation and the real RPC from a stored Discord event, so the two halves are
checked against each other rather than against a hand-written row.

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

## APPLIED 2026-08-05 — all seven, plus app-bridge v13

Owner approved parts B and C. Applied one at a time, in the order below, each verified
before the next was started. Nothing was skipped and nothing failed, so no rollback ran.

Verification per migration was: the objects it creates exist; **`md5(prosrc)` of every
function it defines is byte-identical to this repository** (generated by
`node scripts/deploy-checksums.mjs N`, compared in-database, empty result = proof); anon and
authenticated are denied EXECUTE; and every row count matches the pre-flight baseline.

| # | Migration | Result |
|---|---|---|
| 1 | subscriber-config-versioning | 9 functions, 9 triggers, 3+3+3 columns on the subscription tables and 2+2 on the execution tables, RLS on. 9/9 bodies MATCH. Backfill wrote exactly **1** `legacy-baseline` version for the 1 existing subscription |
| 2 | bot-lifecycle-safety | 2 triggers, 2 functions, 1 partial unique index. 2/2 bodies MATCH |
| 3 | discord-marketplace-parity | body MATCH, exactly 1 definition — no overload |
| 4 | discord-call-performance | body MATCH, `down_50` bucket present, `two_x_rate` split from `win_rate`, 1 definition |
| 5 | exit-plan-state | 6/6 bodies MATCH. **`worker_open_position` arities `[16]`, `worker_settle_position_exit` `[9]` — exactly one each**, the superseded signatures dropped as designed. `worker_load_submitted_executions(5)` **executed** in production returning `ok=true`, so the copy union runs rather than merely parsing. CHECK widened to `^TP[1-9][0-9]?$` |
| 6 | admin-client-volume-periods | body MATCH, all period fields present, `require_app_admin` enforced |
| 7 | withdrawal-settlement | 2/2 bodies MATCH, `cash_movements` writer live, `cash_movements_signature_unique` present |

**app-bridge v13** deployed with `verify_jwt: false`. `verify:bridge-live` reports
`deploymentDrift: NONE` across 67 declared operations, with 3 controls answering 401.
`check:bridge-contract` passes: 73 operations, every one reaching a real SQL definition with
a matching parameter list.

### Row counts, baseline → after

Every financial table was 0 before and is 0 after: `cash_movements`, `withdrawal_intents`,
`trade_executions`, `trade_intents`, both `positions`, `position_lots`,
`commission_ledger_entries`, `payout_requests`, `trades`, `call_executions`,
`copy_executions`. `subscriptions` 1 → 1, `calls` 1 → 1, `approved_groups` 2 → 2.

The **only** change is `subscriber_config_versions` 0 → 1, which is migration 1's intended
backfill of the single existing subscription.

**No user funds moved, no transaction was signed, nothing was broadcast.** `worker_leases`
= 0, `durable_jobs` = 0, `pg_cron` is not installed, and `system_flags.mainnet_execution_enabled`
remains `false`.

### Authorization, re-verified after the DDL

88 `admin_*` / `app_user_*` / `worker_*` / `app_public_*` RPCs checked. Every admin RPC is
`SECURITY DEFINER`.

**CORRECTION, 2026-08-05.** The claim previously made here — *"`search_path` pinned to the
empty string — 0 exceptions"* — was wrong. Four are pinned to `public, pg_temp`:
`admin_list_server_applications`, `admin_decide_server_application`,
`admin_decide_call_channel`, `admin_dashboard_summary`. `pg_temp` is **last**, which is the
documented mitigation, so a caller's temp object cannot shadow anything that exists in
`public`; the residual vector is an unqualified name absent from `public`. Narrow, and not
what was claimed. The four are now a frozen allowlist in `check:admin-authorization`, which
lets the list shrink and never grow.

**And a worse one in the same area.** `supabase/admin-dashboard-secret-rpcs.sql` ended with
`grant execute ... to anon, authenticated` on all five of its admin functions — including
`admin_decide_server_application` and `admin_decide_call_channel`, which approve or reject a
Discord source. Production is **not** exposed: `has_function_privilege('anon', ...)` is false
for all five, so a later migration revoked them. The exposure was in the **file**, which is a
first-class migration whose own header tells an operator to run another file after it — so a
rebuild, a new environment or a disaster restore would have re-granted the admin API to
anonymous callers while looking like an ordinary replay, guarded only by a shared secret whose
SHA-256 digest is committed on line 14 of that same file (blocker I-2). Both files are
corrected, and `check:admin-authorization` fails on a grant to `anon`, `authenticated` or
`public` anywhere in a file that defines an admin function. Proven by control run. anon and
authenticated hold EXECUTE on none of them. `app_private.admin_secret_ok` does carry a
PUBLIC EXECUTE grant, but anon and authenticated are denied USAGE on schema `app_private`,
so it is unreachable — EXECUTE without schema USAGE grants nothing.

Supabase security advisors after the DDL: only pre-existing INFO-level
`rls_enabled_no_policy` on `app_private` tables, which is the deliberate posture (RLS on with
no policy denies everything; access is only through `SECURITY DEFINER` functions). The new
`subscriber_config_versions` table correctly appears among them. **No new finding.**

## Originally still to apply, in order — kept for the record

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

**Re-read from production 2026-08-05, and this section was stale.** The deployed
`app-bridge` is **v12**, not v11: `admin_refresh_performance`, `app_user_position_exits`
and `admin_client_detail` are already live. `npm run verify:bridge-live` reports exactly
**one** remaining drift:

```
  - app_user_pending_withdrawals
```

That operation is created by migration **#7**, `degenaration-withdrawal-settlement.sql`.
So the redeploy is **v13**, and it **must follow migration 7** — deployed before it, the
operation reaches a function that does not exist yet. The controls in the same probe
(`app_user_portfolio_summary`, `app_user_affiliate_summary`, `app_user_list_bots`) answered
401 rather than 400, which is what makes the drift finding sound rather than a transport
error.

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
| B — the seven migrations | nothing |
| C — app-bridge **v13** | **migration 7 specifically**. Deployed first, `app_user_pending_withdrawals` reaches a function that does not exist yet |

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
| 8 | `supabase/rollback/08-signal-fanout-source-ref.sql` | `degenaration-signal-fanout.sql` |
| 9 | `supabase/rollback/09-discord-edit-retraction.sql` | `degenaration-discord-signal-ingestion.sql` |
| 10 | `supabase/rollback/10-discord-current-return.sql` | `degenaration-discord-call-performance.sql` |

**Roll back in reverse order, 10 → 1.** `supabase/rollback/plan.mjs` is the single source of
truth for both directions; this table is a rendering of it.

Two rollbacks **refuse rather than destroy**, and say why:

- #1 stops if any `subscriber_config_versions` row exists — dropping the table takes the
  configuration snapshot an open position was opened under with it.
- #5 stops if a position is parked above TP2 (the restored CHECK cannot express it) or
  carries a non-empty `entry_config` (the exit plan cannot be reconstructed from the bot,
  which may have been edited since).

Two rollbacks **restore a defect**, and say so in their header: rolling back #8 restores a
silent total failure of subscriber fan-out, and rolling back #9 restores an edit path that
retracts a call while reporting that nothing happened. For both, prefer rolling forward.

Both refusing rollbacks check **before** dropping anything, so a refusal leaves the schema
untouched rather than half-reverted. Override deliberately with
`set local degenaration.force_rollback = 'on';`.

`npm run verify:migration-rollback` proves nine properties against real PostgreSQL across all
ten migrations: the package applies in order, is rerun-safe, rolls back to a byte-identical baseline catalog
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

## APPLIED 2026-08-05 — migrations 11 and 12, bot-bridge v4, app `a173ed8`

Owner approved the package. Applied in the required order, each verified before the next was
started. Nothing was skipped and nothing failed, so no rollback ran.

| Step | Target | Result |
|---|---|---|
| 1 | migration 11 `degenaration-bot-entry-limits.sql` | 6/6 function bodies `md5(prosrc)` **MATCH** this repository. `amount_lamports` added, index added, 2 triggers created, exactly **1** `worker_claim_call_execution` signature — no overload. anon denied, service_role granted |
| 2 | migration 12 `degenaration-registered-channel-authorization.sql` | 4/4 bodies **MATCH**. `bot_ingest_discord_signal_v2` arities `[18]` — the 17-arg signature is gone, not overloaded. `discord_ingestion_refusals` created with RLS on. `admin_decide_call_channel` now pins `search_path=""` |
| 3 | edge function `bot-bridge` v3 → **v4** | `verify_jwt: false` preserved. Probed with a deliberately invalid secret: **401**, not 400 — so the 18-parameter list resolves against the deployed function rather than failing to find it |
| 4 | Vercel production | `9303fe2` → **`a173ed8`**, confirmed by `/api/build` |
| 5 | Railway `degenaration-bot` | see below |

### Trigger order, which is load-bearing

`degenaration-bot-entry-limits.sql` relies on PostgreSQL firing same-timing triggers in NAME
order, so that the emergency stop reaches the column before the snapshot copies it. Verified in
production rather than assumed:

```
subscriptions_apply_kill_switch_insert -> subscriptions_apply_kill_switch_update
  -> subscriptions_config_version_insert -> subscriptions_config_version_update
```

### Functional proof on the real production rows

`app_private.authorized_call_channel` **executed** against both registered channels, not parsed:

| channel | guild | verdict with its own guild | verdict with a foreign guild |
|---|---|---|---|
| `1521876069693526158` | `1520209045544374342` | ACCEPTED — DegenAration | `channel registered to a different guild` |
| `1495930481018142801` | `1495795490657275914` | ACCEPTED — SLPR DEGEN | `channel registered to a different guild` |

So no live source lost ingestion, and the pair check bites on real data.

### Row counts, baseline → after

Unchanged, every one: `call_executions` 0, `trade_intents` 0, `positions` 0, `subscriptions` 1,
`calls` 1, `raw_signals` 3, `approved_groups` 2, `call_channels` 2,
`commission_ledger_entries` 0, `cash_movements` 0, `worker_leases` 0, `durable_jobs` 0,
`discord_ingestion_refusals` 0. The single subscription is still `paused`, `kill_switch=false`.

**No transaction was signed or broadcast, no worker or signer was started, and no funds moved.**

Supabase security advisors after the change: only the pre-existing INFO `rls_enabled_no_policy`
on `app_private` tables — the deliberate deny-all posture, which the new
`discord_ingestion_refusals` correctly joins — and the pre-existing WARN about Supabase Auth
leaked-password protection, which this product does not use (identity is Privy). **No new
finding.**

### Rollback

`supabase/rollback/11-bot-entry-limits.sql` and `12-registered-channel-authorization.sql`, run
in reverse order 12 → 11, each followed by its reapply list in `supabase/rollback/plan.mjs`.
`npm run verify:migration-rollback` proves all twelve round-trip to a byte-identical baseline.
Both headers say plainly what rolling back RESTORES, because both restore a silent defect.

## APPLIED 2026-08-06 — migrations 13 and 14, worker deployed

| # | Migration | Verification |
|---|---|---|
| 13 | `degenaration-subscription-channel-scope.sql` | `md5(prosrc)` **MATCH**, 1 signature at (uuid, uuid), anon denied, row counts unchanged. Enforces `subscriptions.channel_id`, which `app_user_save_bot` has always written and nothing ever read |
| 14 | `degenaration-current-drawdown-bucket.sql` | **MATCH**, 1 signature at arity 4, anon denied. Adds `currentlyDown50` |

### Migration 14 was found by the newly deployed worker

The performance scanner measured the one real call in production — called at
`0.01842`, now `0.003962`, a 78.5% loss — and the source profile's "Down 50%+" row read **0**.
`down50` counts `peak_x < 0.5`, meaning "never recovered half the entry", not "is down half". A
call that opens flat and collapses has `peak_x = 1.0` and was never counted.

It failed in the direction that matters: a source whose every call crashed showed an empty risk
bucket, understating the downside a subscriber copies.

Verified on production after deploying: `medianCurrentX 0.226`, `down50` (peak bucket) `0`,
`currentlyDown50` **1**.

### Services

| | |
|---|---|
| Vercel | `c179f98` |
| Railway `degenaration-bot` | `543e419` — `server/bot` byte-identical at HEAD |
| Railway `degenaration-worker` | **deployed 2026-08-06**, `rootDir server`, `/health` returns `ok`, `watch-only`, 0 errors. Performance scanner measuring real calls |

The worker uses the EXISTING Railway project and service — no duplicate project was created, no
secret was read or written. It runs watch-only because `server/worker.js` gates the entire
trading stack behind `DELEGATED_SIGNING === "on"`.

## APPLIED 2026-08-06 (second pass) — migrations 15 and 16

| # | Migration | Verification |
|---|---|---|
| 15 | `degenaration-exit-reason.sql` | `md5(prosrc)` **MATCH**, `worker_settle_position_exit` arities `[9]` — no overload — column and partial index present, row counts unchanged |
| 16 | `degenaration-freeze-after-stop.sql` | **MATCH**, 1 signature at (uuid, uuid), anon denied, row counts unchanged |

### Why 15 had to come first

`stopLoss.freezeAfterStop` has been in the builder since it shipped, persisted and versioned,
enforced by nothing — and it was **unimplementable**, not merely unimplemented.
`worker_settle_position_exit` cleared `pending_exit_kind` in the same statement that closed the
position, so "closed" and "stopped out" were the same row. 15 captures the reason on close only;
16 reads it.

The same missing fact also blocked trade history and the losing PnL card from saying how a trade
ended, and stopped a source's record separating stopped-out calls from calls closed in profit.

### 16 is a new migration rather than an edit to 13

13 is already deployed. Editing a deployed migration file desyncs this repository from
production, so 16 supersedes it in full and must follow it.

### Contract movement across this whole session

**13 enforced / 33 pending → 34 enforced / 21 pending.**

## Migration 17 — `degenaration-stop-breach-state.sql`

The durable stop-delay clock. `stopLoss.delaySeconds` was unenforceable without it: a debounce
needs to know WHEN the breach started, and the monitor is a stateless polling loop — holding
that in process memory loses it on a worker restart, which is exactly the volatile minute the
setting exists to absorb.

Fully additive: one nullable column on `public.positions`, one new function
`worker_record_stop_breach`. No existing function replaced.

**MUST be applied BEFORE the worker build that reads it.** `server/engine/store.js` selects
`stop_breached_at`, and PostgREST answers an unknown column with 400, so the worker would fail
on its first position load. `npm run check:worker-schema-contract` enforces this.

Rollback: `supabase/rollback/17-stop-breach-state.sql`.
