# Browser verification runbook (E-6)

Every `MIZAR_PARITY_MATRIX.md` row ending "authenticated save remains" or "browser proof
pending" is waiting on this and nothing else. The server side of each is already verified by
`npm run verify:bot-lifecycle` — see that file's correction section. What remains is evidence
that the **interface** does what the tested server does.

This is a procedure rather than a test suite on purpose: it needs a signed-in Privy session,
which cannot be scripted without real credentials, and untested test code would be a worse
artifact than an accurate checklist.

**Prerequisite:** a Privy identity with a Solana wallet on a non-production or low-value
account. No mainnet funds are needed for anything below. **Do not use a funded wallet.**

Record each row as PASS or FAIL with the observed text. A FAIL is more valuable than a skip.

---

## A. Wallet registration — proves the fix deployed in `2ef4d03`

| # | Step | Expected |
|---|---|---|
| A1 | Sign in | No error toast; the app loads |
| A2 | Query `app_private.trading_wallets` for your `privy_user_id` | Exactly one row, `is_primary = true`, `status = 'active'` |
| A3 | Sign out and back in | **Still exactly one row.** A second row is a FAIL |
| A4 | `select * from app_private.wallet_audit_log` | One `registered` row, none added by A3 |

## B. The funds incident — the reason this work started

| # | Step | Expected |
|---|---|---|
| B1 | Open Portfolio | A balance appears |
| B2 | Open Withdraw | **A real Available figure, not `0 SOL`.** Buttons live. `0 SOL` on a funded wallet is the original bug |
| B3 | Committed to open trades | `0 SOL` — production has no open intents |
| B4 | Enter an amount and a destination, reach the confirmation screen | Amount, destination and fee shown. **STOP. Do not sign** |
| B5 | Open Withdraw in a second tab, request the same amount | `409 WITHDRAWAL_IN_PROGRESS`, naming the in-flight request |

## C. Onboarding — broken for every user since 2026-07-16

| # | Step | Expected |
|---|---|---|
| C1 | Visit `/onboarding`, tick the risk box, Continue | **Advances.** "Sign in before accepting…" while signed in is the old bug |
| C2 | Count the steps | Three, not five |
| C3 | `select risk_accepted from public.privy_profiles` | `true` for your user |

## D. Bot lifecycle — the parity rows

| # | Step | Expected |
|---|---|---|
| D1 | Bots → Discord → configure a source, save as draft | **Saves.** "Temporarily unavailable" is the old bug |
| D2 | Reload the bot | Every field you set hydrates |
| D3 | Edit one field and save | Saves; `bot_config_versions` gains a row rather than mutating |
| D4 | Try to activate | Refused with the `AUTOMATED_MAINNET_RELEASE` reason — this refusal is correct |
| D5 | Open Bot Activity | Loads. 404 means the bridge or migration did not deploy |
| D6 | Section order | identity → wallet → source → funding → entry → DCA → TP → SL → security → execution |
| D7 | Advanced Execution | Collapsed by default |

## E. Admin console — visible to you only

| # | Step | Expected |
|---|---|---|
| E1 | Open the client ledger as owner | Table loads; every user listed |
| E2 | Wallet column | Your address after A2; "Not registered" for users who have not signed in on this build |
| E3 | Balance column | **There is none, deliberately** — the product is non-custodial and the server cannot read a chain balance |
| E4 | Open it as a non-admin | Denied |

## F. Responsive and console

| # | Step | Expected |
|---|---|---|
| F1 | Repeat B, C, D at 390px | No horizontal scroll; every control reachable and ≥44px |
| F2 | Browser console throughout | No errors |
| F3 | Network tab | No `400 unknown operation`. One means bridge drift returned — run `npm run verify:bridge-live` |

---

## After the run

Update each parity row from "browser proof pending" to the observed result, and record failures
in `docs/ai/OPEN_BLOCKERS.md` with the exact text seen. Do not mark a row verified without the
observation — the point of this file is that the distinction between *implemented* and
*verified* stays honest.

**Nothing here signs a transaction.** B4 stops at confirmation deliberately. A real withdrawal
is a separate, explicitly approved step.
