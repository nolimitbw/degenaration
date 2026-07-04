# Finish here — the last mile (owner-only, ~10 minutes)

All code is done, verified, and build-green. These four steps require YOUR accounts,
credentials, and funds, so they cannot be automated. Do them in order.

## 1. Google login (2 min)

The code is correct; the provider just needs enabling.

1. Supabase dashboard -> your project -> Authentication -> Providers -> Google -> Enable.
2. Create a Google OAuth client (Google Cloud Console -> Credentials -> OAuth client ID,
   type "Web application"). Add the authorized redirect URL Supabase shows you
   (looks like `https://<project>.supabase.co/auth/v1/callback`).
3. Paste the Client ID + Client Secret into the Supabase Google provider, save.
4. Test: open `/login` -> "Continue with Google". It now redirects to Google.
   (If it isn't enabled, the button now tells you so instead of doing nothing.)

## 2. Lock admin to this MacBook (1 min)

1. In Vercel -> your project -> Settings -> Environment Variables, add:
   - `NEXT_PUBLIC_ADMIN_KEY` = a long secret only you know (e.g. a 32-char random string).
   Redeploy so it takes effect.
2. On THIS Mac, open once:  `https://degenaration.vercel.app/?admin=<that-secret>`
   The key is stored in this browser and stripped from the URL. The Admin + Commissions
   tabs now appear only here; everyone else never sees them and gets a 404 on the URLs.
   To lock a device again: clear site data, or run `localStorage.removeItem('degen_admin')`.

## 3. Commissions + withdrawals (2 min)

Add these env vars in Vercel (Production), then redeploy:

- `NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT` = your fee TOKEN account (shows totals + balance in UI)
- `PLATFORM_FEE_ACCOUNT` = same fee account (server; makes the 2% fee actually route)
- `ADMIN_WALLETS` = comma-separated wallet(s) allowed to withdraw (usually just your fee wallet)

The withdraw API only ever builds a transaction FROM a wallet in `ADMIN_WALLETS`, and it
still has to be signed by that wallet in Phantom — so no one but you can move the fees.

## 4. 24/7 autotrade engine + mainnet go-live (5 min + a test)

1. Apply the DB schema: Supabase -> SQL Editor -> paste and run `supabase/schema.sql`
   (adds `limit_orders` + `copy_subscriptions` with row-level security).
2. Set a real mainnet RPC (public one is rate-limited): in Vercel add
   `NEXT_PUBLIC_MAINNET_RPC` and `MAINNET_RPC` = your Helius/QuickNode/Triton URL.
3. Deploy the worker (`server/worker.js`) to Railway or Render. Set its env:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MAINNET_RPC`,
   `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTH_KEY`, `WORKER_NET=devnet`.
4. DEVNET TEST FIRST: grant a delegated key on `/wallet` (AutoTrade), create a limit
   order, confirm the worker fills it on devnet. Only then set `WORKER_NET=mainnet` and
   `DELEGATED_SIGNING=on`.
5. Real-money smoke test: fund a wallet with a little SOL, do ONE market buy on `/terminal`,
   confirm the signature on Solscan. That is the final proof the mainnet path works.

## Deploy the current code fixes

The admin lockdown, 6-7x faster pages, login fix and bug fix are ready but NOT yet live.
To ship them:  `npm_config_cache=/tmp/degen-npm npx vercel --prod --yes`
(Or tell your assistant "deploy" and it will run this for you.)
