# Implementation status

Updated: 2026-08-04 (second pass: exits, allocation, snapshots, admin detail, §9 routes)

The §4 full scan is recorded in `docs/ai/FULL_SCAN_2026-08-04.md` — writer coverage per
table, then each area with how it was observed. Re-scan an area only when its code changes.

`PASS` requires reproducible evidence. Deployment-dependent behavior remains `PARTIAL` or
`BLOCKED` even when its local implementation passes.

## Live incident, 2026-08-04

Users reported funds visible in Portfolio that they could neither trade nor withdraw. The
cause is **deployment drift, not a defect in the current code**: the deployed `app-bridge`
edge function is frozen at 2026-07-28 and rejects four operations the app calls. Two of the
four were additionally never in the repository allowlist at all, and those are fixed in
`627d05e`. Full evidence: `docs/ai/DEPLOYMENT_DRIFT_REPORT.md`.

**No funds are at risk.** The product is non-custodial, there is no platform deposit
account, and every affected user's SOL sits in a Privy wallet they control. This is a broken
product surface, not a loss of funds.

| Symptom | Status | Evidence |
| --- | --- | --- |
| Portfolio shows a balance | Correct — direct on-chain `getBalance`, no bridge involved | `app/api/portfolio/route.ts:33` |
| Cannot withdraw | **FAIL — blocked in production only** | `app_user_withdrawable_state` returns 400; modal shows 0 spendable with every control disabled. Repository is correct; needs E-0. |
| Cannot save any bot | **FAIL — was broken in every environment** | Draft branch hit an operation that was never allowlisted; active branch is separately refused by `AUTOMATED_MAINNET_RELEASE`. Repo fixed in `627d05e`; needs E-0 to take effect. |
| Onboarding step 0 never completes | **FAIL — was broken in every environment** | `app_user_set_risk_acceptance` never allowlisted; `public.privy_profiles` has 0 rows for all 5 users. Repo fixed in `627d05e`; needs E-0. |
| Recurrence guard | PASS | `npm run check:bridge-contract` in `npm run check`; two control runs confirm it fires. `npm run verify:bridge-live` probes the deployed function without transmitting a credential. |

| Priority | Requirement | Status | Evidence / exact remainder |
| --- | --- | --- | --- |
| 1 | Subscriber configuration and copy safety | PASS (contract) | `0d40b15`. `npm run verify:subscriber-config` runs 19 checks against a fixture generated from the captured production schema, including the `double precision` copy path, clamp-before-cast, refusal of an invalid configuration, a discarded forged snapshot, a subscription with no owner being non-executable, `service_role` writing with `app_private` closed to it, and an invoker-rights control that must fail. Five migration defects and one worker defect were found and fixed; the pre-fix migration is proven to abort on production types. **Not applied to production** (E-1). |
| 2 | Discord marketplace migration safety | PASS | `10942cf`. Fixture rebuilt from production shapes, which exposed that the seven-day integration grace window was unreachable in every prior run and that orphaned calls were impossible to model. Both sides of the grace window and an orphaned call are now asserted. Production is intentionally unchanged. |
| 3 | Authenticated Discord/KOL lifecycle | PARTIAL | `a0c8359` covers create, hydrate, edit, immutable versions, activate, pause, resume, safe archive, terminal archive, KOL duplication, Discord source uniqueness, position snapshot retention, owner denial and the owner-only journal. `37d5e19` fixes the archive guard, which read a ledger nothing writes and therefore never fired — proven by control run. Authenticated HTTP/browser, provider-failure, insufficient-balance and responsive evidence remain (E-6). |
| 4 | Discord ingestion and journal | PARTIAL | Static and unit coverage exists. Live application-command state and a controlled event-to-marketplace proof need E-2. |
| 5 | Durable losing-trade PnL | **PASS (data layer)** | The root cause was a missing writer, twice over. `a428857` makes a sell consume its lots FIFO, release cost basis in proportion, realize PnL and close the position — before it, `realized_pnl_lamports` was structurally zero for every user. `cbeabe5` then writes the `performance_snapshots` row Portfolio reads. `verify:exit-settlement` proves a losing trade is durable (+0.5 then -0.6 SOL, win rate 5000 bps); `verify:performance-snapshots` proves an unpriced exit is counted apart rather than as a loss. Migrations not yet applied — `PENDING_DEPLOYMENT.md`. |
| 6 | Principal withdrawals | **FAIL in production** (repository PARTIAL) | Local-validator transaction path passes, and `npm run verify:withdrawable-state` now proves the authoritative locked figure against real PostgreSQL across 12 properties — every in-flight buy state locks, no terminal or settled state does, cross-account isolation holds, `anon`/`authenticated` are denied, and Max leaves exactly the 15890880-lamport reserve. **But no user can withdraw at all until E-0 is deployed.** Four required cases are recorded as unsatisfiable rather than faked: no pending withdrawal is tracked, the idempotency key is generated and discarded, no withdrawal record is persisted so nothing reconciles, and `cash_movements` stays empty. |
| 7 | Fee and reward reconciliation | **PASS (data layer)** | The allocation layer was correct and attached to nothing: settlement hardcoded creator and referral to 0 and never wrote either identity, so with the fee enabled the ledger would have shown 200 bps of platform revenue and nothing else, indefinitely, without erroring. `7480b4c` resolves the Discord creator, the KOL creator and a verified unexpired referrer at settlement and snapshots each rate. `verify:creator-referral` drives the full chain to four balanced ledger entries summing to exactly the collected fee, and proves the three clamps: zero fee allocates nothing, creator cannot exceed the platform rate, referral cannot eat the creator's share. Collection itself still needs E-4. |
| 8 | Worker readiness | PARTIAL | Durable execution paths exist. Provider credentials, worker host, signer, fee destination and alerting remain gated (E-3, E-4). Deploy order for E-1 is recorded. |
| 9 | Mizar-familiar UX review | PARTIAL | Builder and Discord marketplace evidence exists at 390/1024/1440. Authenticated primary surfaces and a full 768/1024/1440/390 pass remain (E-6). |
| 10 | Independent release review | PARTIAL | `npm run check` exits 0 with 174 tests and all five verifiers. Codex has not reviewed `0d40b15`, `10942cf` or `37d5e19`. |

## Method note

Priorities 1, 2 and 3 each surfaced defects that had previously passed verification. In all
three cases the cause was the same: fixtures were hand-written and had drifted from
production. Fixtures are now generated from `scripts/lib/production-schema.mjs`, and each
verifier asserts parity before and after the migration under test.

Three findings were each proven by a control run that fails without the fix, so none rests
on inspection alone:

- the pre-fix subscriber-config migration aborts on production column types,
- invoker-rights trigger functions are denied `app_private` as `service_role`,
- the previous archive guard permits archiving a bot with a live worker position.
