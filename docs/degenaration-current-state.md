# DegenAration Current State

Updated: 2026-07-26

## Repository

- Next.js 15 App Router, React 18, TypeScript, Tailwind CSS 3.
- Privy is the primary identity and embedded-wallet provider.
- Supabase Postgres and two allowlisted Edge Function bridges provide persistence.
- Render hosts the Discord gateway; a separate automation worker is defined but not
  currently configured with production signing secrets.
- Production web revision at audit start: `17cdbea`.

## Working Foundations

- Discord `/register`, `/alpha`, status, profile, referral, callers, and onboarding
  commands exist.
- Approved-channel ingestion and public source performance exist.
- Discord subscription settings persist by verified Privy user and wallet.
- Limit orders and Discord call executions use database-backed claims.
- Global daily spend reservations exist for the current automated entry paths.
- Manual trade records require verified on-chain signatures and are idempotent.
- Owner APIs verify signed Privy identity tokens and compare normalized linked email.
- Live price, OHLCV, holders, risk, token, quote, and wallet portfolio adapters exist.
- Production has one recorded Discord call, one Discord subscription, two approved
  groups, and two channel registrations at this audit.

## Release-Blocking Gaps

- Normal navigation still exposes Terminal, Trades, Search, Tools, and public Admin.
- KOL strategies, marketplace, subscriptions, and execution do not exist.
- Discord profiles do not support the required versioned configuration or full risk
  controls.
- No authoritative creator commission, affiliate event, payout, or reversal ledger.
- Portfolio lacks durable positions/lots, net-of-fee PnL, cash movement history, and
  share cards.
- Shared scanner adapter registry, explicit coverage health, and fail-closed filter
  evaluation are absent.
- Automation worker is not deployed with signing enabled; no live mainnet execution is
  authorized.
- Durable exit reconciliation for TP/SL remains unavailable.
- Production API rate limiting is process-local.
- Admin authorization does not yet synchronize a verified identity to a database role.
- `app_private.call_executions` has RLS disabled. Supabase reports this as critical;
  remediation requires an explicit access-policy decision.

## Current Safety Posture

- Mainnet delegated signing: OFF.
- Wallet copy trading: OFF.
- TP/SL automated exits: unavailable.
- Platform fee wallet: not configured.
- Development and test work must remain in `paper` or `solana-devnet`.
- No real transaction, payout, deposit, withdrawal, or Discord announcement may be
  triggered by automated verification.

