# DegenAration Implementation Plan

Updated: 2026-07-26

## Phase A - Specification and Audit

- [x] Review the complete revised master specification.
- [x] Review all supplied recordings and images.
- [x] Persist the master specification and repository instructions.
- [x] Record the initial reference coverage and current-state audit.

## Phase B - Data and Security Foundation

- [ ] Add verified roles and admin-grant synchronization.
- [ ] Add versioned bot profiles/configurations and lifecycle constraints.
- [ ] Add KOL strategies/subscriptions with a database-enforced publication limit.
- [ ] Add scanner registry, snapshots, signals, intents, executions, positions, and lots.
- [ ] Add immutable commission, referral, payout, and cash-movement ledgers.
- [ ] Add outbox events, durable jobs, leases, dead letters, kill switches, and audit log.
- [ ] Add allowlisted user/admin bridge operations and typed API validation.
- [ ] Replace sensitive process-local rate limits with durable database buckets.

## Phase C - Focused Product Shell

- [ ] Restrict normal navigation to Bots, Affiliate, and Portfolio.
- [ ] Hide Admin unless a server-verified database role is present.
- [ ] Redirect or deliberately retire legacy user routes.
- [ ] Consolidate the graphite/gold semantic token system.

## Phase D - Bots

- [ ] Build Bots landing and My Bots manager.
- [ ] Build Discord marketplace, details, create/edit, review, and lifecycle actions.
- [ ] Preserve `/register` and connect owner onboarding to the same source registry.
- [ ] Build KOL marketplace, strategy details, create/edit, copy, and lifecycle actions.
- [ ] Build shared scanner filters, presets, preview, and explicit provider states.

## Phase E - Affiliate and Portfolio

- [ ] Build Discord/KOL affiliate analytics and referral management.
- [ ] Build payout request and reconciliation workflow.
- [ ] Build balances, performance, positions, and full activity history.
- [ ] Build original winner, loser, and portfolio PnL-card exports.

## Phase F - Operations and Release

- [ ] Expand admin console across sources, KOL, users, ledgers, payouts, trades,
  scanner health, system controls, and audit.
- [ ] Add unit, integration, browser, security, and scanner coverage tests.
- [ ] Run the independent release audit and update all evidence documents.
- [ ] Deploy only after checks pass; keep mainnet execution gated.

