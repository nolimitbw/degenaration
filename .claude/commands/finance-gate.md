---
description: Prove the DegenAration money path end to end without spending anything
---

Verify the financial gate. Nothing else in this product can be called complete while a user's
funds are unexplained, non-tradable or non-withdrawable.

Run the money suite:

```bash
npm run verify:withdrawable-state       # available / locked / pending, per owner
npm run verify:wallet-registration      # identity from the verified session only
npm run verify:trade-intent-fanout      # capital reserved before it is committed
npm run verify:intent-reconciliation    # a dead worker cannot freeze funds
npm run verify:withdrawal-idempotency   # duplicate requests collapse to one intent
npm run verify:settlement-writer        # confirmation writes the ledger
npm run verify:exit-settlement          # exits consume lots and realize PnL
npm run verify:creator-referral         # 200 bps split, four balanced entries
npm run verify:fee-ledger               # integer allocation vectors
```

Each must hold:

1. **Integer money only.** Lamports, token base units, basis points. Floats stop at the
   trigger boundary where a legacy `double precision` column is read, and never continue.
2. **`creator + referral + retained === platform_fee`**, by construction — `retained` is a
   generated column, so it cannot be written wrong.
3. **No fee without a confirmed fill.** Never on failed, expired, rejected, simulated,
   dropped, duplicate or unfilled execution, nor on a deposit or a network fee.
4. **Capital is reserved before it is committed and released exactly once.** A terminal
   failure releases; a submitted intent keeps the lock; an intent carrying a signature is
   never auto-expired.
5. **Withdrawal is self-service.** It may be refused only for insufficient balance, legitimate
   lock, pending duplicate, invalid destination, provider outage, unavailable signer, or an
   audited incident breaker. Never for a missing permission flag.
6. **A null is not a zero.** An unmeasured figure reads as unmeasured. Writing 0 for something
   nobody measured is fabrication, and §2 forbids it.

Prohibited while running this: broadcasting a funded mainnet transaction, editing a balance by
hand, inserting a financial row to make a screen look right, or applying an unverified
migration to production. Use PGlite, a local validator, or devnet.

If a verifier passes on the first attempt after a change, run a control: break the fix and
confirm the assertion actually fails. A test that cannot fail is not evidence.
