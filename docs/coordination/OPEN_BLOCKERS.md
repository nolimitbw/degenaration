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

## B-4 — No live database access to diagnose the two silent Discord sources

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

## Resolved / not blockers

- **Wallet model for withdrawals.** Determined from code rather than escalated: the
  platform is non-custodial (Privy-provided user-owned wallets; `app/api/withdraw/route.ts`
  states the platform never holds keys). Withdrawals will be implemented as self-service
  user-signed transfers. See `docs/launch/RELEASE_CHECKLIST.md` F-3.
