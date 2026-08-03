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
