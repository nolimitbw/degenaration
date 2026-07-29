# Implementation Plan

Date: 2026-07-22

## Ordering rule

Security and trading correctness come first, followed by DegenAration branding, required product behavior, and then visual polish. A feature is not complete until its real-data path and failure path have both been exercised.

## Phase 0: Preserve the baseline

- Keep the current DegenAration logo, name, graphite surface, bronze/gold accent, and current route behavior.
- Preserve unrelated working-tree changes.
- Add repeatable `typecheck`, `lint`, and test commands.
- Remove `ignoreBuildErrors` and `ignoreDuringBuilds` only after the checks pass.

Exit criteria: clean production build with type validation enabled and documented baseline results.

## Phase 1: Trading safety and durability

Dependencies: Supabase schema, worker, Privy authorization model.

1. Add durable execution-attempt records with a unique idempotency key.
2. Add atomic database functions to claim a limit order or subscriber execution before signing.
3. Reserve daily spend atomically before a transaction and reconcile it after success/failure.
4. Split call ingestion state from per-subscriber delivery state.
5. Persist attempt status: queued, claimed, signing, submitted, confirmed, failed, retryable, cancelled.
6. Make trade recording idempotent by transaction signature.
7. Verify the exact Privy delegation policy; remove unsupported marketing claims until proven.
8. Keep `DELEGATED_SIGNING=off` until devnet duplicate, cap, retry, and revocation tests pass.

Exit criteria: concurrent workers cannot double-submit; daily caps cannot be overspent; failed deliveries remain visible and retryable.

## Phase 2: Auth and ownership consistency

Dependencies: Privy configuration and server secrets.

- Keep server-side owner authorization as the final gate.
- Make owner-session failure states actionable and configuration-independent where possible.
- Convert onboarding and settings to Privy-only identity/session flows.
- Remove misleading email inputs or controls that invoke the same generic modal.
- Hide owner links from non-owner clients while retaining server authorization.

Exit criteria: Google owner login, regular login, logout, relogin, and expired-session states are tested in production-like configuration.

## Phase 3: Data adapters and error contracts

Dependencies: stable route behavior from phases 1 and 2.

- Replace placeholder Supabase configuration with explicit unavailable-state handling.
- Add typed response adapters for Jupiter, DexScreener, GeckoTerminal, RugCheck, and Solana RPC.
- Standardize error envelopes and provider timeout/retry behavior.
- Preserve last-known-good market lists while clearly displaying staleness.
- Sanitize all provider-returned outbound URLs.

Exit criteria: provider failures never become fake empty success states and never crash a route.

## Phase 4: Design system and shell

Dependencies: route inventory and brand tokens.

- Consolidate legacy pink/cyber and graphite/bronze themes into semantic DegenAration tokens.
- Keep cards square or lightly rounded, dense, and operational.
- Normalize buttons, icon buttons, fields, tabs, tables, status chips, loading rows, empty states, and error states.
- Remove obsolete rocket/cosmic CSS and asset references.
- Make primary navigation Terminal, Trades, Search, Bots, Affiliate, Portfolio.
- Preserve accessible focus, keyboard navigation, reduced motion, and 44px mobile targets.

Exit criteria: one coherent shell across public, app, auth, admin, and error routes at desktop and mobile widths.

## Phase 5: Terminal and trades

Dependencies: phases 1, 3, and 4.

- Replace the flashing embedded chart with the real first-party OHLCV renderer.
- Add timeframe controls, price axis, volume, hover crosshair, and loading/error overlays without layout shift.
- Keep Buy, Sell, and Limit modes with explicit preview, signature, submission, confirmation, and recording states.
- Add open orders and execution status to Trades.
- Add explorer links, filters, and clear retry actions.

Exit criteria: a devnet buy/sell and safe limit-order flow are exercised end to end; no white chart flash occurs.

## Phase 6: Search and research

Dependencies: phases 3 and 4.

- Add a real advanced filter drawer for liquidity, market cap, age, volume, price change, DEX, authority status, and holder concentration.
- Add saved local presets only after filters themselves are real.
- Improve token drawer chart, risk, holder, and route details.

Exit criteria: every visible filter changes the real result set and survives responsive QA.

## Phase 7: Bots and Discord

Dependencies: phases 1 through 4.

- Separate bot manager, source marketplace, configuration, activity, and execution status views.
- Preserve the two-pane configuration/source relationship from the current product.
- Add durable per-source and per-execution logs.
- Keep `/register`, `/alpha`, `/degen status`, profile, referral, callers, and onboarding commands.
- Define separate Render services for Discord gateway and automation worker, each with a health signal and explicit environment contract.

Exit criteria: invite, slash registration, owner approval, call ingestion, public profile, and subscriber delivery are tested with real test servers and devnet execution.

## Phase 8: Portfolio, Affiliate, and Admin

Dependencies: durable trade and attribution ledgers.

- Build wallet holdings, cost basis, realized/unrealized PnL, allocation, and activity from real data.
- Add referral click, conversion, commission, and payout records before displaying earnings.
- Add owner audit log and provider health to Admin.
- Keep public source and wallet profiles available without wallet connection.

Exit criteria: every displayed financial number traces to a stored event or on-chain query.

## Phase 9: Release verification

- Unit tests for parsers, validation, state machines, fee math, and idempotency.
- Integration tests for database claims, RLS, Edge Functions, and worker retries.
- Browser tests for all primary routes, auth states, empty/error/loading states, and keyboard paths.
- Desktop and mobile screenshot comparison against the recorded current product and approved DegenAration direction.
- Security and performance advisors after each database migration.
- Staged deployment, smoke test, and rollback rehearsal.

Exit criteria: the checklist in `docs/testing-and-release.md` is complete with evidence; no feature is marked complete based only on source inspection.

