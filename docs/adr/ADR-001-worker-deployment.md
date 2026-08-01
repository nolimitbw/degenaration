# ADR-001: Deploying the 24/7 automation worker

**Status:** Proposed — awaiting owner decision
**Date:** 2026-07-31
**Deciders:** Owner (only). Nothing here can be self-authorized; B-3 reserves mainnet execution.

## Context

The Next.js web app is live on Vercel and healthy. The worker in `server/` is code-complete,
declared in `render.yaml` as `degenaration-worker`, and **has never run**. Live counts:
`raw_signals`, `parsed_signals`, `signal_deliveries`, `durable_jobs`, `worker_leases`,
`trade_executions`, `commission_ledger_entries` — all zero.

Two launch requirements (6 and 7) cannot close while it stays down, because both need
measured data that only the worker produces. That is the pressure to deploy.

An architecture review mapped five subsystems and then tried to **refute** each material
risk it found. Three findings survived; two widely-assumed ones did not. Both matter to
this decision, so both are recorded.

### Survived verification

**1. Nothing in the worker ever sells.** `server/engine/monitor.js` defines and exports
`startMonitor` (the take-profit / stop-loss engine), and it is the only server module that
imports `sellToken`. Nothing calls it. `server/worker.js:13-20` requires prices, limits,
copy, calls, performance, signer and store — `monitor` is absent, and a repo-wide grep finds
only the definition and the export.

So with `DELEGATED_SIGNING=on` the worker starts up to three **buy** paths and has no
automated **sell** path of any kind. The only sell in the codebase is the manual one in the
web app (`lib/useExecuteSell.ts`). Users configure `tp1`, `tp1_sell`, `tp2`, `tp2_sell` and
`stop_loss`; the API validates and persists them; nothing acts on them. The `positions`
table whose own migration comment says "the 24/7 monitor reads these open rows to fire
per-subscription TP/SL sells" is never read or written.

**This is deeper than a missing `require`, and the first draft of this record understated
it.** `startMonitor({ positions, ... })` takes its positions as a parameter, and there is no
producer for them anywhere:

- `server/engine/store.js` has no open-position loader — no function in it mentions positions.
- Nothing under `server/` reads or writes any positions table.
- **The underlying data is never captured.** After a successful buy, `calls.js` calls
  `finishCallExecution(...)` and `recordCopy({ mint, user, privy_user_id, group_id, size,
  sig, kind })`. `size` is the SOL spent. The token amount received and the entry price are
  never recorded — and `startMonitor` needs `amountRaw` and `entryPriceUsd` to evaluate a
  single trigger.
- `positions` is an in-memory array with no persistence, so a restart would drop every open
  position even once the data existed.

The engine's own header already says the correct fix needs a pending state that survives a
restart. Combined with the above, restoring automated exits is **building position tracking
end to end** — capture on fill, persistence, reload on start, and confirmation-aware state —
not wiring an existing component back in.

**2. Submission is treated as settlement.** `server/engine/signer.js` returns Privy's
transaction hash on submit without awaiting confirmation, and every caller treats that as
done — `limits.js` marks the order `filled`, `calls.js` marks the execution `succeeded`,
`copy.js` counts the spend. A trade that fails on chain (slippage, expired blockhash) is
recorded as a completed trade.

**3. The copy path is unsafe with more than one worker instance.** It has no atomic claim,
unlike `worker_claim_limit_order`, which reserves spend inside the claiming transaction. Its
daily cap lives in a per-process `Map`, and `bumpDailySpent` PATCHes an **absolute** total,
so two instances overwrite each other's spend and the loss persists because `spentSoFar`
reseeds from the clobbered value. `app_private.worker_leases` exists for exactly this and
has no caller.

### Did NOT survive verification — do not treat these as blockers

**"Deploying the worker can't close anything until trading is enabled."** False, and this is
the finding that changes the decision. `startPerformanceScanner` is invoked at
`server/worker.js:132`, **outside every signing gate**. The three trading watchers are
inside `if (SIGNING_READY)` and `if (COPY_TRADING_READY)`; the scanner is not. A worker
deployed with the shipped defaults measures sources and writes nothing to any trading path.

**"The site advertises a 2% fee it never charges."** False. The displayed fee and the
charged fee read the same switch (`configuredPlatformFeeBps`), so with the fee account
unresolved the UI shows fees off rather than advertising 2%.

## Decision

**Deploy the worker with the shipped `render.yaml` defaults — `DELEGATED_SIGNING=off`,
`COPY_TRADING=off`, `SOLANA_NETWORK=devnet` — and leave them off.** This closes requirements
6 and 7 and touches no money. Enabling signing is a separate decision that must not be taken
until finding 1 is fixed.

## Options Considered

### Option A — Deploy with signing enabled

| Dimension | Assessment |
|---|---|
| Complexity | Low to deploy, high to make safe |
| Cost | Real user funds at risk |
| Closes requirements | 6, 7, and automation |
| Reversibility | **Poor** — opened positions are real |

**Pros:** the product does what the marketing describes.
**Cons:** the worker would open positions it can never close. A user sets a 20% stop loss,
the worker buys, the token falls 90%, and nothing sells — because the code that sells is
never started. Findings 2 and 3 compound it: failed sells would be recorded as successful,
and a second instance would corrupt the daily spend cap.

### Option B — Deploy watch-only, defaults unchanged *(recommended)*

| Dimension | Assessment |
|---|---|
| Complexity | Low — it is the committed configuration |
| Cost | Hosting only |
| Closes requirements | 6 and 7 |
| Reversibility | Total — stop the service |

**Pros:** the performance scanner runs outside every gate, so measured source data starts
accumulating and the dashes on the Discord marketplace become real numbers. No signing key
is exercised, no order is placed, no user funds are reachable. It also surfaces operational
problems — connectivity, rate limits, parser behaviour — while nothing is at stake.
**Cons:** automation still does not execute, so the release gate stays closed. This is a
partial step, and should be described to users as such.

### Option C — Do not deploy

| Dimension | Assessment |
|---|---|
| Complexity | None |
| Cost | None |
| Closes requirements | None |
| Reversibility | N/A |

**Pros:** zero new surface.
**Cons:** requirements 6 and 7 stay unclosable and the marketplace keeps showing dashes that
look like a bug but are an honest empty journal. Deferring does not make findings 1–3 less
true; it only delays discovering them under load.

## Verified after this record was drafted

The recommendation was originally read off the gate structure. It has since been **run**.

Starting the worker with the shipped defaults and watching which subsystems log:

```
[worker]      starting — signing DISABLED (watch-only)
[worker]      health listening on :8787
[performance] {"type":"PERFORMANCE_LOAD_ERROR","error":"fetch failed"}
```

One measurement subsystem, and nothing else. No `[limit]`, no `[call]`, no `[copy]` — the
trading watchers never start. (The fetch error is the throwaway Supabase URL used for the
test; it is the scanner genuinely trying to work.)

**One guard now closes all three findings.** `server/worker.js` refuses to boot when
`DELEGATED_SIGNING=on` while `store.loadOpenPositions` does not exist. Because
`startLimitWatcher` and `startCallWatcher` sit inside `if (SIGNING_READY)` (line 123) and
`startCopyWatcher` inside `if (COPY_TRADING_READY)` (line 155), which itself requires
`SIGNING_READY` — every path that can reach findings 1, 2 and 3 is downstream of that one
check. They are unreachable until position tracking genuinely exists.

| Configuration | Observed |
|---|---|
| `DELEGATED_SIGNING=on` | exit 1, refuses, prints the remedy |
| `DELEGATED_SIGNING=off` | boots, scanner only, stays running |

This does not make findings 1–3 fixed. It makes them **unreachable by accident**, which is a
different and weaker claim, and the one this record relies on.

## Trade-off Analysis

The real question is not "worker or no worker" — it is **whether measurement and execution
have to ship together.** They do not. The gate structure already separates them, and that
separation is the safest thing in the current design.

Option A fails on a single fact: a system that buys without being able to sell is worse than
one that does nothing, because it converts a user's configured risk limit into a promise the
code cannot keep. That is not a tuning problem to fix after launch.

Option B extracts the entire benefit that motivated deploying — data — while leaving the
dangerous half switched off in committed configuration rather than by convention.

Option C's only advantage over B is avoiding a hosting bill.

## Consequences

**Easier:** requirements 6 and 7 become closable on real data. Ingestion and parsing get
exercised where failure costs nothing. The `raw_signals` → `parsed_signals` chain gets
observed rather than reasoned about.

**Harder:** a running worker is a thing to monitor. Findings 2 and 3 stop being theoretical
the moment signing is ever enabled, so they must be fixed before that, not alongside it.

**To revisit:** the flags are the safety mechanism. If anyone ever sets `DELEGATED_SIGNING=on`
without `startMonitor` being wired in, every argument in this record is void.

## Action Items

1. [ ] **Owner:** provide the worker host credentials and deploy `degenaration-worker` with
       `render.yaml` unchanged. Confirm the log line reads `signing DISABLED (watch-only)`.
2. [ ] **Owner:** confirm `DELEGATED_SIGNING` and `COPY_TRADING` are `off` in the host's
       environment, not only in `render.yaml`.
3. [ ] Verify `raw_signals` begins incrementing, then close requirements 6 and 7 on measured
       data rather than on deployment alone.
4. [x] **Before signing is ever enabled — code work, in this order.** Item one is a
       feature, not a fix; scope it as such rather than as a wiring change:
       a. [x] capture `amountRaw` and `entryPriceUsd` when a buy fills, and persist the open
          position — done in `server/engine/settlement.js`. Note the table did **not**
          exist: `supabase/add-positions-table.sql` was written but never applied, verified
          against the live catalog, so the migration creates it as well as extending it.
          The size comes from the transaction's own token balance delta, not the quote's
          `outAmount`, which is an estimate the fill misses by up to the slippage tolerance;
       b. [x] load open positions on worker start — `store.loadOpenPositions`, which reads
          `open` and `exiting` rows so a restart resumes an in-flight exit rather than
          abandoning or duplicating it;
       c. [x] confirmation is awaited before anything counts as settled — `engine/confirm.js`
          classifies a signature as confirmed / failed / expired / pending, and `pending` is
          the state that blocks re-firing. `processed` is deliberately not treated as
          settled, and the expiry window is 120s rather than the ~80s blockhash lifetime
          because declaring expiry early re-fires a sell that may still land;
       d. [x] `startMonitor` and `startSettlementWatcher` are started from `worker.js` behind
          `SIGNING_READY`. The boot guard now checks the whole capture-and-exit path rather
          than one loader, and a test proves each requirement is individually load-bearing;
       e. [ ] give the copy path an atomic claim and a durable spend counter, or enforce a
          single instance through `worker_leases`. **Still open** — this is the last item.
5. [ ] Keep B-3 closed until 4 is done and reviewed. This record does not authorize mainnet.
