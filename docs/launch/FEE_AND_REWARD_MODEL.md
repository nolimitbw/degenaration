# Fee and reward model

Canonical implementation: `lib/fee-model.js`. Database enforcement:
`supabase/degenaration-fee-allocation-integrity.sql`. Spec: `FINAL_LAUNCH_SPEC.md` §13.

## The rate

One user-facing rate: **2.00% (200 bps) of confirmed executed notional, per swap leg.**

A round trip of equal notional therefore costs 4.00% total (2.00% on the buy leg,
2.00% on the sell leg), excluding Solana network and priority fees.

No fee is charged on: a failed transaction, an expired quote, a rejected signal, a
simulation, a dropped or reverted transaction, a duplicate signal, an unfilled amount, a
deposit, or on Solana network/priority fees.

## Allocation — funded FROM the fee, never added to it

The user is charged 200 bps regardless of who gets paid out of it. Creator commissions
come **out of** that fee. There is no `2.00% + 0.70%`.

| Execution | User pays | Creator | Referral | DegenAration retains |
|---|---|---|---|---|
| Discord copy | 200 bps | 70 bps | — | 130 bps |
| Discord copy, referred | 200 bps | 70 bps | 10% of fee (20 bps) | 110 bps |
| KOL copy | 200 bps | 20 bps | — | 180 bps |
| KOL copy, referred | 200 bps | 20 bps | 10% of fee (20 bps) | 160 bps |
| Direct (no source) | 200 bps | — | — | 200 bps |

Referral is **10% of the collected platform fee**, not 10% of trade volume, and is
funded from the DegenAration-retained share — never from the creator's share.

## Arithmetic

All amounts are integer lamports held as `BigInt`. Floating-point arithmetic is
prohibited anywhere a value reaches a ledger, a receipt, or a payout.

Rounding is `floor(amount * bps / 10000)` at every step. The flooring remainder is
absorbed by retained revenue, which is why `retained_fee_lamports` is a generated column
rather than a written one — the balance identity holds by construction:

```
creator + referral + retained === platform_fee    (exactly, always)
```

`lib/fee-model.js` rejects fractional, negative, and non-finite input rather than
silently rounding it.

## Where it is enforced

| Layer | Mechanism |
|---|---|
| Application | `allocatePlatformFee()` returns a balanced split; `isBalancedAllocation()` asserts it |
| Worker | Mirrors the rate (deploys with `rootDir: server`, cannot import `lib/`); a drift test fails the suite if the values disagree |
| Database | `validate_execution_fees()` recomputes every fee and rejects mismatched rows; `retained_fee_lamports` is generated |
| Tests | `server/test/run.js` — spec §22.1 vectors plus JS↔SQL formula parity |
| CI gate | `npm run verify:fee-ledger` — 48 notional × source × referral combinations must balance |

The parity tests exist because the trigger recomputes fees independently: if the JS
rounding ever diverged from the SQL rounding, valid-looking writes would be rejected at
runtime. The tests pin both sides to `floor(amount * bps / 10000)`.

## Configuration

Fees stay off until `PLATFORM_FEE_ACCOUNT` is set server-side; `configuredPlatformFeeBps()`
returns 0 and no commission accrues. See `docs/coordination/OPEN_BLOCKERS.md` B-1.

Referral rates are versioned with effective dates; historical executions keep their
`*_bps_snapshot` values so past accounting never changes retroactively.

## Visibility

The interface shows `Platform fee 2.00%` plainly, with creator and referral allocation
detail behind an info control. Exact estimated and actual amounts, plus network and
priority fees, must appear before live bot activation and in transaction confirmations
and receipts. Do not hide money from users, and do not use defensive marketing copy.
