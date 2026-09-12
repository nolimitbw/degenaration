---
name: degenaration-performance-journal
description: Enforces the complete Discord and KOL signal-to-performance pipeline. Use whenever the scanner, parser, price capture, call states, strategy metrics, or marketplace aggregates are changed in DegenAration.
---

# Signal-to-performance journal

Read `FINAL_LAUNCH_SPEC.md` §9 and §10 first.

## The chain

```
raw event → parse → dedupe → eligibility → baseline price → sampling → outcome
          → aggregation → marketplace projection
```

Every stage persists. If a later stage is empty, you must be able to point at the stage
that broke the chain — that is the whole purpose of journaling.

## The rule that matters most

**Never replace a missing metric with a fabricated one.** If a source has no measured
history, find out why. `--` everywhere is a bug report, not a display problem. Showing
an invented number instead is the worst possible outcome for a product that ranks
communities by measured performance.

When history genuinely cannot be reconstructed honestly, start tracking from the earliest
verified timestamp and show `Tracking since [date]`.

## Required per signal

Unique id, source type and id, guild/channel/message ids, raw event reference and content
hash, parser version and confidence, detected mint, event and ingestion timestamps,
validation state, rejection reason, baseline price source/timestamp/liquidity/route,
eligibility snapshot, eligible subscriber count, deduplication key.

## Baseline price

Captured **at eligibility time**, from a normalized provider, with slot and confidence.
Reject stale or inconsistent quotes. **Never backfill a favorable baseline after the
price moves** — that silently inflates every downstream metric.

## Sampling and outcomes

Idempotent per signal and time bucket. Prefer a batch sampler to unbounded per-signal
jobs. Persist return at each horizon, max favorable and adverse excursion, time to +50% /
2x / 5x, peak return, close reason, and data completeness.

## Aggregates

Report measured count and eligible count separately. Honor a minimum sample threshold and
show `Tracking` below it rather than a wall of dashes. Keep call performance and
user-trade performance clearly distinct — never merge them into one figure.

## Definition of done

An end-to-end test from an approved Discord call or KOL trigger through to visible
measured performance, plus deduplication, provider-outage, and backfill cases. Source
inspection is not evidence for this area; a query result or a passing integration test is.
