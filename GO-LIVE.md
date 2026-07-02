# DEGENARATION — Go-Live Checklist

Everything below is what stands between the current app and a real, public product.
Ordered by dependency. Items marked **[DONE]** are already built and delivered.

---

## Already built [DONE]

- Full frontend: landing, login, onboarding, dashboard, wallet, calls, apply, admin, demo (11 pages, build-verified)
- Auth: Supabase email + Google (email works now; Google needs provider toggle)
- Database: 5 tables live + seeded, Row Level Security, auto-profile trigger
- API routes (tested against live APIs): `/api/price`, `/api/quote`, `/api/rugcheck`, `/api/swap` — all with the 2% platform fee logic
- Wallet: Privy non-custodial, App ID configured
- Signing loop scaffolded: `useSwap` hook + live test-swap panel
- Discord bot + rug-check + Jupiter fee + TP/SL monitor (server/, parser tested)
- Admin approval panel wired to the database

---

## Phase A — Finish the wallet signing (developer, ~1 day)

1. In `components/SwapPanel.tsx`, replace the `window.__privySolanaSign` placeholder with
   Privy's real Solana signing hook. At the top of the component:
   ```ts
   import { useSignTransaction } from "@privy-io/react-auth/solana";
   const { signTransaction } = useSignTransaction();
   ```
   Pass `signTransaction` into `signAndSend(...)`.
2. Fund a devnet wallet from https://faucet.solana.com and run the test swap panel end to end.
3. Confirm a real transaction signature appears and shows on https://explorer.solana.com (devnet).

## Phase B — Turn on the 2% fee

1. Create/choose a Solana wallet that will receive fees.
2. Create its associated token account for the fee mint (or use Jupiter's referral program).
3. Set `PLATFORM_FEE_ACCOUNT` in `.env.local` and `server/.env`.
4. Re-run a swap — quote now shows `platformFeeBps: 200` and the fee routes to your account.

## Phase C — Run the backend services

1. `cd server && npm install`.
2. Deploy `server/bot` and `server/engine` to a free host (Railway or Render).
3. Set env vars there: `DISCORD_BOT_TOKEN` (done), `BOT_SHARED_SECRET`, `ENGINE_WEBHOOK_URL`,
   `SOLANA_RPC_URL` (devnet first), `PLATFORM_FEE_ACCOUNT`.
4. In Discord Developer Portal: enable **Message Content Intent**, invite the bot to a test server.
5. Register the test channel in `APPROVED_CHANNELS` (or via the admin panel once wired to it).

## Phase D — Deploy the website

1. Push the project to a GitHub repo (exclude `.env*` — already in `.gitignore`).
2. Import into Vercel (free). Add the same `NEXT_PUBLIC_*` env vars in Vercel settings.
3. Enable Google auth: Supabase → Authentication → Providers → Google (optional; email works without).

## Phase E — Security (do NOT skip before real money)

- Session keys must be **trade-only** and **spend-capped** — verify Privy delegated actions are scoped so the platform can never withdraw.
- Rate-limit all API routes; validate every field parsed from Discord (untrusted input).
- Never log or store private keys anywhere. Confirm none exist server-side.
- Add an audit-log row in `trades` for every automated action (schema already supports it).
- Get an independent review before mainnet.

## Phase F — Legal (do NOT skip)

- Have a lawyer review your Terms, Privacy Policy, and Risk Disclosure for your jurisdiction.
- Confirm whether an auto-trading + fee service triggers registration/licensing where you operate.
- The non-custodial design reduces custody/licensing exposure but does not eliminate all obligations.

## Phase G — Mainnet (last, carefully)

- Jupiter liquidity is mainnet; final end-to-end tests use **tiny real amounts** you can afford to lose.
- Roll out to a small closed group first. Watch for failed signs, slippage, and fee routing.
- Only then open publicly.

---

## Reality check

This is a genuinely ambitious product touching people's money. The frontend and data
layers are done and solid. Phases A–D are normal developer work. Phases E–F are the ones
that protect you and your users — they are not optional, and rushing them is how these
projects get people hurt or get their owners in legal trouble. Take them seriously.
