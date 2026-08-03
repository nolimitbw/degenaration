# The authoritative accounting model (C-10)

Decided 2026-08-04 from a complete writer/reader inventory of both accounting worlds, taken
against the repository and confirmed against the live database. This closes C-10 as a
*decision*; the implementation sequence is in §6 and is not yet built.

---

## 1. The finding

Two parallel accounting worlds exist. They never meet.

**World A — `app_private`, the product model.** `trade_intents` → `trade_executions` →
`positions` → `position_lots` → `commission_ledger_entries` → `cash_movements` →
`performance_snapshots`.

**World B — the worker's journal.** `app_private.call_executions`,
`app_private.copy_executions`, `public.positions`, `public.trades`.

An automated inventory of every `insert into` / `update` and every `from` / `join` across
`supabase/`, `server/`, `app/` and `lib/` gives this:

| Table | Writers | Readers | Verdict |
|---|---|---|---|
| `app_private.trade_intents` | **0** | 4 | read but never written |
| `app_private.trade_executions` | **0** | 4 | read but never written |
| `app_private.positions` | **0** | 4 | read but never written |
| `app_private.position_lots` | **0** | **0** | entirely dead |
| `app_private.cash_movements` | **0** | 1 | read but never written |
| `app_private.performance_snapshots` | **0** | 3 | read but never written |
| `app_private.commission_ledger_entries` | 4 | 3 | writers exist but are unreachable — see below |
| `app_private.call_executions` | 3 | 5 | written by the worker |
| `app_private.copy_executions` | 1 | 1 | written by the worker |
| `public.positions` | 2 | 2 | written by the worker |
| `public.trades` | 2 | 3 | written by manual swaps |

**Every core table of World A has zero writers.** World A is the world that Portfolio, the
PnL cards, the admin revenue dashboard, bot activity, the marketplace projections and the
withdrawal screen all read.

`commission_ledger_entries` looks alive but is not. Its accrual writers are triggers —
`trade_executions_commission_accrual_insert` and `..._update`
(`degenaration-authoritative-commission-accrual.sql:268,271`) — hung on
`app_private.trade_executions`, which nothing writes. The only reachable writer is the
affiliate payout path. **The entire 200 bps fee, creator-share and referral apparatus is
correct code attached to a table that never receives a row.**

### What this costs, concretely

1. **The withdrawal locked figure is structurally zero.**
   `app_user_withdrawable_state` computes locked capital as
   `sum(trade_intents.requested_input_base_units)` over in-flight buys
   (`degenaration-user-withdrawals.sql:32-41`). `trade_intents` has no writer, so
   `lockedLamports` is *always* `"0"` — including at the moment the worker has committed
   SOL to a buy it is about to submit. **A user can withdraw capital the worker is about to
   spend.** This is the most dangerous consequence and it is silent.
2. **No platform fee is ever recorded.** Not under-recorded — never recorded.
3. **Portfolio positions, executions, cash movements and the equity chart are structurally
   empty** regardless of how much the user trades.
4. **PnL cards cannot be produced.** `position_lots` would supply average entry and exit and
   has neither a reader nor a writer. This is the true root cause behind Priority 5, and it
   is a missing writer, not a missing computation.

---

## 2. The decision

**`app_private` (World A) is the authoritative accounting model. World B is demoted to an
operational work queue and is not an accounting record.**

Four reasons, in order of weight.

**It is what every read surface already expects.** Portfolio, PnL cards, admin revenue, bot
activity, marketplace projections and the withdrawal locked figure all read World A today.
Choosing World B means rewriting all of them.

**World B cannot carry the required invariants, and is not close.**
`app_private.call_executions` has columns `id, call_id, subscription_id, claim_token,
status, amount_sol, tx_signature, error, created_at, updated_at, finished_at,
submitted_at`. There is **no fee column of any kind** — no gross notional, no platform fee,
no creator or referral snapshot, no bps snapshot. And `amount_sol` is floating point, which
`FINAL_LAUNCH_SPEC.md` §13.1 forbids for money. World A already enforces the opposite by
construction: integer lamports, bps snapshots, `retained_fee_lamports` as a generated column
so `creator + referral + retained ≡ platform_fee` cannot drift, a balanced-ledger trigger,
and immutability protection on reconciled rows.

Making World B authoritative therefore means adding intents, executions, lots, fee
snapshots and a balanced ledger to it — which is rebuilding World A in a worse schema.

**There is no migration risk.** Every financial table in production has **0 rows**
(verified 2026-08-04). There is no history to convert and no user record to invalidate.
This is the cheapest this decision will ever be, and it is the reason it should be taken
now rather than after launch.

**It is reversible in the only direction that matters.** World B keeps working as the
worker's queue throughout; the change is additive. If the World A write path proves wrong,
the queue still holds the operational truth and can be replayed.

---

## 3. What each table is for

| Table | Role | Written by |
|---|---|---|
| `trade_intents` | The commitment. Created the moment capital is earmarked, before any transaction exists. **This is what makes capital "locked".** | fan-out, at signal eligibility |
| `trade_executions` | One row per submission attempt. Carries the confirmed notional and the immutable fee snapshot. | submission, then confirmation |
| `commission_ledger_entries` | Immutable balanced double entry. Accrued by trigger from a reconciled execution. | trigger only, never directly |
| `positions` | Current holding per mint per owner. | settlement |
| `position_lots` | Entry and exit lots. The only source of average entry, average exit and realized PnL. | settlement and each exit |
| `cash_movements` | Deposits and withdrawals, reconciled against signatures. | deposit detection, withdrawal confirmation |
| `performance_snapshots` | Periodic projection for charts and marketplace. Derived; never a source. | scheduled job |
| `call_executions` / `copy_executions` | **Operational queue only.** Claim tokens, retry state, worker leases. Not an accounting record. | worker |
| `public.positions` | Worker's own view of what it holds, for exit management. Not an accounting record. | worker |
| `public.trades` | Legacy manual-swap log. Read-only going forward. | manual swap path |

---

## 4. The formulas, as they must be

```
total_balance        = on-chain getBalance(wallet)          -- authoritative, always
locked_balance       = Σ trade_intents.requested_input_base_units
                         where side='buy' and state in
                         (created, validating, ready, claimed, submitting, submitted)
pending_trade        = locked_balance          -- one query, one number, never two
pending_withdrawal   = Σ withdrawal_intents.amount_lamports where state in
                         (created, signing, submitted)      -- TABLE DOES NOT EXIST YET
available_balance    = max(0, total_balance - locked_balance
                                - pending_withdrawal - REQUIRED_RESERVE)
withdrawable_balance = available_balance
tradable_balance     = available_balance       -- must be enforced at quote time,
                                               -- which it currently is not
REQUIRED_RESERVE     = 890880 (rent-exempt) + 15000 (fee headroom) = 15890880 lamports
```

Invariant, which must hold per owner at every instant:

```
total_balance = available_balance + locked_balance + pending_withdrawal + REQUIRED_RESERVE
```

It holds trivially today at `0 = 0 + 0 + 0` on the internal side because nothing is
recorded. It becomes a real assertion the moment intents are written, and a verifier must
assert it then.

### Fee allocation, unchanged from spec §13

```
platform_fee = floor(gross_notional × 200 / 10000)
creator_fee  = floor(gross_notional × (70 | 20) / 10000)     -- Discord | KOL
referral_fee = floor(platform_fee × referral_share_bps / 10000)
retained     = platform_fee - creator_fee - referral_fee     -- GENERATED, never written
```

Charged only on a **reconciled** execution with a transaction signature. Never on failed,
dropped, expired, simulated, duplicated or unconfirmed legs.

---

## 5. Which of the reported root causes are real

| Candidate | Verdict |
|---|---|
| Missing wallet persistence | **CONFIRMED, two half-built paths.** `app_private.trading_wallets` is empty and `app_user_upsert_wallet` — although defined, allowlisted and deployed — has **no call site anywhere in the repository**. The legacy path `privy_profiles.wallet_address` *does* have a caller (`app/wallet/WalletBody.tsx:57`), but only when a user saves limits on `/wallet`, and the onboarding funnel to it was hard-broken at step 0 since 2026-07-16. Hence 0 rows in both. |
| `app_user_upsert_wallet` has no call site | **CONFIRMED.** It appears only in its SQL definition, the bridge allowlist, and documentation. |
| Privy wallet identity not reaching app-bridge | **EXCLUDED.** `p_privy_user_id` is derived from a verified Privy JWT in every route and reaches the bridge correctly. The wallet *address* is never sent because no RPC asks for it. |
| Stale Portfolio data | **EXCLUDED.** The balance is a live `getBalance` per request with `cache: "no-store"`. It cannot be stale. |
| Incorrect available-balance formula | **PARTLY.** The arithmetic in `lib/withdrawal.js` is correct and now proven across 12 properties. Its *input* is wrong: `locked` is structurally 0, and `pendingWithdrawalLamports` is accepted but never supplied. |
| RLS or authorization denial | **EXCLUDED.** Verified post-deploy: `anon` and `authenticated` denied on all six money RPCs, `service_role` granted, every function `SECURITY DEFINER` with `search_path=''`. |
| Missing signer | **NOT APPLICABLE to withdrawal.** The user signs their own transfer; the server holds no keys. It *is* applicable to the worker (blocker E-3). |
| Unapplied migration | **CONFIRMED but now narrowed.** `degenaration-bot-activity.sql` was unapplied and was applied 2026-08-04. Three remain unapplied: subscriber-config versioning, bot-lifecycle safety, position-bot attribution. |
| Frontend/API contract mismatch | **CONFIRMED — this was the incident.** Four RPC names the app called had no bridge operation. Fixed in `627d05e` and deployed as app-bridge v10. |
| **Other: no writer for the entire product ledger** | **CONFIRMED — this is the deepest cause, and it is C-10.** |

---

## 6. Implementation sequence

Ordered by risk removed per unit of change. Each step is independently shippable and
independently verifiable.

**Step 1 — persist the wallet.** Call `app_user_upsert_wallet` on sign-in with the verified
Privy address. Without this the server cannot name any user's wallet, so no server-side
reconciliation of any kind is possible. Prerequisite for everything below.
*Verified by:* a signed-in user produces exactly one `trading_wallets` row; a second sign-in
does not duplicate it.

**Step 2 — write `trade_intents` at fan-out.** The single most dangerous open hole: until
this exists, `lockedLamports` is always 0 and a user can withdraw capital the worker has
already committed. The intent must be created **before** submission and must carry
`requested_input_base_units` in integer lamports.
*Verified by:* the balance invariant in §4 holds while a buy is in flight; a withdrawal of
the full displayed balance is refused with `locked-capital` while an intent is open.

**Step 3 — write `trade_executions` on submit and confirm.** This alone switches the entire
fee apparatus on, because the accrual triggers already exist and are already tested.
*Verified by:* a reconciled execution produces balanced `commission_ledger_entries` summing
exactly to `platform_fee`; a failed execution produces none.

**Step 4 — open `positions` and `position_lots` at settlement.** Restores the Portfolio
positions tab and makes PnL cards possible, closing Priority 5.
*Verified by:* average entry from lots equals the volume-weighted entry across partial fills.

**Step 5 — `cash_movements` and a `withdrawal_intents` table.** Gives deposits and
withdrawals a history, makes `pending_withdrawal` a real number rather than a constant 0,
and gives the already-generated idempotency key something to be checked against.
*Verified by:* a duplicate withdrawal submission is refused server-side rather than relying
on a disabled button.

**Step 6 — schedule `performance_snapshots`.** Derived only; never a source of truth.

Steps 1 and 2 are the ones that matter for user safety. Steps 3–6 are correctness and
product completeness.

---

## 7. What must not be done

- Do not make `call_executions` or `public.positions` authoritative. They have no fee
  columns and store money as floating point.
- Do not write `commission_ledger_entries` directly. Its balance identity is enforced by
  trigger from `trade_executions`; a direct write bypasses the invariant.
- Do not write `retained_fee_lamports`. It is `GENERATED ALWAYS ... STORED`.
- Do not backfill World A from World B. World B never recorded fees, so any backfilled fee
  would be fabricated.

---

## 8. Implementation progress — 2026-08-04

Steps 1, 2, 3 and 4 are **built and verified locally**. None is deployed.

| Step | State | Evidence |
|---|---|---|
| 1 — persist verified wallet identity | BUILT, verified | `2ef4d03`; `npm run verify:wallet-registration`, 12 properties, 3 control runs |
| 2 — trade intent before capital is committed | BUILT, verified | `fcebe9c`; `npm run verify:trade-intent-fanout`, 12 properties, 3 control runs |
| 3 — withdrawable/tradable derive from one model | BUILT, verified | `fcebe9c`; locked now reads `reserved_lamports`, not a state list |
| 4 — server-side withdrawal idempotency | BUILT, verified | `057e0bd`; `npm run verify:withdrawal-idempotency`, 16 properties, 3 control runs |
| 5 — temporary user protection | assessed, see below | this section |
| 6 — safe verification | DONE | `npm run check` exit 0, 174 tests, 16 verifier suites |

### Step 5 — what protection is warranted, and what would be theatre

| Requested control | Actual state |
|---|---|
| Prevent new live bot activation | **Already prevented**, independently: `lib/trading-release.ts` sets `AUTOMATED_MAINNET_RELEASE.enabled = false`, so `app/api/product/bots/route.ts:40` refuses every active bot with 503. |
| Prevent new automated entries | **Already prevented** by the same gate, and by the worker not being deployed (`worker_leases` = 0, `durable_jobs` = 0, no `pg_cron`). |
| Preserve exits for open positions | **Nothing to preserve.** Both position ledgers hold 0 rows. No exit path was touched. |
| Prevent new deposits while withdrawal is unverified | **Not applicable, and blocking it would be misleading.** There is no deposit mechanism: a "deposit" is the user sending SOL to *their own* Privy wallet, which they can always move again through Privy directly. Blocking a screen that only displays the user's own address would imply custody that does not exist. |
| Concise truthful maintenance message | **Not added, deliberately.** Production runs a build from before any of this work (130 unpushed commits), so no user is currently exposed to a half-applied change. A banner describing a condition that does not exist in the deployed product would be false. |
| Do not manually modify balances | **None were.** Every production query in this work was read-only apart from the two approved deploy steps. |

The one real protection needed is a **deploy-order guarantee**, recorded in §9.

### 9. Deploy order is load-bearing — read before shipping

`app/api/product/portfolio/withdraw/route.ts` now calls
`app_user_open_withdrawal_intent`. That operation exists in the repository and **not** in the
deployed edge function. If the Next.js app is deployed before the migrations and the bridge,
**every withdrawal returns 503 "Withdrawal is temporarily unavailable"** — the same class of
failure as the original incident.

Required order, no exceptions:

1. Apply `degenaration-wallet-registration.sql`, `degenaration-trade-intent-fanout.sql`,
   `degenaration-withdrawal-intents.sql`, and the updated
   `degenaration-user-withdrawals.sql`.
2. Deploy `app-bridge` (now 61 operations) with `verify_jwt: false`.
3. Confirm with `npm run verify:bridge-live` — it must report `deploymentDrift: NONE`.
4. Only then deploy the application.

The failure mode if this is violated is **fail-closed**, not silent: the route returns a
retryable 503 rather than building an unprotected transaction. That is the correct trade —
a brief blocked withdrawal beats an unprotected duplicate one — but it is still an outage,
so the order matters.
