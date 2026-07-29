# Performance journal

Schema: `supabase/degenaration-product-ledgers-operations.sql`,
`supabase/degenaration-discord-signal-ingestion.sql`. Spec: `FINAL_LAUNCH_SPEC.md` §9.

> **Status: not yet repaired.** Requirements 5 and 6 are open. Two approved Discord
> sources show no measured history, and diagnosing why requires live database access —
> see `docs/coordination/OPEN_BLOCKERS.md` B-4. This document records the intended
> contract and the diagnostic order, not completed work.

## The chain

```
raw event → parse → dedupe → eligibility → baseline price → sampling
          → outcome → aggregation → marketplace projection
```

Every stage persists, so when a later stage is empty you can point at the stage that
broke the chain. That is the entire purpose of journaling.

Existing tables: `raw_signals`, `parsed_signals`, `signal_deliveries`, `trade_intents`,
`trade_executions`, `execution_legs`, `positions`, `performance_snapshots`.

## Required per signal

Unique id · source type and id · guild, channel, and message ids (Discord) · raw event
reference and immutable content hash · parser version and confidence · detected mint ·
event and ingestion timestamps · validation state · rejection reason · baseline price
source, timestamp, liquidity, and route · eligibility result and filter snapshot ·
eligible subscriber count at that moment · deduplication key.

## States

```
RECEIVED → PARSING → PARSED → VALIDATING → REJECTED | ELIGIBLE
ELIGIBLE → QUEUED → EXECUTING → OPEN → PARTIAL_EXIT → TP_HIT | SL_HIT | CLOSED
                                     → EXPIRED | DATA_ERROR
```

A call can be **measured** without any user copying it. Marketplace call performance and
user trade performance are separate figures and must never be merged.

## Baseline price

Captured at **eligibility time**, from a normalized provider, storing liquidity, pool,
quote asset, price source, slot, and confidence. Reject stale or inconsistent quotes.

**Never backfill a favorable baseline after the price moves.** Doing so silently inflates
every downstream metric and makes the whole marketplace dishonest.

## Sampling

Immediate baseline, short intervals through the first hour, wider intervals through 24h /
7d / 30d, final snapshots at configured horizons. Idempotent on `(signal, time bucket)`.
Provider failover and backfill. Prefer a batch sampler to unbounded per-signal jobs.

## Outcomes

Return at each horizon, maximum favorable excursion, maximum adverse excursion, time to
+50% / 2x / 5x, time to stop threshold, peak return, close or expiry reason, and data
completeness with confidence.

## Aggregates (1D / 7D / 30D)

Measured-call count, eligible-call count, win rate, median return, average return,
maximum drawdown, the `<50% / +50% / 2x / 5x+` distribution, last call, and data
freshness — computed only from eligible, non-duplicate, sufficiently measured calls.

Below the minimum sample threshold, show the **actual measured count** and `Tracking`.
Never render a wall of dashes, and never render an invented value.

## Diagnostic order for a silent source

Work down until a stage returns nothing; that stage is the defect.

1. Application, guild, channel, bot permission, and marketplace visibility records exist
2. The gateway listener is subscribed to the approved channels
3. Raw messages are arriving (`raw_signals` row count for the guild)
4. The parser recognizes the address and link formats actually being posted
5. Queue workers are processing durably
6. Baseline pricing resolves for the venue (Raydium, Pump.fun/PumpSwap, Meteora, Orca)
7. Sampling and aggregation jobs are running
8. Marketplace cache invalidation and projection are updating

If history cannot be reconstructed honestly, begin tracking from the earliest verified
timestamp and display `Tracking since [date]`.

## The rule

A missing metric is a bug report. **Do not replace `--` with a fabricated value.** For a
product that ranks communities by measured performance, an invented number is the worst
possible failure.
