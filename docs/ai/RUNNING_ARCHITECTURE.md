# How DegenAration actually runs — 2026-08-12

The deployment model changed completely today. Every document written before this describes a
worker on Railway that no longer exists — Railway's trial expired and removed every deployment,
so the engine runs on Vercel and Supabase drives it.

## Two executors exist. Only one can trade.

A `degenaration-worker` **is** hosted on Render and has been up for ~20 hours. An earlier
revision of this file said "there is no worker host"; that was true when written and is not now.
But it is **watch-only** — `server/worker.js` gates the whole trading stack behind
`DELEGATED_SIGNING === "on"`, and Render's copy does not have it:

```
mode: watch-only   signingEnabled: false   capabilities.submission: false
```

So the split is:

| | Render worker | Vercel in-app engine |
|---|---|---|
| Watches, reconciles, heartbeats | yes | yes |
| **Can sign and submit** | **no** | **yes** |
| Driven by | its own loop | `pg_cron` → `/api/worker/tick` |

**Both running is safe but redundant.** `worker_claim_call_execution` claims atomically under
`for update`, so a call cannot be taken twice however many watchers race for it. Redundancy in
trading code is still a liability: when signing moves to Render, drop the
`degenaration-execution-engine` schedule rather than leaving two paths live.

### The trap this laid, once

`automationReadiness()` was modelled entirely on a hosted worker and asked its `/health` for
everything. `submission` is the one capability that depends on SIGNING rather than on code being
present, so the watch-only Render worker reported it false — and **vetoed the deployment that
was actually executing trades.** The product told users automation was unavailable while it was
signing. `signer` had the same shape: it ANDed a database fact derived from the hosted worker's
heartbeat with that worker's health, neither of which describes Vercel.

Each executor now proves signing for itself and neither vouches for the other. If a third
execution path is ever added, that is the rule to keep.

## The live path

```
CA posted in an approved Discord channel
  ├─ detected by the scanner                        ~5s   pg_cron → /api/cron/discord-backfill?live=1
  ├─ mint validated on chain, call journalled              /api/ingest-call
  ├─ execution fired immediately                    ~840ms /api/worker/tick?once=1
  └─ rug check → subscriber filters → atomic claim
     → quote → simulate → sign (Privy) → submit

  ≈ 6 seconds, Discord message to signed transaction.
```

## What runs, and what drives it

| Job | Schedule | Does |
|---|---|---|
| `degenaration-discord-scanner` | every minute, sweeps every 5s for 50s | reads approved channels, journals calls |
| `degenaration-execution-engine` | every minute, passes every 8s for 50s | settlement → exits → entries |
| `degenaration-price-call-journal` | every 2 minutes | prices the call journal in-database |

All three are `pg_cron` jobs in Supabase calling Vercel over the `http` extension. Read
`cron.job_run_details` before believing any of them works — two scheduling defects today were
visible only there, and both looked healthy from outside.

## Why it is built this way

**The engine is on Vercel** because there is no host. A function can do every step — Privy
signing, Jupiter, Solana RPC are all HTTPS — but it cannot stay resident, so each invocation
runs a bounded internal loop. That loop is what turns a one-minute schedule into second-scale
work.

**The scanner polls instead of listening** because Discord only pushes `MESSAGE_CREATE` over a
persistent WebSocket. The limit is not Discord's rate cap; it is that pg_cron cannot fire more
than once a minute. So the invocation waits: it sweeps for most of a minute and is restarted
each minute.

**Both are bridges.** A hosted `server/bot` detects in ~100ms instead of ~5s, and a hosted
`server/worker.js` needs no loop at all. When either is hosted, drop the matching schedule.
`server/worker.js` **is** hosted now — but watch-only, so the schedule stays until it can sign.
Setting `DELEGATED_SIGNING=on` on Render is what retires `degenaration-execution-engine`.

## The wiring rule that cost the most to learn

Watcher dependencies have DIFFERENT names from the store's exports — `loadSubmitted` vs
`loadSubmittedExecutions`, `claimExit` vs `claimPositionExit`, `recordPeak` vs
`recordPositionPeak`. That mapping lives in **`server/engine/wiring.js` and nowhere else**.

Passing `{ ...store }` instead delivered every renamed dependency as `undefined`. Production
reported `mode: "live"` with seven `LOAD_ERROR`s and no trades — a green status over a dead
path. `missingWiring(store)` now asserts every name resolves before a pass runs.

## The listener that is not ours

`degencalls.onrender.com` holds the only Discord gateway connection and is **not in this
repository**. Its own counters:

```
ingestion: attempts 5, accepted 3, quarantined 116, lastAttemptAt 2026-08-05
```

It sees callers' messages and discards them. That is why the scanner poll exists at all.
`server/bot/` is the correct listener and forwards rather than quarantining; it needs a host —
and note Render's free tier covers web services, not background workers, so a gateway listener
is a paid instance there.

## Measurement, and the limit that cannot be undone

A call is measurable only with an entry price AND a current price. `isHistorical` in
`lib/discord-ingest.js` captures a baseline when the message is under five minutes old and
refuses beyond that: DexScreener answers with the price NOW, and stamping today's price on an
old call would invent a source's entire track record.

**2,275 historical calls will never be measurable.** Their entry prices are genuinely unknowable.
Track records build from calls ingested live, forward only. The marketplace counts them
unmeasured rather than guessing, and that is correct.

## Still outstanding

1. **Rotate Privy and Supabase keys.** They were exposed in an assistant transcript on
   2026-08-11 while `DELEGATED_SIGNING=on`. `PRIVY_AUTHORIZATION_KEY` can move user funds.
2. **The platform fee account** does not exist on chain, so 0 bps is collected. It does not need
   the fee wallet's private key — see `OWNER_RUNBOOK.md`.
3. **No funded bot exists.** The one subscription is paused, disabled, with no channel, so a real
   call still reaches nobody. The chain is proven by `verify:pipeline-e2e`; what is unproven is a
   swap landing on chain.
