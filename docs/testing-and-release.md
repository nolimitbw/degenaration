# Testing and Release

Date: 2026-07-22

## Local quality gate

Run from the repository root unless stated otherwise.

```bash
npm run typecheck
npm run lint
npm run test
npm run build
cd server && npm test
```

The root scripts do not all exist at the audit baseline. Adding them and removing skipped build validation is part of Phase 0.

## Required test layers

### Unit

- Numeric and mint validation.
- Quote normalization and price-impact guards.
- Trade execution state machine.
- Discord mint parser.
- Risk thresholds.
- Fee math.
- Limit trigger evaluation.
- Idempotency key construction.
- Retry classification.

### Database integration

- RLS for every exposed table.
- Sensitive function execution grants.
- Atomic claim permits one winner under concurrency.
- Duplicate transaction signature is idempotent.
- Daily spend reservation cannot exceed the cap under concurrency.
- Failed subscriber delivery does not mark another delivery complete.
- Admin approval creates one public profile and one referral code.

### Service integration

- Privy access-token verification and owner identity verification.
- Jupiter quote, unsigned swap, price-impact rejection, and provider failure.
- Solana confirmed transaction verification.
- Bot registration through Next API, Edge Function, and Postgres.
- Discord call ingestion and source metric update.
- Render health responses for gateway and worker.

### Browser

- Routes: `/`, `/terminal`, `/trades`, `/search`, `/bots`, `/affiliate`, `/portfolio`, `/orders`, `/tracker`, `/wallet`, `/apply`, `/admin`, `/admin/channels`.
- States: signed out, regular user, owner, loading, empty, provider error, stale data, validation failure, transaction rejection, transaction submission.
- Viewports: 390x844, 768x1024, 1440x900, and 1920x1080.
- Keyboard: skip link, nav, tabs, dialogs, form controls, focus return.
- Visual: no overlap, clipped labels, horizontal page scroll, white iframe flash, layout shift, or unreadable contrast.

## Real-money release gates

Automated signing remains off until all of these are evidenced on devnet:

- duplicate worker test produces one submitted transaction;
- concurrent daily-cap test never exceeds the configured cap;
- revoke delegation prevents the next queued execution;
- stale quote and excessive price impact are rejected;
- failed signing is retryable without duplicate submission;
- submitted signatures are confirmed and reconciled after worker restart;
- per-user and per-source execution logs are visible;
- emergency disable stops new claims without corrupting existing attempts.

Mainnet enablement is an explicit owner action after devnet evidence review. It is not part of a normal code deployment.

## Environment reference

Values are secrets unless marked public. Never commit them.

### Vercel

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_PRIVY_APP_ID` (public)
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL` (public)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public)
- `SUPABASE_URL`
- `ADMIN_KEY`
- `ADMIN_OWNER_EMAILS`
- `NEXT_PUBLIC_ADMIN_OWNER_EMAILS` (public allowlist hint only)
- `BOT_SHARED_SECRET`
- `DISCORD_BOT_CLIENT_ID` / `NEXT_PUBLIC_DISCORD_BOT_CLIENT_ID` (client ID is public)
- `NEXT_PUBLIC_DISCORD_BOT_INVITE` (public)
- `NEXT_PUBLIC_SOLANA_RPC_URL` (public endpoint; use a restricted key if applicable)
- `SOLANA_RPC_URL`
- `PLATFORM_FEE_ACCOUNT` / `NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT` (public address)
- `ADMIN_WALLETS` (public addresses, server-side policy)
- `AUTOMATION_WORKER_URL` / `NEXT_PUBLIC_AUTOMATION_WORKER_URL` as implemented

### Render Discord gateway

- `DISCORD_BOT_TOKEN`
- `DISCORD_BOT_CLIENT_ID`
- `BOT_SHARED_SECRET`
- `SITE_URL`
- `INGEST_URL`
- `BOT_REGISTER_URL`
- `BOT_APPROVED_CHANNELS_URL`
- `BOT_GUILD_STATUS_URL`
- `RELAY_CHANNEL_ID`
- `CHANNELS_REFRESH_MS`
- `BOT_BUILD`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

### Render automation worker

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `MAINNET_RPC`
- `WORKER_NET`
- `DELEGATED_SIGNING`
- `COPY_TRADING`
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `PRIVY_AUTHORIZATION_KEY`
- `PLATFORM_FEE_ACCOUNT`

## Deployment sequence

1. Back up schema and inspect migration drift.
2. Apply reviewed migrations.
3. Run Supabase security and performance advisors.
4. Deploy Edge Functions if their operation contract changed.
5. Deploy Vercel with automated signing still off.
6. Smoke test public, user, and owner routes.
7. Deploy Discord gateway and verify command sync and registration status.
8. Deploy worker in watch-only mode and verify health/events.
9. Run devnet execution suite.
10. Enable mainnet signing only through an explicit owner-controlled change after evidence review.

## Rollback

- Keep migrations forward-compatible; prefer additive schema changes before code switches.
- Disable automated claims first with the worker kill switch.
- Roll back Vercel and Render independently.
- Never delete execution attempts during rollback.
- Reconcile every submitted signature before retrying queued work.
- Re-run owner dashboard and Discord registration smoke tests after rollback.

## Completion evidence

A release report must include:

- exact Git revision and deployment IDs;
- commands and results;
- migration list and advisor results;
- real provider and devnet test evidence;
- route-feature matrix with known limitations;
- desktop/mobile before-and-after screenshots;
- rollback result;
- an explicit list of features still partial or disabled.
