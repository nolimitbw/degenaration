---
name: degenaration-financial-integrity
description: Enforces lamport and basis-point arithmetic, fee allocation, immutable ledger entries, withdrawal safety, idempotency, execution state machines, and reconciliation. Use whenever money, fees, payouts, balances, or trades are modified in DegenAration.
---

# Financial integrity

This application moves real money. A rounding shortcut here is a real loss for a real
person. Read `docs/launch/FEE_AND_REWARD_MODEL.md` before changing anything in this area.

## Non-negotiable

1. **No floating-point math** on any value that reaches a ledger, receipt, or payout.
   Use `BigInt` lamports and integer basis points via `lib/fee-model.js`. Reject
   fractional input; never round it silently.
2. **One rate, one source.** `lib/fee-model.js` is canonical. The worker mirrors it only
   because `render.yaml` deploys with `rootDir: server` and cannot import `lib/` — a
   drift test guards that. Never add a sixth copy of `200`.
3. **Creator commissions are funded FROM the platform fee**, never added to it. The user
   pays 200 bps whether or not a creator or referrer is paid.
4. **The ledger balances exactly**: `creator + referral + retained === platform_fee`.
   Flooring remainders go to retained. `retained_fee_lamports` is a generated column so
   this cannot be written wrong.
5. **Referral is a share of the collected fee**, not of volume, funded from retained
   revenue — never from the creator's share.
6. **No fee without a confirmed fill.** Nothing is charged on failed, expired, rejected,
   simulated, dropped, reverted, duplicate, or unfilled execution, nor on deposits or
   network fees.

## JS and SQL must agree

`app_private.validate_execution_fees()` recomputes every fee and rejects a mismatched
row. If JS rounding diverges from SQL rounding, correct-looking writes fail at runtime.
Both are pinned to `floor(amount * bps / 10000)`, and `server/test/run.js` has parity
vectors. If you change one, change and re-verify the other.

## Withdrawals

Non-custodial: the user signs their own transfer. Never build a custodial queue or a
routine admin-approval step — that misrepresents how funds are held.

- Prove wallet ownership before building a transfer
- Read balances server-side; never trust a client figure
- Locked capital is **in-flight buy intents**, not open positions (their SOL already
  left the wallet — counting it again wrongly blocks withdrawals)
- Retain the rent-exempt and network-fee reserve
- Zero balance and locked capital are validation states, never "feature unavailable"
- Unverifiable financial state fails closed as a **retryable** error, not a permission
  message
- Stable idempotency key; never submit twice; never claim success before confirmation

## Required test vectors

Buy, sell, partial fill, retry with the same idempotency key, failure, reversal,
reconciliation, smallest-unit rounding, creator-only, referral-only, both, and neither.
Every case must balance.

## Before you finish

```bash
npm run verify:fee-ledger
npm test
```

Report exact commands and results. A green build alone is not evidence.
