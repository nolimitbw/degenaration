# Current continuation handoff

Written 2026-08-04 by Claude Code, continuing after the Codex usage limit. Read this before
touching anything. Update it when you stop.

## Position

| | |
|---|---|
| Branch | `claude/continue-codex-unfinished-2026-08-02` |
| HEAD at start of this session | `db205e1` |
| Working tree at start | clean except `docs/activity-log.md` (excluded by policy) |
| Codex | unavailable (usage limit); stop-time review gate disabled for this repo only |
| Live database | Supabase `uqccguunmjabjheeivhx`, reachable read-only via MCP |

Commits preserved and not rewritten, oldest first: `3dce6b8`, `18f4f23`, `7c83d48`,
`be55ced`, `0d40b15`, `10942cf`, `37d5e19`, `9e096a1`, `db205e1`.

## What this session established

The reported incident — *users see deposited funds in Portfolio but cannot trade with them
or withdraw them* — is **fully diagnosed and proven against production**. The complete
evidence is in `docs/ai/DEPLOYMENT_DRIFT_REPORT.md`. In short:

1. Portfolio's balance is a direct on-chain `getBalance` read (`app/api/portfolio/route.ts`)
   and is correct.
2. The withdrawal screen's availability comes from `app_user_withdrawable_state`, which the
   **deployed** `app-bridge` edge function (v9, frozen at 2026-07-28) does not know. It
   answers `400 unknown operation`, which becomes a 503 and leaves the modal at `0 SOL` with
   every control disabled.
3. Bot creation fails on **both** branches: active bots are refused by the deliberate
   `AUTOMATED_MAINNET_RELEASE` lock, and drafts call
   `app_user_save_mainnet_bot_draft`, which has **never** been in the bridge allowlist in
   any commit.
4. Onboarding step 0 has never worked for anyone, for the same reason
   (`app_user_set_risk_acceptance`). `public.privy_profiles` has 0 rows, which corroborates
   it independently.

**No user funds are at risk.** The product is non-custodial, there is no platform deposit
account, and every affected user's SOL is in a Privy wallet they control and can move
directly. This is a broken product surface, not a loss of funds — say it that way.

## Database state, live

`app_users`=5, `subscriptions`=1, `approved_groups`=2, `calls`=1, `affiliate_profiles`=5.
Every financial table is empty: `trade_intents`, `trade_executions`, both `positions`
tables, `cash_movements`, `commission_ledger_entries`, `payout_requests`, `trades`,
`privy_profiles`, `trading_wallets`, `performance_snapshots`, `limit_orders` — all 0.

Three migration files are **not applied** to production:
`degenaration-subscriber-config-versioning.sql`, `degenaration-bot-lifecycle-safety.sql`,
`degenaration-bot-activity.sql`, plus `degenaration-position-bot-attribution.sql` from
`db205e1`. Do not apply any of them to production unverified.

## Work completed this session

- `docs/ai/DEPLOYMENT_DRIFT_REPORT.md` — the full Phase 1 drift report and reconciliation.
- `supabase/functions/app-bridge/index.ts` — added the two missing allowlist entries (A-1,
  A-2) with parameter lists checked against the deployed SQL signatures.
- `scripts/check-bridge-contract.mjs` — offline guard against this whole defect class,
  wired into `npm run check`.
- `scripts/verify-bridge-live.mjs` — the live probe from the drift report, as a repeatable
  command (`npm run verify:bridge-live`). Read-only; sends a deliberately invalid secret so
  no credential is transmitted.
- `scripts/verify-withdrawable-state.mjs` — the withdrawal RPC exercised against real
  Postgres for every case the incident response required.

## Blocked on the owner

**One production deployment is required and has not been performed.** Redeploying the
`app-bridge` edge function is the only action that restores withdrawal. It is presented for
approval with target, versions, rollback and expected effect — see the approval gate in the
session, and `docs/ai/OPEN_BLOCKERS.md`.

Nothing else in this incident is reachable from inside the repository.

## Exact next action

1. Obtain approval for the `app-bridge` redeploy (Phase 5).
2. After deploying, re-run `npm run verify:bridge-live` — all four operations must move from
   400 to 401.
3. Then continue C-10 (`docs/ai/OPEN_BLOCKERS.md` I-1): one authoritative accounting model.
   The live finding that `app_private.trading_wallets` is empty and `app_user_upsert_wallet`
   has no call site anywhere belongs to that work — the server currently cannot name any
   user's wallet, so no server-side balance reconciliation is possible at all.

## Do not

- Do not apply the three unapplied migrations to production without verifying them first.
- Do not deploy the whole repository when only the edge function needs deploying.
- Do not add a "withdrawals unavailable" banner. The funds *are* withdrawable via Privy, and
  `FINAL_LAUNCH_SPEC.md` §12.4 and §23 forbid presenting withdrawal as feature-disabled.
- Do not treat this as a loss-of-funds incident in any user-facing copy.

---

## Execution state against the final spec — 2026-08-04

Authoritative instruction is now
`docs/ai/DEGENARATION_FINAL_FULLSCAN_FINANCE_ADMIN_MIZAR_UI_CLAUDE_PROMPT.md` (in repo).

### §5 financial gate — status per sub-section

| Spec | State | Evidence |
|---|---|---|
| 5.1 one authoritative balance model | **DONE** | `c18f4a8`, `docs/ai/ACCOUNTING_MODEL.md`. `app_private` is authoritative; decision made from a full writer/reader inventory |
| 5.2 wallet identity | **DONE, deployed** | `2ef4d03`; migration live; address taken only from the verified Privy token |
| 5.3 durable trade intents | **DONE, deployed** | `fcebe9c`; reservation/release proved on live production in a rolled-back probe |
| 5.4 execution and settlement | **NOT BUILT — the keystone** | `trade_executions`, `positions`, `position_lots` still have **no writer** |
| 5.5 principal withdrawal | **DONE, awaiting app promotion** | `057e0bd`; DB+bridge live; app build `78a4af0` pushed, unpromoted |
| 5.6 platform fee | **NOT BUILT** | accrual triggers hang on `trade_executions`, which nothing writes → **0 bps collected** |
| 5.7 financial proof | **PARTIAL** | 16 verifier suites green; no end-to-end proof possible until 5.4 exists |

### The single next unit of work

**Build the §5.4 writer.** It is the keystone for four separate spec sections:

- §5.6 platform fee — the accrual triggers already exist and are tested; they fire the moment
  a `trade_executions` row is written. No new fee logic is needed.
- §8 admin console client volume — has nothing to sum until executions exist.
- §13 Portfolio positions/history — reads `app_private.positions`, which has no writer.
- PnL cards — need `position_lots` for average entry/exit; the table is entirely dead.

Concretely: on `call_executions.status -> 'succeeded'`, write a `trade_executions` row carrying
`gross_notional_lamports` and the bps snapshot, then open `app_private.positions` +
`position_lots`. Follow the trigger pattern already proven in
`degenaration-trade-intent-fanout.sql` — bind to the queue row rather than editing
`worker_settle_call_execution`, for the same reason recorded there.

### Blocked on the owner, not on code

| Item | Needs |
|---|---|
| Withdrawal incident closure | promote `78a4af0` (branch `release/funds-runtime-hotfix-2026-08-04`) |
| Auto-trading (§6) | worker host + Privy delegated-signing credentials (E-3) |
| Fee collection (§5.6) | a valid Jupiter output-mint fee account (E-4); `PLATFORM_FEE_ACCOUNT` is unset |
| Discord ingestion (§7) | bot deployed with credentials (E-2); `raw_signals` = 0 |

None of these is reachable from inside the repository. Everything else in the spec — §5.4,
§8 admin console, §11–13 Mizar UI, PnL cards — is internally solvable and should be executed
in that order.

---

## Session close — 2026-08-04

13 commits, every one passing `npm run check` (174 tests, 18 verifier suites, lint,
visible-copy, production build).

| Spec | State |
|---|---|
| §5.1–5.3, §5.5 | DONE, **deployed to production** |
| §5.4 settlement writer | DONE (`d554243`) — the keystone §5.6, §8, §13 and PnL cards waited on |
| §5.6 platform fee | Unblocked, collects 0 bps until **E-4** |
| §8 admin console | DONE — SQL (`a72b345`), bridge (`227e902`), API (`9d6bc38`), UI (`889ca56`) |
| §9 onboarding | DONE (`34677d9`) — 5 steps → 3 |
| §J PnL cards | Built in `be55ced`; share coverage completed (`ea9014c`) |
| §13 setup-order parity | Verified against source (`0ac17ec`), incl. one documented divergence |
| §7 Discord/KOL | UI built (`67798ef`); **no data** — `raw_signals` = 0 until **E-2** |
| §6 auto-trading | Cannot be verified without **E-3** |
| §11–12 design system | Built across earlier commits — semantic tokens (66 files), `DegenBackdrop`, icon set, responsive audit at 4 widths |

Production this session: 4 migrations applied and verified, `app-bridge` v9 → v11,
release branch `release/funds-runtime-hotfix-2026-08-04` @ `78a4af0` pushed and **unpromoted**.

### Why the remaining rows are not code problems

`MIZAR_PARITY_MATRIX.md` has ~15 rows reading "implemented; authenticated save remains".
That phrase is the whole story: the UI exists and the evidence does not. Converting those to
verified needs **E-6** — a test Privy identity with a delegated devnet wallet. No further
code closes them, and marking them verified without a session would be a false claim.

### Order of value for the owner

1. Promote `78a4af0` — closes the withdrawal incident.
2. **E-6** test Privy identity + devnet wallet — converts ~15 parity rows to verified.
3. **E-3** worker host + signing credentials — §6.
4. **E-2** Discord bot deploy — §7 data.
5. **E-4** Jupiter fee account — §5.6 revenue.
