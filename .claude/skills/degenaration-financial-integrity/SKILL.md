---
name: degenaration-financial-integrity
description: Rules for DegenAration money paths — integer arithmetic, the 200 bps fee split, capital reservation, settlement, exits, withdrawals, and what may never be fabricated. Use whenever money, fees, payouts, balances, positions, or trades are modified.
---

# Financial integrity

This application moves real money. A rounding shortcut here is a real loss for a real person.

The canonical arithmetic and fee-model rules live in
`.agents/skills/degenaration-financial-integrity/SKILL.md` and
`docs/launch/FEE_AND_REWARD_MODEL.md`. **Read the first one before changing fee code** — it is
the single source for the rate, the rounding policy and the JS/SQL parity requirement, and
this file deliberately does not restate it so the two cannot drift.

What follows is the ledger behavior built on top of it.

## The chain, and the invariant at each link

```
intent (capital reserved)  →  queue  →  confirmation  →  trade_execution
   →  position + lot  →  exit consumes lots FIFO  →  realized PnL  →  ledger entries
```

1. **Capital is reserved before it is committed** and released exactly once, by trigger. A
   terminal failure releases; a submitted intent keeps the lock; an intent carrying a
   transaction signature is never auto-expired.
2. **A buy's notional is lamports; a sell's notional is its proceeds.** The input of a sell is
   the token, so using the requested input as notional charges fee on a token count. This was
   a real defect — do not reintroduce it.
3. **Settlement is idempotent on `(intent_id, attempt)`.** A replayed settle must not charge a
   second fee, open a second position, or consume the lots twice.
4. **`creator + referral + retained === platform_fee`**, by construction: `retained` is a
   generated column.
5. **Nothing is allocated from a fee that was not collected.** A zero platform fee pays no
   creator and no referrer. The creator rate is capped at the platform rate; the referral
   share is capped at what remains after the creator.
6. **Rates are snapshotted onto the execution**, so a later rate change never rewrites a
   historical trade.

## A null is not a zero

An unmeasured figure is written null and displayed as unmeasured. `slippage: 0` that nobody
measured is worse than an empty column: a null reads as "not captured", a zero reads as
"measured, and it was zero". This applies to proceeds, realized PnL, win rate, drawdown and
every marketplace figure.

## Never

Floating-point money past the legacy trigger boundary. A fee on a failed, expired, rejected,
simulated, dropped, duplicate or unfilled execution. A success claimed before confirmation. A
hand-edited balance. A fabricated financial row. An unverified migration applied to
production. A funded mainnet transaction in an automated test.

## Proving a change

```bash
npm run verify:withdrawable-state  verify:trade-intent-fanout  verify:intent-reconciliation
npm run verify:settlement-writer   verify:exit-settlement      verify:creator-referral
npm run verify:withdrawal-idempotency  verify:fee-ledger
```

Every verifier runs against real PostgreSQL with fixtures generated from captured production
shapes. **If a new assertion passes on the first run, break the fix and confirm it fails.** A
control that never ran is not evidence — three assertions in this repository were found to be
vacuous exactly that way.
