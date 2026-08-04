# Auto-trading: what works, what does not, and how each claim is backed

Spec §E requires that the system not falsely claim auto-trading works, and that where it does
not, the root cause be found, fixed, verified, tested and **documented**. This is that
document. Written 2026-08-04.

**Headline: auto-trading does not run today.** Nothing executes automatically, and nothing in
the product claims otherwise — `AUTOMATED_MAINNET_RELEASE.enabled` is `false`, so every attempt
to activate a live bot is refused with a truthful reason.

---

## The pipeline, stage by stage

`→` is a working link. `⊘` is a break.

```
Discord event
  ⊘  no bot deployed (E-2)
raw_signals
  →  bot_ingest_discord_signal_v2, content-hash deduped
parsed_signals
  →  parser version recorded, rejection reason retained
signal_deliveries
  →  fan-out per (signal, bot), config version captured   [5c1012a]
trade_intents
  →  capital reserved before submission                   [fcebe9c]
  →  abandoned reservations released, signed ones held     [52dbc28]
  ⊘  no worker running (E-3)
call_executions            (queue: claim → submit → settle)
  →  settlement writes the ledger                          [d554243]
trade_executions → positions → position_lots
  →  fee accrual triggers fire on insert
commission_ledger_entries
  ⊘  0 bps collected — PLATFORM_FEE_ACCOUNT unset (E-4)
```

Every arrow is code that exists and is covered by a verifier. Every `⊘` is infrastructure.

## Stage detail

| Stage | State | Backed by |
|---|---|---|
| Discord ingestion | **blocked** — `raw_signals` = 0, no bot deployed | E-2 |
| Parse and dedupe | works | `verify:performance-journal` |
| Subscriber fan-out | **built this session** — had no writer at all | `verify:signal-fanout`, 6 properties |
| Trade intent + capital reservation | works | `verify:trade-intent-fanout`, 12 properties |
| Abandoned-intent recovery | **built this session** | `verify:intent-reconciliation`, 5 properties |
| Wallet identity | works, deployed | `verify:wallet-registration`, 12 properties |
| Quote / simulate / submit | code exists, **never executed** | needs E-3 |
| Confirmation handling | code exists, **never executed** | needs E-3 |
| Settlement → positions/lots | **built this session** | `verify:settlement-writer`, 8 properties |
| Fee accrual | triggers correct, **collect 0 bps** | E-4 |
| Exit handling | code exists, **never executed** | needs E-3 |
| Duplicate-trade prevention | works | unique `entry_sig`; `worker_open_position` idempotent |
| Balance locks / release | works | reservation is released once, by trigger |

## Root causes found and fixed

Three were missing writers — code that read a table nothing ever wrote. Each would have
failed silently in production rather than erroring.

1. **`trade_executions`, `positions`, `position_lots` had no writer.** The 200 bps fee, creator
   share and referral apparatus is correct and was attached to a table that never received a
   row, so no fee could ever accrue and Portfolio was structurally empty. Fixed `d554243`.
2. **`signal_deliveries` had no writer.** The chain stopped one step before subscribers: a
   parsed call reached no bot, so no Discord signal could ever produce a trade intent. Fixed
   `5c1012a`.
3. **`trade_intents` had no writer**, so `lockedLamports` was structurally always zero and a
   user could withdraw capital the worker had already committed. Fixed `fcebe9c`.

And one recovery hole: **nothing released capital if the worker died mid-flight.** An intent
stuck in `capital_reserved` would hold a user's SOL permanently — the funds incident reached by
a different route. Fixed `52dbc28`, with a guard that never auto-expires an intent carrying a
transaction signature.

## What cannot be verified here, and why

| Claim | Why it is unverifiable without infrastructure |
|---|---|
| "a Discord call becomes a trade" | needs a deployed bot (E-2) and a worker (E-3) |
| "the 2% fee is collected" | needs a valid Jupiter output-mint fee account (E-4) |
| "exits fire at the configured TP/SL" | needs a worker holding a real position (E-3) |
| "the browser flow works end to end" | needs a signed-in session (E-6) |

Writing more code changes none of these. Each is a dependency the repository cannot satisfy.

## The honest summary

The **accounting and safety layer is complete and tested**: capital is reserved before it is
committed, released exactly once, recovered if the worker dies, never released while a
signature exists, and settled into an immutable ledger whose fee identity holds by
construction.

The **execution layer is written and unproven.** It has never placed a trade, because no
worker has ever run.

Anyone reading this should conclude that DegenAration is safe to *hold* funds against — the
paths that could lose or freeze money have been closed — and that it has not yet been shown to
*trade* them. Those are different claims and this document keeps them apart deliberately.
