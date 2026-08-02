# Open blockers

Updated: 2026-08-02

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

## External requirements

| ID | Gate | Exact external requirement | State |
| --- | --- | --- | --- |
| E-1 | Migration deployment proof | Confirm a safe staging target, or explicitly authorize the locally verified migrations for the intended project. Covers the marketplace parity, subscriber-config versioning, bot-lifecycle safety and bot-activity migrations. All are rerun-safe and preserve every fixture row. Production is unchanged. **Deploy order: the subscriber-config migration must be applied before the current worker build runs**, because `server/engine/store.js` selects `kill_switch`, `subscriber_config_version_id` and `subscriber_config_snapshot`, and PostgREST answers an unknown column with 400. | BLOCKED |
| E-2 | Live Discord command and ingestion proof | Supply the configured Discord application credentials to the worker/test environment and a dedicated guild/channel where controlled fixtures may be posted. | BLOCKED |
| E-3 | Production worker | Provide a worker host, RPC/indexer configuration, Privy delegated-signing credentials, health alert destination, and deployment authorization. | BLOCKED |
| E-4 | Mainnet fee collection | Create/configure the correct Jupiter output-mint fee account or referral account; a wallet address alone is not a valid per-mint fee account. | BLOCKED |
| E-5 | Mainnet activation | Explicit controlled-mainnet authorization after staging, signer, reconciliation, provider, fee, withdrawal, alerting, and emergency-control gates pass. | BLOCKED |
| E-6 | Authenticated browser evidence | Provide a non-production Privy test identity with a delegated dev/staging wallet, or an existing authenticated test browser session. No production funds are required. | BLOCKED |
