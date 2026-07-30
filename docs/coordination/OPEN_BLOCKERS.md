# Open blockers

Only genuine external blockers belong here: missing credentials, unavailable provider
access, or irreversible business decisions. Everything else is implementation work.

## B-1 — `PLATFORM_FEE_ACCOUNT` is not set (blocks fee collection end-to-end)

Every fee path is gated on this env var. When unset, `platformFeeBps` resolves to `0`
and `app/admin/commissions/page.tsx:142` surfaces "Fees are currently disabled in
production". Fee logic, ledger allocation, and tests can all be implemented and verified
against fixtures without it, but **no fee is actually collected in production until the
owner supplies the fee wallet address.**

Required action: owner sets `PLATFORM_FEE_ACCOUNT` to the destination fee wallet.
Impacts release gate: revenue collection. Status: **BLOCKED — owner action.**

## B-2 — Delegated-signing secrets and a worker host

The 24/7 automation worker in `server/` is code-complete and tested but watch-only. It
needs owner-held signing configuration and a host before automated execution can run.
Does not block UI, fee, withdrawal, or journaling work.

Required action: owner supplies signing configuration and selects a host.
Status: **BLOCKED — owner action.**

## B-3 — Mainnet execution authorization

Spec §12 and §13 describe real-money behavior. Development and automated tests remain on
`paper` / `solana-devnet` per §2.11. Enabling `solana-mainnet` requires explicit owner
authorization and controlled review; it will not be enabled autonomously.
Status: **BLOCKED — owner decision, by design.**

## B-4 — RESOLVED: database access existed; requirement 6 is diagnosed

**Corrected 2026-07-30.** This blocker was wrong. A Supabase MCP server is connected to
the project and was available the whole time; I asserted the limitation without testing it.

Requirement 6 is now diagnosed from live data: `approved_groups`=2 and `call_channels`=2,
but `calls`=1, `raw_signals`=0, `market_snapshots`=0, `performance_snapshots`=0,
`durable_jobs`=0, `worker_leases`=0. The single call arrived via the `/alpha` slash command,
has `last_scanned_at`=NULL, and identical called/peak/latest prices.

**The worker has never run, and passive channel ingestion has produced nothing.** The
dashes are accurate. The fix is deploying the worker, not changing code.

## B-4 (original text, retained for the record) — No live database access

Requirement 6 (§9.8) asks why two approved Discord sources show no measured performance.
The schema exists (`raw_signals`, `parsed_signals`, `signal_deliveries`,
`performance_snapshots`), so the question is which pipeline stage produces nothing —
ingestion, parsing, eligibility, baseline pricing, sampling, or aggregation. Answering
it honestly requires querying the live database; source inspection alone cannot
distinguish "no messages arrived" from "messages arrived but the parser rejected them".

Required action: Supabase read access (or exported counts per stage for the two guilds).
Status: **BLOCKED — needs database access.** Do not replace `--` with fabricated values.

## B-5 — Lint gate needs a dependency decision

Release gate §24 lists lint. This repository has no ESLint config, no ESLint dependency,
and no lint script. Adding one is a new external dependency, which the repository rules
require the owner to approve, and enabling it on an existing 66-file codebase will
surface a backlog of pre-existing findings that must be triaged rather than bulk-ignored.

It was not added unilaterally. Type safety is already enforced by strict `tsc`, and the
suite additionally gates fee invariants, the journal contract, Discord command
uniqueness, and public copy.

**RESOLVED 2026-07-30** without adding a dependency. `scripts/check-code-quality.mjs`
enforces the rules this specification calls release-blocking — console.log, unresolved
work markers, `@ts-ignore`, empty catch blocks, floating-point money math, basis-point
division outside BigInt, `as any` on money paths, and handler-less buttons — across 218
files with zero dependencies, wired in as `npm run lint`. It found and fixed 5 real
problems. Strict `tsc` continues to cover type safety.

Adopting full ESLint remains available if the owner wants broader style coverage, but the
release gate no longer depends on that decision.

## B-6 — The worker reads legacy tables that carry no safety configuration

The bot builder persists 36 safety filters into `safetyFilters` on the bot config, and
`server/engine/safety.js` now enforces them. But the worker's execution paths
(`copy.js`, `calls.js`, `index.js`) load subscribers from the legacy `copy_subscriptions`
and `subscriptions` tables, whose SELECT lists contain no safety configuration at all —
only size, slippage, caps, and TP/SL. The new configuration lives in
`bot_config_versions`.

So enforcement exists and is tested, but nothing yet hands it a user's filters at
execution time. `rugCheck` now returns `evidence` precisely so a caller can evaluate each
subscriber's own filters without re-fetching, and it applies filters when a `safety`
argument is supplied — the remaining work is migrating the worker's subscriber loading
onto the bot config tables.

That migration changes execution behaviour and cannot be verified without a database, so
it was not done blind.

Required action: database access, then migrate `loadSubscribers` / `loadGroupSubscribers`
to join `bot_profiles` → `bot_config_versions` and pass `safetyFilters` into `rugCheck`
per subscriber.
Status: **BLOCKED — needs database access.**

## B-7 — Remaining blockers, each TESTED rather than assumed

Earlier in this session I recorded "no database access" as a blocker without ever testing
it. A Supabase MCP server was in fact connected, and that mistake cost several turns of
wrongly-scoped work. Every remaining blocker below has therefore been probed, and the probe
result is recorded.

| Requirement | Blocker | How it was tested | Result |
|---|---|---|---|
| 7 — exactly one `/register` | Needs a live Discord application to enumerate published command scopes | Called `mcp__discord__discord_login` | **"Discord token not provided and not configured"** — server present, unauthenticated. Genuinely blocked |
| 3 — withdrawal end to end | Needs SOL in a devnet wallet and a real signature | n/a — I cannot acquire or move funds, and must not | Blocked by design |
| 19 / 20 — authenticated screenshots and browser e2e | Needs a Privy session | n/a — I will not authenticate as the owner or handle their credentials | Blocked by design |
| Fee collection | `PLATFORM_FEE_ACCOUNT` is a wallet address only the owner has | Verified the code path: unset → 0 bps, set → 200 bps | Blocked on a secret (§2.14) |

For requirement 7 specifically, the static gate does pass: `npm run check:discord-commands`
confirms one `/register`, a single deployment scope, and that the global scope is cleared on
startup. What cannot be confirmed from here is the *live* Discord state after a deploy.
Confirm it in the client once `degenaration-discord-bot` is running.

Note on what would make these verifiable, for the owner's decision only: configuring a
Discord bot token for the MCP server would let a future session enumerate published
commands directly. That is the owner's call, not something to be asked for in chat.

## Resolved / not blockers

- **Wallet model for withdrawals.** Determined from code rather than escalated: the
  platform is non-custodial (Privy-provided user-owned wallets; `app/api/withdraw/route.ts`
  states the platform never holds keys). Withdrawals will be implemented as self-service
  user-signed transfers. See `docs/launch/RELEASE_CHECKLIST.md` F-3.
