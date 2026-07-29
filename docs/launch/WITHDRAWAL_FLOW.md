# Withdrawal flow

Implementation: `lib/withdrawal.js`, `app/api/product/portfolio/withdraw/route.ts`,
`WithdrawModal` in `components/product/PortfolioDashboard.tsx`,
`supabase/degenaration-user-withdrawals.sql`. Spec: `FINAL_LAUNCH_SPEC.md` §12.

## Wallet model — why there is no custodial queue

DegenAration is **non-custodial**. Funds sit in user-owned wallets (Privy embedded or an
external connected wallet); the platform never holds keys and never moves funds.

A withdrawal is therefore an ordinary SOL transfer that **the user signs**. The server's
only job is to answer "how much can I move right now" honestly and to build an unsigned
transaction.

Spec §12.2 requires determining the real model before implementing, and explicitly
forbids presenting a fake one. Building a custodial withdrawal queue with an approval
step would have misrepresented how the product holds funds. It was not built.

There is consequently **no routine admin approval and no per-user unlock flag**. The
previous UI — a modal reading "In-app transfers are not available" — has been removed.

## Availability

```
spendable = balance − locked − pending − reserve
reserve   = rent-exempt minimum (890,880) + network fee headroom (15,000)
```

**Locked capital is in-flight BUY intents**, not open positions. This distinction matters:
the SOL that bought an open position has already left the wallet, so the on-chain balance
already reflects it. Subtracting positions again would double-count and wrongly block
legitimate withdrawals. `app_user_withdrawable_state` sums
`requested_input_base_units` for buy intents in `created`, `validating`, `ready`,
`claimed`, `submitting`, and `submitted`.

## Steps

1. User opens **Withdraw**. Availability is fetched server-side.
2. Available and committed balances are shown, with the reserve stated explicitly.
3. User enters a destination address and an amount, or picks 25 / 50 / 75 / Max.
4. Server validates: address format, self-send, positive integer amount, balance,
   reserve, locked capital.
5. Server builds an **unsigned** transfer and returns it with a stable idempotency key.
6. User signs with their own wallet via Privy `useSignAndSendTransaction` — the same
   proven path `useExecuteBuy` uses.
7. Signature is shown with an explorer link; availability refetches.

## Validation states

Each is a distinct, actionable message — never a feature-disabled or permission message:

| Code | Meaning |
|---|---|
| `zero-balance` | Wallet holds no SOL. Action stays available. |
| `below-reserve` | Balance is at or under the rent + fee reserve |
| `locked-capital` | All spendable SOL is committed to open trades; the exact amount is named |
| `exceeds-spendable` | Amount above available; the real available figure is returned |
| `invalid-destination` / `same-address` / `invalid-amount` | Input errors |

A balance that cannot be verified returns **503 with `retryable: true`**, not a
permission error. Failing closed is required; blaming the user is not.

## Safety

- Ownership proven by a Privy identity token before any transaction is built, so a caller
  can only ever spend their own funds
- Balances are read server-side; a client-supplied balance is never trusted
- Amounts are integer lamports; the SOL input string is parsed without floating point
- Stable idempotency key derived from owner, destination, amount, and request id
- The server holds no keys and never submits — the user's wallet does both

## Affiliate payouts stay separate

Creator and referral reward payouts keep their own rules — 0.1 SOL minimum, 0.043 SOL
processing fee, ledger-backed states. Those do **not** apply to principal withdrawal;
a test asserts a principal withdrawal below the affiliate minimum still succeeds.

## Not yet verified

The flow has 11 unit tests but has never run against a funded wallet or a real Privy
signature, and `degenaration-user-withdrawals.sql` has not been applied to a database.
