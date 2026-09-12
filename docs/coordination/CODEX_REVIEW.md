# Codex review

Findings from the independent reviewer. Each entry needs severity, file/line evidence,
reproduction, and expected behavior. Claude resolves each with a commit and evidence, or
rejects it with evidence, or marks it blocked.

## Status

**Independent production audit repeated 2026-08-11** on
`codex/final-degenaration-2026-08-08` at `43761bb`. The static release suite passes after
the three localhost verifiers are run outside the filesystem sandbox, but production does
not satisfy the master prompt's definition of done. The deployed app is `eef0544`, the
Discord journal has received no raw event since 2026-08-09, no execution worker lease exists,
and the fee/cursor findings below are internally solvable release blockers.

## Findings

| ID | Severity | File:line | Finding | Status |
|---|---|---|---|---|
| C-1 | Moderate | `package-lock.json` | Production audit initially contained a high transitive nanoid advisory and fixable Hono advisories | RESOLVED — safe lockfile refresh removed all high findings; 12 moderate transitive wallet/Solana advisories remain because npm's proposed fixes are breaking downgrades |
| C-2 | Warning | Supabase Auth project setting | Leaked-password protection is disabled | EXTERNAL — enable in Auth dashboard if password auth is retained |
| C-3 | Info | `app_private.*` | Advisor reports RLS enabled with no policy | ACCEPTED — these private tables intentionally expose no direct client policy; access is through revoked, secret-checked RPC boundaries |
| C-4 | **High** | `lib/server/discord-rest-backfill.js:86-97` | A completed channel never advances `newest_message_id`: `newest || nextNewest` always keeps the old cursor. It also overwrites the historical `oldest_message_id` with the newest catch-up page. Every later Vercel run therefore fetches the same first page after completion, so calls beyond it are never journalled. | RESOLVED — completed channels now advance the newest cursor, preserve the historical oldest cursor, and continue full pages; deterministic cursor and paging regressions pass |
| C-5 | **High** | `lib/server/fee-account.ts:136-182`; `server/engine/jupiter.js:45-80`; `server/worker.js:130` | The fee account contract is mutually incompatible. The app treats `PLATFORM_FEE_ACCOUNT` as an owner wallet and requires derived wSOL **and** USDC ATAs; the worker accepts only the configured address itself as one SPL token account. One value cannot be both a wallet with two ATAs and one token account. Worker health further reports `feeEnabled` from a non-empty environment variable instead of the resolved probe. | RESOLVED — both runtimes accept a wallet or SPL account, derive and verify the wSOL ATA, and report readiness from the resolved on-chain probe |
| C-6 | **High** | `lib/server/fee-account.ts:136-140`; `server/engine/jupiter.js:72-75` | The implementation deliberately charges only when the swap output mint matches a pre-existing fee account. Arbitrary memecoin buys therefore charge 0 bps, violating the repository invariant of 200 bps on every confirmed swap leg. | RESOLVED — current Jupiter Metis ExactIn supports a fee account for either pair mint; the verified wSOL account is now selected on both SOL→token and token→SOL legs, with parity tests |
| C-7 | **High** | Production runtime; `render.yaml:1-70` | No execution worker is deployed: `worker_leases=0`, `trade_intents=0`, `trade_executions=0`, and 13 readiness checks fail. Mainnet/payout flags are true, but delegated signing and copy trading remain off and there is no runtime to act on them. | BLOCKED/OPEN — deployment/account setup is external; signing and funded canary remain owner-gated |
| C-8 | **High** | `render.yaml:3-70`; `docs/hosting/HOSTING_DECISION.md` | The Render blueprint is not the sustainable free production replacement required by milestone 8. The worker uses a free web service that officially sleeps/restarts and the Discord bot is explicitly paid `starter`. The hosting decision document itself rejects Render Free for this workload. | OPEN — repository and deployment plan contradict each other; no verified replacement authority exists |
| C-9 | **High** | `components/admin/OwnerSections.tsx:543-556`; `server/` | Payout processing is flagged enabled in production, but the admin product explicitly performs ledger decisions only and exposes no wallet signing/transfer executor. | PARTIAL — the full approved→processing→confirmed/failed state machine is now exposed only when the live gate is enabled, and confirmation requires a validated immutable Solana signature. Treasury signing remains an owner-funded action rather than a server-held key. |
| C-10 | **High** | `lib/bot-control-contract.js` | 14 persisted bot settings are intentionally unenforced: limit entry/retry, dynamic stop, manual KOL mints, four KOL trigger fields, four scanner fields, DEX constraints, and risk tier. | OPEN — the contract test confirms they are pending; passing it does not mean the features work |
| C-11 | **High** | Production journals and `app/api/cron/call-performance/route.ts:27-40` | 1,780 of 1,781 calls have no immutable call-time price. Current-price scans cannot compute returns for them; only one call is measured. The marketplace therefore cannot show historical performance for the existing journal without a timestamped-price provider. | ACCEPTED DATA LIMIT, but definition-of-done remains unmet; UI must stay in insufficient-history state |
| C-12 | Moderate | `server/engine/performance.js:47-63`; `app/api/cron/call-performance/route.ts:88-123` | Up to 200 distinct quote requests and writes are awaited serially under a 300-second function limit. Write failures are swallowed into counters and the route still returns HTTP 200, so Vercel will not retry or alert on a failed scan. | RESOLVED — quotes and writes run with a bounded concurrency of 12 and load/write failures return 502; concurrency and error regressions pass |
| C-13 | Moderate | Production deployment | Vercel serves `eef0544` while the audited branch head is `43761bb`; `d0a5bdc` and coordination commits are not the deployed artifact. | OPEN — exact production SHA does not match the audited head |
| C-14 | Moderate | `docs/coordination/IMPLEMENTATION_STATUS.md`; `docs/coordination/OPEN_BLOCKERS.md`; `docs/ai/OPEN_BLOCKERS.md` | Release documentation conflicts: one status calls the implementation complete/PASS, another says OCI is the only valid host, and the newer blocker file proposes Render while the runtime is absent. | OPEN — status cannot be used as release evidence until reconciled with live facts |
| C-15 | Moderate | `package-lock.json` | Current production dependency audit reports 12 moderate advisories through Privy/Wagmi/MetaMask/Solana transitive chains; npm offers only breaking or downgrade-style fixes. | OPEN/RISK-ACCEPT — 0 high and 0 critical, but the moderate set remains |
| C-16 | Low | Supabase `public.positions` policy and six foreign keys | Performance advisor reports one `auth_rls_initplan` warning and six foreign keys without covering indexes; 57 unused-index notices are informational on the currently near-empty workload. | RESOLVED/DEPLOYED — migration 31 adds all six covering indexes and the init-plan-safe policy; production advisor now reports zero actionable findings in these categories |
| C-17 | Low | Three product pages in `git diff --check bf17348..HEAD` | Trailing whitespace remains in `app/bots/activity/[id]/page.tsx`, `app/bots/discord/[id]/page.tsx`, and `app/bots/kol/[id]/page.tsx`. | RESOLVED — `git diff --check` is clean |
| C-18 | **High** | Production `degencalls` health; `render.yaml:53-70` | The repository's Discord Gateway bot is not deployed. The only live listener is a separate Render service not built from this repository; it reports 5 ingestion attempts (3 accepted, 2 failed), 100 quarantined, and no ingestion attempt since 2026-08-05. The repository acknowledgment path therefore has no current production proof. | OPEN — blocks definition-of-done items 1 and 2 even after C-4 is fixed |
| C-19 | Moderate | Production ownership tables | `/connect discord` passes local contract tests but has never completed in production: owner-link sessions, ownership events, and source-ownership history are all zero. Creator attribution for the two approved sources is therefore unproven. | OPEN/UNEXERCISED — needs a real source owner, not fabricated data |
| C-20 | Moderate | `package.json`; `scripts/verify-responsive-surfaces.mjs` | Milestone-10 acceptance is not fully automated: there is no dedicated accessibility or committed-secret scan in `npm run check`, and the browser verifier explicitly does not prove signed-in Bot Manager, Affiliate, Portfolio, Withdraw, or Admin. | PARTIAL — `npm run check` now scans every tracked text file for committed credentials and the browser audit fails unnamed interactive controls. Signed-in production acceptance still requires an authenticated owner session. |

## Production evidence — 2026-08-11

- Calls: 1,781 total; 1 with call-time baseline; 566 scanned; 415 fresh current
  observations; 1 measured; latest call 2026-08-09 03:25 UTC.
- Signal path: 1,789 raw and parsed signals; latest raw event 2026-08-09 04:06 UTC;
  no event in the last 24 hours.
- Trading/revenue: 0 worker leases, intents, executions, positions, commission ledger rows,
  payouts, revenue withdrawals, or performance snapshots. Six users and four registered
  wallets remain present.
- Ownership: 0 Discord owner-link sessions, ownership events, or source-ownership history.
- Backfill: one channel completed at 621 scanned messages; SLPR remains incomplete at 3,200.
- Adapters: 3 marked supported but with no recorded success; 10 venue-specific adapters are
  `planned` and have no decoder/discovery implementation.
- Supabase advisors: no error-level findings; one leaked-password warning; one RLS init-plan
  performance warning; six unindexed foreign keys.
- Edge functions: latest 100 events contained 49 `bot-bridge` and 51 `app-bridge` responses,
  all HTTP 200. Successful transport does not disprove C-4 because the bad cursor is persisted
  successfully. The app bridge has no declared/deployed drift across 83 operations, and
  invalid-secret probes confirmed the four deployed scanner/backfill bot operations.
- Release checks: typecheck, lint, unit/integration journal tests, migration apply/rollback,
  production build, 44 responsive captures, simulation gate, and unsigned mainnet quote/build
  passed. Funded mainnet simulation was not run because `SIMULATION_PAYER` is unset.
