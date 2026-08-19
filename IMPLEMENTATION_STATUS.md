# DegenAration Implementation Status

Updated: 2026-08-18

Status meanings:

- `PASS`: implemented and verified with applicable code, test, browser, auth, and data evidence.
- `PARTIAL`: useful implementation exists but the complete requirement is not met.
- `FAIL`: required implementation is absent or does not work.
- `BLOCKED`: implementation depends on an unavailable secret, provider, decision, or
  prohibited real-money action.

| Requirement | Status | Evidence / blocker |
| --- | --- | --- |
| Master specification and reference audit | PASS | `docs/DEGENARATION_MASTER_SPEC.md`, reference coverage |
| Normal navigation limited to three sections | FAIL | Current shell exposes legacy routes |
| Verified database-backed admin role | PARTIAL | Signed Privy identity email guard exists; DB role absent |
| Bot secret gate reproducible from the repo | BLOCKED | `app_private.bot_secret_ok` existed only in the live project; `supabase/degenaration-bot-secret-gate.sql` adds it, but the owner must insert their own BOT_SHARED_SECRET hash |
| Discord registration and approval | PASS | `/register`, bridges, live channel rows |
| Every mint in a registered channel becomes a call | PASS | `server/bot/parser.js` `parseCalls`, per-mint event versions, `supabase/degenaration-multi-mint-calls.sql` |
| Journal-first ingestion (no pre-trade scanning) | PASS | `app/api/ingest-call/route.ts` records then enriches via `bot_enrich_call_pricing` |
| Push-triggered execution (no poll delay) | PARTIAL | Verified end to end against a running app + worker: journaled at 39ms, pushed at 90ms, bot waited 37ms. Live execution still gated on `DELEGATED_SIGNING` |
| Per-call outcome journal (-50%/+50%/2x/5x) | PARTIAL | Migrations verified against PostgreSQL 16; `source_call_stats` scores calls with no subscriber. Not yet applied to the live project |
| Per-subscription copy filters | PARTIAL | Verified: a filtered call is skipped with its reason, the same call claimed twice claims once. Not yet applied to the live project |
| Discord marketplace | PARTIAL | Approved source cards and measured performance exist |
| Versioned Discord bot builder | FAIL | Entry-only subscription profile |
| Discord creator commission at 70 bps | FAIL | No creator commission ledger |
| KOL marketplace and builder | FAIL | Not implemented |
| KOL publication limit | FAIL | Not implemented |
| KOL creator commission at 20 bps | FAIL | Not implemented |
| Shared scanner adapter registry | FAIL | Provider endpoints are not a versioned registry |
| Fail-closed shared security filters | FAIL | Not implemented |
| Durable order/execution claims | PARTIAL | Limit and Discord entry claims exist; full lifecycle absent |
| Durable TP/SL reconciliation | PARTIAL | Implemented and verified: positions open from the CONFIRMED fill, each exit leg is claim-protected, a failed exit retries, a signed-but-unpersisted exit is never retried, a missing price skips rather than dumps. Mutation-tested. NOT yet proven on a live network — devnet run required before mainnet |
| Distributed rate limiting and job queue | FAIL | Process-local limiter remains |
| Affiliate analytics and referrals | PARTIAL | Assigned Discord links only |
| Payout ledger and request workflow | FAIL | Not implemented |
| Portfolio positions and net PnL | PARTIAL | Call entries now open durable `positions` rows with entry basis and exit ladder; net PnL view still outstanding |
| Deposit/withdrawal history | FAIL | Not implemented |
| Original high-resolution PnL cards | FAIL | Not implemented |
| Complete admin operations console | PARTIAL | Applications, channels, summary, commissions only |
| Automated worker deployment | BLOCKED | Service role and signing secrets not configured |
| Controlled mainnet readiness | BLOCKED | Mainnet signing remains intentionally disabled |
| Independent final release audit | FAIL | Runs after implementation |
