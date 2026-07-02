# Degenaration server (bot + engine)

- `bot/` — Discord bot. Owners of APPROVED servers invite it; it parses calls
  (address or link only) and forwards them to the engine.
- `engine/` — receives calls, rug-checks (DexScreener + RugCheck + on-chain
  authority checks), builds Jupiter swaps with the 2% platform fee
  (platformFeeBps=200 → PLATFORM_FEE_ACCOUNT), executes per-user with their
  TP/SL/size/daily-cap settings via delegated session keys.

- `worker.js` — 24/7 automation: runs the limit-order watcher (`engine/limits.js`,
  executes a buy when a token hits the user's target) and the copy-trade watcher
  (`engine/copy.js`, mirrors a followed wallet's new buys to subscribers). Loads from
  Supabase (`engine/store.js`), prices via DexScreener (`engine/prices.js`).

Run (after `npm install` in each folder):
  node engine/index.js
  node bot/index.js
  node worker.js        # limit orders + copy trading (needs Supabase + delegated signing)

## Going live with the worker (non-custodial auto-trading)

1. Apply `supabase/schema.sql` (adds `limit_orders`, `copy_subscriptions`).
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MAINNET_RPC` in `server/.env`.
3. Wire delegated signing: implement `signAndSend` in `worker.js` using Privy server-side
   delegated session keys (trade-only, spend-capped, revocable), then set
   `DELEGATED_SIGNING=on`. Until then the worker is WATCH-ONLY and cannot move funds.
4. Deploy to a host (Railway/Render). Test on devnet with tiny amounts first.

NEVER put a private key in this codebase. Signing happens via Privy delegated
session keys (trade-only). Test everything on devnet first.
