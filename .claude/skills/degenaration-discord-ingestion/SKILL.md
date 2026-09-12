---
name: degenaration-discord-ingestion
description: Rules for the DegenAration Discord and KOL signal pipeline — commands, ingestion, parsing, deduplication, fan-out, and the performance journal. Use when changing the bot, scanner, parser, or any marketplace performance figure.
---

# Discord and KOL ingestion

## The pipeline, and where each stage may fail

```
event → approved guild/channel → raw immutable event → parser + version
      → mint extraction → mint validation → liquidity route → security filters
      → accepted | rejected | duplicate → subscriber fan-out → trade intent
      → execution → journal → performance
```

Every event must end in an **observable** state. An event that vanishes is a defect even when
nothing errors.

## Commands

Exactly one command per purpose, `/register` included. Stale global and guild duplicates must
be removed, not left shadowed. Every command needs a real backend behavior, a permission
policy, idempotency, and a test. `npm run check:discord-commands` enforces uniqueness offline;
`npm run verify:discord-live` observes the live application.

## Ingestion rules

Support approved messages, embeds, replies, bare mint addresses, links, edited messages and
structured commands. Deduplicate on a **content hash**, never on a nullable external ID — a
NULL defeats a unique index silently, which is exactly how a dedupe guard was found broken
here once already.

Record parser version and confidence on every parse, and a rejection reason on every
rejection. A new parser version may re-parse an event; the same version may not.

Implement reconnect, retry, backfill where reliable, dead-letter handling, duplicate cooldown,
provider health, slot lag, correlation IDs and structured logs.

## Baseline price

Capture at eligibility time with its source, timestamp, liquidity, route and slot. **Never
backfill a favourable baseline after the price has moved.** Reject stale or inconsistent data
rather than storing it.

## The journal, and what it may claim

Marketplace figures come from measured calls and confirmed executions — never from an
estimate. Copied-execution performance carries `metrics.basis = 'copied-executions'` so it can
never be presented as call-signal performance.

Unknown data says which kind of unknown it is: collecting data, no eligible calls yet,
insufficient history, scanner unavailable, processing delayed, last updated N minutes ago.

**Never render an unknown as zero.** The two approved sources currently showing dashes are
correct: `raw_signals` is 0 because no bot is deployed. Replacing those dashes with numbers
would be fabrication, not a fix.

## Verifiers

```bash
npm run verify:discord-ingestion    # the trust boundary where untrusted input enters
npm run verify:performance-journal  # parse, dedupe, baseline, sampling, aggregation
npm run verify:signal-fanout        # one delivery per (signal, bot)
npm run verify:pipeline-e2e         # the whole chain composes
```
