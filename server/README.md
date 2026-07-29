# Degenaration server (bot + engine)

- `bot/` — Discord bot. Server managers invite it, run `/register` in their calls
  channel, and the channel appears in the website admin queue. After approval, it
  parses calls (address or link only) and forwards them to the engine.
- `engine/` — receives calls, rug-checks (DexScreener + RugCheck + on-chain
  authority checks), builds Jupiter swaps with the configured platform fee
  (enabled only when PLATFORM_FEE_ACCOUNT is set), executes per-user with their
  TP/SL/size/daily-cap settings via delegated session keys.

- `worker.js` — 24/7 automation: runs the limit-order watcher (`engine/limits.js`,
  executes a buy when a token hits the user's target) and the copy-trade watcher
  (`engine/copy.js`, mirrors a followed wallet's new buys to subscribers). Loads from
  Supabase (`engine/store.js`), prices via DexScreener (`engine/prices.js`).

Run (after `npm install` in each folder):
  node engine/index.js
  node bot/index.js
  node worker.js        # limit orders + copy trading (needs Supabase + delegated signing)

## Discord bot env

Set these on Render for the bot service:

- `DISCORD_BOT_TOKEN`
- `BOT_SHARED_SECRET` (must match the website)
- `SITE_URL=https://degenaration.vercel.app`
- `INGEST_URL=https://degenaration.vercel.app/api/ingest-call`
- `RELAY_CHANNEL_ID` (optional platform Discord relay)

The bot syncs `/register` as a guild command when it starts and whenever it is
added to a new server. It uses the website bridge endpoints by default:
`/api/bot/register-channel` and `/api/bot/approved-channels`. If those are not
available, it falls back to direct Supabase REST when `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` are set.

## Going live with the worker (non-custodial auto-trading)

1. Apply `supabase/schema.sql` (adds `limit_orders`, `copy_subscriptions`).
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MAINNET_RPC` in `server/.env`.
3. Set `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `PRIVY_AUTHORIZATION_KEY`, then test
   delegated signing on devnet with `WORKER_NET=devnet` and `DELEGATED_SIGNING=on`.
4. Deploy it as a Render web service. The worker exposes `/health` on `PORT`; only a
   response with `mode: live` proves unattended execution is enabled.
5. Switch to `WORKER_NET=mainnet` only after a successful delegated devnet trade.

NEVER put a private key in this codebase. Signing happens via Privy delegated
session keys (trade-only). Test everything on devnet first.
