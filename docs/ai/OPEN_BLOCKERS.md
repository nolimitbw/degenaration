# Open blockers

Updated: 2026-08-04

External requirements are E-*. I-* are internal decisions that belong to the owner because
they change which record is authoritative for money — implementable, but not silently.

## Owner decisions

### I-1 — Two position ledgers exist and only one is written

`app_private.positions` and `app_private.position_lots` are the product ledger. The
Portfolio positions tab, the position PnL card, the admin open-position count and the bot
archival guard all read them. **Nothing inserts into either** — there is no INSERT in
`supabase/`, `server/`, `app/` or `lib/`. The worker opens positions in `public.positions`
through the deployed `public.worker_open_position`.

Consequences, in order of severity:

1. The bot archival guard could not fire, so a bot holding open funded positions archived
   cleanly. **Fixed** in `37d5e19` by checking both ledgers, which fails closed whichever
   ledger becomes authoritative.
2. The Portfolio positions tab would stay empty even with a deployed, trading worker.
3. Position PnL cards can never be produced for real trades.
4. `position_lots` is the lot ledger that would yield average entry and exit prices. It is
   never populated, which is the true root cause behind Priority 5 being recorded as
   BLOCKED — not a missing computation, a missing writer.

The decision: which ledger is authoritative? Either the worker writes the product ledger
(entry/exit legs, lots, executions — the richer model the Portfolio was designed against),
or the product read model projects `public.positions` (smaller change, loses the lot
model and with it durable average entry and exit prices).

Claude did not choose. Unifying them changes which record is authoritative for user money,
and no reversible half-measure exists.

**New evidence from the 2026-08-04 live audit, which narrows this decision considerably.**

Every financial table in production is empty — `trade_intents`, `trade_executions`, both
`positions` tables, `position_lots`, `cash_movements`, `commission_ledger_entries`,
`payout_requests` and `public.trades` all have 0 rows. **There is therefore no data to
migrate and no user record to invalidate**, which removes the usual reason this decision is
irreversible. Whichever ledger is chosen, nothing has to be rewritten.

A second finding constrains it further: `app_private.trading_wallets` is empty and
`app_user_upsert_wallet` — although allowlisted and deployed — has **no call site anywhere
in the application**. The server consequently cannot name any user's wallet address; wallet
identity exists only inside the per-request Privy identity token. So today *no* server-side
balance reconciliation is possible for any user, under either ledger. Persisting the wallet
on sign-in is a prerequisite for the authoritative model, not a detail of it.

### I-2 — A credential digest is committed to the repository

`supabase/admin-dashboard-secret-rpcs.sql:14` embeds a SHA-256 digest of `ADMIN_KEY`, and
`app_private.bot_secret_ok` does the same for the bot secret in production. A digest of a
shared secret in a repository is an offline brute-force target; the secret's strength is the
only thing standing between the file and full service-role RPC access.

Not changed here, because rotating `ADMIN_KEY` invalidates every deployed caller
simultaneously (web app, worker, both edge functions) and must be sequenced by the owner.
`bot_secret_ok` was deliberately **not** reproduced when its sibling function was captured
into `supabase/degenaration-legacy-discord-call-ingestion.sql`, so this weakness was not
extended.

## External requirements

| ID | Gate | Exact external requirement | State |
| --- | --- | --- | --- |
| E-0 | **Edge-function redeploy — the funds incident** | The deployed `app-bridge` (v9, 2026-07-28) is missing four operations the app calls, including `app_user_withdrawable_state`. Until it is redeployed, **no user can withdraw and no bot can be saved.** Nothing in the repository can fix this; the correction is one deploy of `supabase/functions/app-bridge/index.ts` to project `uqccguunmjabjheeivhx` with **`verify_jwt: false`** (the deploy default is `true`, and flipping it would 401 every bridge call — a worse outage than today). Full evidence, mechanism and rollback: `docs/ai/DEPLOYMENT_DRIFT_REPORT.md`. Reproduce any time with `npm run verify:bridge-live`. | **BLOCKED — awaiting deployment approval** |
| E-1 | Migration deployment proof | Confirm a safe staging target, or explicitly authorize the locally verified migrations for the intended project. Covers the marketplace parity, subscriber-config versioning, bot-lifecycle safety and bot-activity migrations. All are rerun-safe and preserve every fixture row. Production is unchanged. **Deploy order: the subscriber-config migration must be applied before the current worker build runs**, because `server/engine/store.js` selects `kill_switch`, `subscriber_config_version_id` and `subscriber_config_snapshot`, and PostgREST answers an unknown column with 400. | BLOCKED |
| E-2 | Live Discord command and ingestion proof | Supply the configured Discord application credentials to the worker/test environment and a dedicated guild/channel where controlled fixtures may be posted. | BLOCKED |
| E-3 | Production worker | Provide a worker host, RPC/indexer configuration, Privy delegated-signing credentials, health alert destination, and deployment authorization. | BLOCKED |
| E-4 | Mainnet fee collection | Create/configure the correct Jupiter output-mint fee account or referral account; a wallet address alone is not a valid per-mint fee account. | BLOCKED |
| E-5 | Mainnet activation | Explicit controlled-mainnet authorization after staging, signer, reconciliation, provider, fee, withdrawal, alerting, and emergency-control gates pass. | BLOCKED |
| E-6 | Authenticated browser evidence | Provide a non-production Privy test identity with a delegated dev/staging wallet, or an existing authenticated test browser session. No production funds are required. | BLOCKED |
