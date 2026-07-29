# Architecture

Date: 2026-07-22

## Runtime map

```text
Browser
  |
  | Privy access/identity tokens and wallet signatures
  v
Next.js on Vercel
  |-- market APIs -> Jupiter / DexScreener / GeckoTerminal / RugCheck / Solana RPC
  |-- app APIs -> Supabase app-bridge Edge Function
  |-- bot APIs -> Supabase bot-bridge Edge Function
  |-- admin APIs -> Privy verification -> app-bridge
  v
Supabase Postgres
  |-- user profiles, subscriptions, orders, trades
  |-- Discord channels, groups, calls, applications
  |-- secret-checked SECURITY DEFINER functions
  ^
  |
Render Discord gateway              Render automation worker
  |-- slash commands                |-- limit watcher
  |-- approved-channel messages     |-- wallet-copy watcher
  |-- registration/call ingestion   |-- Discord-call watcher
                                     |-- source performance scanner
```

## Trust boundaries

1. Browser input is untrusted. Token mints, wallet addresses, numeric trade controls, links, and Discord content require validation.
2. Privy access tokens authenticate a user DID. Identity tokens contain signed linked-account data used for owner email authorization.
3. `ADMIN_KEY`, `BOT_SHARED_SECRET`, Supabase service keys, Privy app secret, and Privy authorization key are server-only.
4. Edge Functions intentionally disable Supabase JWT verification because their database functions validate an application secret. They must never forward arbitrary operation names or arbitrary parameters.
5. A successful quote or unsigned transaction build does not prove a trade. Only a confirmed, verified on-chain transaction can enter the trade ledger.
6. A submitted transaction does not prove durable automation completion. The execution attempt must remain queryable through confirmation or terminal failure.

## Authentication

- Primary user authentication: Privy.
- User API authorization: verified Privy access JWT (`sub` is the Privy user ID).
- Wallet ownership for automated settings: signed Privy identity token plus linked wallet ID/address checks.
- Owner authorization: verified Privy session plus allowlisted linked email.
- Legacy Supabase Auth exists in several screens and should not be used for new work.

## Manual trade flow

```text
validate inputs
  -> request live quote/simulation
  -> show immutable preview snapshot
  -> request unsigned Jupiter transaction
  -> user wallet signs and submits
  -> verify confirmed Solana transaction
  -> idempotently record trade by signature
  -> refresh balances and history
```

The UI state must distinguish previewing, ready, signing, submitted, confirming, recorded, and failed. Chain success and ledger-record success are separate states.

## Automated trade flow target

```text
durable signal/order
  -> atomic claim with idempotency key
  -> atomic spend reservation
  -> safety and price-impact checks
  -> build unsigned swap
  -> delegated signer submits
  -> persist signature
  -> confirm and verify on chain
  -> record trade and settle reservation
  -> retry or terminal failure with audit reason
```

No automated path may rely on an in-memory `Set`, map, or timer as its sole claim, cap, or cursor.

## Discord flow

```text
server manager installs bot with bot + applications.commands scopes
  -> runs /register in a calls channel
  -> bot posts secret-authenticated registration to Next API
  -> bot-bridge calls bot_register_call_channel
  -> row is pending in call_channels
  -> owner reviews and approves in /admin/channels
  -> approved group receives public profile and referral code
  -> bot refreshes approved channels
  -> a valid mint message or /alpha is ingested
  -> source metrics update independently of trading
  -> per-subscriber delivery attempts are queued
```

Registration, source measurement, and subscriber execution are separate concerns and should have separate durable status.

## Data ownership

| Table | Purpose | Client exposure |
| --- | --- | --- |
| `profiles` | Legacy Supabase user settings | Owner row only via RLS. |
| `privy_profiles` | Privy user settings and wallet address | Server bridge only. |
| `approved_groups` | Approved public call sources | Public read. |
| `call_channels` | Discord registration and approval state | Server bridge only. |
| `calls` | Ingested source calls and measured performance | Public read is currently enabled. |
| `subscriptions` | Discord source automation settings | Owner/server only. |
| `copy_subscriptions` | Wallet-copy automation settings | Owner/server only. |
| `limit_orders` | User automated order intent | Owner/server only. |
| `trades` | Verified manual and automated trade ledger | Owner read; server insert. |
| `server_applications` | Source listing applications | Server bridge only. |

The target schema also needs execution attempts, spend reservations, referral events, commissions, payouts, and admin audit events before those features can be called complete.

## Provider adapters

Provider-specific response shapes should terminate in server adapters. Components should consume normalized contracts for:

- token market snapshot;
- OHLCV series and freshness;
- quote and route preview;
- token holder concentration;
- risk assessment with provider attribution;
- wallet balances and positions;
- transaction verification and confirmation.

Each contract needs explicit `loading`, `fresh`, `stale`, `unavailable`, and `error` behavior. Empty arrays must not stand in for provider failure.

## Deployment units

- Vercel: Next.js web and API routes.
- Supabase: Postgres plus `app-bridge` and `bot-bridge` Edge Functions.
- Render Discord gateway: long-lived Discord client and slash command sync.
- Render automation worker: health server and trading/performance watchers.

The Discord gateway and automation worker need separate Render services. A single process command cannot safely represent both roles.

