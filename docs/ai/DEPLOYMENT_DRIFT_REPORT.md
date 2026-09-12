# Deployment drift report — the "funds visible but unusable" incident

Produced 2026-08-04 against the live Supabase project `uqccguunmjabjheeivhx`
(`nobodychill's Project`, ap-southeast-1). Every claim below is backed by a read-only
query or an unauthenticated probe, both reproduced in this document. No secret is printed
and no production state was changed.

---

## 0. The one-paragraph answer

The Next.js app reaches the database through a single Supabase edge function, `app-bridge`,
which carries a **hand-maintained allowlist of permitted RPC names**. Any name absent from
that allowlist is rejected with `400 unknown operation` before the database is ever
consulted. Four names the application calls are missing from that allowlist — two because
production is running a build from 2026-07-28 that predates them, and two because they were
never added to the repository file at all. One of the four is
`app_user_withdrawable_state`, which is the only source of the withdrawal screen's
availability figures. The Portfolio balance the user sees does not go through the bridge at
all: it is a direct Solana RPC read. That asymmetry is the whole incident — **one number
comes from the chain and works, the other comes through the bridge and does not.**

---

## 1. What the deployed system actually is

| Layer | State |
|---|---|
| Edge function `app-bridge` | version **9**, ACTIVE, deployed **2026-07-28T09:19:21Z**, `verify_jwt: false` |
| Edge function `bot-bridge` | version **3**, ACTIVE, deployed **2026-07-28T09:10:13Z** |
| Repository `app-bridge` source | **54** allowlisted operations |
| Deployed `app-bridge` source | **52** allowlisted operations |
| Database functions in `public` + `app_private` | 106 |
| Functions defined in `supabase/*.sql` | 116 |

The deployed edge function is **three commits stale**. The commits that changed it after the
last deploy are `dcc216a` (2026-07-29), `47dec45` (2026-07-29) and `a0c8359` (2026-08-01).
None of the three has ever been deployed.

### Environment and authorization — verified, not assumed

The deployed function reads only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the
environment. Both are present and correct: the probe in §2 reaches the database and receives
a genuine `42501` from `admin_secret_ok`, which is only possible if the service-role client
was constructed successfully.

Every RPC involved is `SECURITY DEFINER` with `search_path = ''` and an ACL of
`postgres=X/postgres | service_role=X/postgres` — that is, `anon` and `authenticated` are
revoked, exactly as the repository migrations specify. **No RLS or grant change is required
by any fix in this report.**

---

## 2. Reproducing the drift without transmitting a credential

The deployed handler checks the operation name *before* it uses `p_secret`:

```ts
const allowed = Object.hasOwn(operations, operation) ? operations[operation] : null;
if (!allowed) return json({ error: "unknown operation" }, 400);
```

So a deliberately invalid secret separates the two failure modes cleanly:
**400 = the operation does not exist in the deployed allowlist**, **401 = it exists and the
secret was rejected by the database**.

```bash
URL="https://uqccguunmjabjheeivhx.supabase.co/functions/v1/app-bridge"
for op in app_user_portfolio_summary app_user_withdrawable_state \
          app_user_get_bot_activity app_user_set_risk_acceptance \
          app_user_save_mainnet_bot_draft app_user_save_bot; do
  curl -s -o /tmp/b -w "$op %{http_code} " -X POST "$URL" \
    -H 'content-type: application/json' \
    -d "{\"operation\":\"$op\",\"p_secret\":\"deliberately-invalid-probe\"}"; cat /tmp/b; echo
done
```

Observed 2026-08-04:

```
app_user_portfolio_summary       401 {"error":"unauthorized"}       <- control: reaches the DB
app_user_affiliate_summary       401 {"error":"unauthorized"}       <- control: reaches the DB
app_user_save_bot                401 {"error":"unauthorized"}       <- control: reaches the DB
app_user_withdrawable_state      400 {"error":"unknown operation"}  <- MISSING
app_user_get_bot_activity        400 {"error":"unknown operation"}  <- MISSING
app_user_set_risk_acceptance     400 {"error":"unknown operation"}  <- MISSING
app_user_save_mainnet_bot_draft  400 {"error":"unknown operation"}  <- MISSING
```

The controls are what make this non-vacuous: if the probe returned 400 for everything, the
test would prove nothing.

---

## 3. The four defects, in two classes

### Class B — deployment drift (repository is correct, production is stale)

| # | Operation | SQL function in prod? | Allowlisted in repo since | Deployed? |
|---|---|---|---|---|
| B-1 | `app_user_withdrawable_state` | **yes**, body identical to repo | `47dec45` 2026-07-29 | **no** |
| B-2 | `app_user_get_bot_activity` | **no** — never applied | `a0c8359` 2026-08-01 | **no** |

B-1 is fixed by redeploying the edge function alone. **B-2 additionally requires applying
`supabase/degenaration-bot-activity.sql`** — redeploying without it would move the failure
from `400 unknown operation` to `502 bridge operation failed`, which is not an improvement.

### Class A — repository defects (broken in *every* environment, including a fresh deploy)

| # | Operation | Caller | SQL function in prod? | Ever allowlisted? |
|---|---|---|---|---|
| A-1 | `app_user_save_mainnet_bot_draft` | `app/api/product/bots/route.ts:52` | yes | **never, in any commit** |
| A-2 | `app_user_set_risk_acceptance` | `app/api/user/profile/route.ts:64` | yes | **never, in any commit** |

`git log -S` over `supabase/functions/app-bridge/index.ts` returns no commit for either
name. These are not drift — redeploying today's `main` would leave both broken. They are
fixed in the repository by this work.

### Migration drift, found while checking the above

Three migration files in `supabase/` define functions that do not exist in production:

| File | Functions unapplied |
|---|---|
| `degenaration-subscriber-config-versioning.sql` | 9 |
| `degenaration-bot-lifecycle-safety.sql` | 2 |
| `degenaration-bot-activity.sql` | 1 |

`degenaration-position-bot-attribution.sql` (commit `db205e1`) is also unapplied. And two
functions exist in production with no definition anywhere in `supabase/`:
`app_private.bot_secret_ok` and `public.bot_ingest_discord_call`.

These are recorded here, not fixed here. They are outside the P0 blast radius and applying
an unverified migration to production is prohibited.

---

## 4. Does this explain each reported symptom?

### 4.1 Portfolio shows a balance — **yes, and the balance is real**

`components/product/PortfolioDashboard.tsx:133` reads `walletPortfolio?.sol`, which comes
from `fetchPortfolio()` → `GET /api/portfolio` → `app/api/portfolio/route.ts:33`, a direct
`getBalance` JSON-RPC call against Solana. **No bridge, no database, no authentication.**
The number is a true on-chain reading of the user's own wallet and is unaffected by any
drift.

### 4.2 The balance is not withdrawable — **yes, fully explained**

```
WithdrawModal opens
  -> GET /api/product/portfolio/withdraw?wallet=…
     -> lockedLamports()                     route.ts:51
        -> callPrivyRpc("app_user_withdrawable_state")
           -> deployed bridge: 400 "unknown operation"
     -> callAppBridge: !response.ok          app-bridge.ts:34  => { ok: false, status: 502 }
     -> lockedLamports returns { ok: false }
  -> resolveState returns 503                route.ts:72
     "Balance is temporarily unavailable. Try again in a moment."
  -> modal: availability stays null          PortfolioDashboard.tsx:399
     -> spendable = 0n                       :424
     -> 25/50/75/Max buttons disabled        :498
     -> "Withdraw SOL" button disabled       :504
```

The user sees a funded Portfolio and a withdrawal dialog reporting `0 SOL` available with
every control dead. The error copy is honest about being temporary, but the condition is
permanent until the function is redeployed.

### 4.3 The balance is not tradable — **partly, and the bot half is worse than reported**

Two distinct paths, with opposite verdicts.

**Manual swap works and is untouched.** `lib/useExecuteBuy.ts` → `POST /api/swap` builds an
unsigned Jupiter transaction. `app/api/swap/route.ts` has no bridge dependency, no auth gate
and no balance gate. The trade is then recorded through `app_user_insert_trade`, which is
deployed. A user on `/terminal` can still trade.

**Bot creation is completely broken — every branch fails.** `app/api/product/bots/route.ts`
has exactly two outcomes:

- `status: "active"` → rejected at line 40 with `503 AUTOMATION_RELEASE_LOCKED`, because
  `lib/trading-release.ts` sets `enabled: false`. This one is deliberate and its user-facing
  reason is truthful.
- anything else → `app_user_save_mainnet_bot_draft` at line 52 → **defect A-1** →
  `400 unknown operation` → the user is shown *"This is temporarily unavailable. Please try
  again shortly."*

So there is no way to save a bot at all. That is the "cannot use the funds to trade"
complaint for anyone who went to Bots rather than the terminal.

### 4.4 A fourth symptom nobody reported, confirmed in the data

`app/onboarding/page.tsx:30` gates step 0 on `saveProfileLimits({ risk_accepted: true })`,
which reaches **defect A-2** and fails. The handler then shows *"Sign in before accepting the
risk disclosure"* — to a user who is already signed in — and refuses to advance the wizard.

The database corroborates this independently: **`public.privy_profiles` has 0 rows**, and
`risk_accepted` is NULL for all 5 users. No user has ever cleared onboarding step 0, because
the operation behind it has never existed.

---

## 5. Balance reconciliation for the affected accounts

Requested reconciliation: displayed / on-chain / principal ledger / available / locked /
pending trades / pending withdrawals.

### 5.1 There is no custody transfer, so there are no trapped funds

The product is non-custodial end to end and there is no platform deposit account:

- `DepositModal` (`PortfolioDashboard.tsx:359`) displays `wallet`, which is
  `getSolanaAddress(user)` — **the user's own Privy embedded wallet**. "Depositing" means
  the user funds their own wallet; nothing is transferred to DegenAration.
- `POST /api/product/portfolio/withdraw` returns an **unsigned** transfer for the user to
  sign. The server holds no keys.
- A repository-wide search for `TREASURY|CUSTODY|DEPOSIT_ADDRESS|OMNIBUS|HOT_WALLET` finds
  no custodial account. `/terminal` states custody as "Wallet-signed".

**The affected users' funds are in wallets they control and were never held by the
platform.** They remain movable from Privy's own interface while the app's Withdraw button
is broken. This is a broken product surface, not a loss of funds — and it should be
described that way.

### 5.2 The internal ledger side of the reconciliation

Live counts, 2026-08-04:

| Table | Rows |
|---|---|
| `app_private.app_users` | 5 |
| `app_private.trade_intents` | 0 |
| `app_private.trade_executions` | 0 |
| `app_private.positions` | 0 |
| `public.positions` | 0 |
| `app_private.cash_movements` | 0 |
| `app_private.commission_ledger_entries` | 0 |
| `app_private.payout_requests` | 0 |
| `public.trades` | 0 |
| `public.privy_profiles` | 0 |
| `app_private.trading_wallets` | 0 |

The invariant `total reconciled principal = available + legitimately locked + pending
movements` therefore holds at `0 = 0 + 0 + 0` on the internal ledger, with no unexplained
difference — because **no principal has ever been recorded internally at all**. Nothing is
missing; nothing was ever written.

### 5.3 The gap this exposes

`app_private.trading_wallets` is empty, and `app_user_upsert_wallet` — although allowlisted
and deployed — has **no call site anywhere in the application**. The consequence is that
*the server cannot name any user's wallet address*. Wallet identity exists only inside the
Privy identity token presented per request.

So the reconciliation the incident response asks for is **not computable from the database
in its current shape**: there is no stored address to read a chain balance against. This is
a real gap, recorded rather than papered over, and it belongs to the C-10 authoritative-model
work.

---

## 6. Protective measures — assessed, and why none is warranted

| Requested protection | Finding |
|---|---|
| Stop accepting deposits while withdrawals are down | **Not applicable.** There is no deposit mechanism to stop. A "deposit" is the user funding their own wallet, from which they can always withdraw directly through Privy. |
| Block new live entries while accounting is inconsistent | **Already blocked**, and independently: `AUTOMATED_MAINNET_RELEASE.enabled === false` refuses every active bot, and no bot can be saved at all (A-1). Manual swaps remain available and are correctly accounted, so blocking them would remove function without removing risk. |
| Preserve exit management for open positions | **Nothing to preserve.** Both position ledgers are empty. |
| Confirm funds present on-chain / in custody | **Confirmed present, in user-controlled wallets.** See §5.1. |
| Do not edit balances manually | **No balance was edited.** Every query in this report is read-only. |

Adding a "withdrawals unavailable" banner was considered and rejected: it would be *less*
truthful than the current state, since the funds are withdrawable — through Privy — and
`FINAL_LAUNCH_SPEC.md` §12.4 and §23 both forbid presenting a withdrawal as feature-disabled.

---

## 7. What fixes what

| Defect | Fixed by a repository change | Requires applying a migration | Requires an edge-function deploy |
|---|---|---|---|
| A-1 `app_user_save_mainnet_bot_draft` | yes | no | yes |
| A-2 `app_user_set_risk_acceptance` | yes | no | yes |
| B-1 `app_user_withdrawable_state` | already correct | no | **yes — this alone restores withdrawal** |
| B-2 `app_user_get_bot_activity` | already correct | **yes** (`degenaration-bot-activity.sql`) | yes |

All four are carried by **one** edge-function deployment. B-2 must not be deployed until its
migration is applied, or its failure merely changes shape.

The recurrence guard is `scripts/check-bridge-contract.mjs`, wired into `npm run check`: it
fails the build when an RPC name referenced by the application has no allowlist entry, or an
allowlist entry's parameters do not match the SQL signature. It would have caught A-1, A-2
and B-2 at authoring time. It cannot detect B-1-style drift, because "what is deployed" is
not knowable offline — that requires the live probe in §2, which
`npm run verify:bridge-live` performs.
