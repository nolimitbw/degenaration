# DEGENARATION — Build Brief for Claude Code

Paste this entire file as your first message to Claude Code (or tell it: "read degenaration-build-brief.md and build it step by step").

---

## What we're building

**Degenaration** — a Solana memecoin copy-trading website. Users pick approved Discord call groups, and the site automatically copies those calls as real trades from the user's own wallet. The platform earns a 2% fee on every trade in and out (including partial take-profits and stop-losses).

## Core rules (never break these)

1. **Non-custodial.** The platform NEVER holds user funds and NEVER has access to private keys. Use Privy (free tier) embedded wallets — users create a wallet with email/Google login or connect their existing Phantom/Solflare wallet.
2. **Trade-only permission.** The trading engine uses delegated session keys scoped to swap transactions only, with a user-set spending cap. Withdrawals are impossible for the platform by design. No private key material ever touches our server or database.
3. **Discord via official bot only.** No user-token/self-bot reading. Server owners apply, admin approves, then they invite our Discord bot to their server.
4. **Test on Solana devnet first.** All development and testing on devnet with test SOL. Mainnet only after the full flow works end to end.

## Tech stack (all free tiers)

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Framer Motion
- **Charts:** TradingView Lightweight Charts
- **Auth + DB:** Supabase (Google OAuth + email signup, Postgres)
- **Wallets:** Privy embedded wallets + wallet-adapter for Phantom/Solflare connect
- **Trading:** Jupiter Swap API with platform fee account set to 2% (this is how the platform gets paid — automatically, on-chain, every swap)
- **Solana RPC:** Helius free tier
- **Discord bot:** discord.js, hosted on Railway/Render free tier
- **Hosting:** Vercel free tier

## Design direction

Dark, bold, degen-crypto aesthetic. Not a generic AI-looking site — use the frontend-design and ui-ux-pro-max plugins for a distinctive design system. Neon accents, monospace numbers, fast animations on price changes.

## Features

### 1. Landing page
Hero explaining the product, live stats (total volume, trades copied), list of top-performing approved call groups, big CTA to sign up.

### 2. Auth & onboarding
- Sign up with Google or email (Supabase)
- On first login: create embedded wallet (Privy) OR connect existing wallet
- Show deposit address + QR to top up SOL
- User sets their trading permission: max spend per trade, daily cap

### 3. "Discord Calls" page
- Grid of APPROVED call groups: name, logo, member count, 7/30-day performance of their calls, win rate
- User subscribes to one or more groups
- Per-group settings the user controls:
  - Position size per call (fixed SOL or % of balance)
  - Auto take-profit levels (e.g., sell 50% at 2x, 25% at 5x)
  - Stop-loss %
  - Max slippage
  - Daily loss limit (pauses copying when hit)
  - Token blacklist

### 4. Safety engine (runs before every auto-buy)
- Rug-check each called token: liquidity locked? mint authority revoked? top-10 holder concentration? honeypot simulation
- Skip trade + notify user if checks fail

### 5. Trading engine
- Discord bot parses calls (token address/ticker) from approved servers
- Executes swaps via Jupiter with the 2% platform fee account attached
- Applies user's TP/SL/sizing settings; monitors positions for TP/SL triggers
- Every buy/sell/partial goes through Jupiter = fee collected automatically

### 6. Portfolio dashboard
- Open positions with live prices (Lightweight Charts), PnL per position and total
- Trade history with fees shown transparently
- Pause-all button

### 7. Discord owner application flow
- Public "List your server" page with application form (server info, invite link, track record)
- Admin panel (owner-only) to review, approve, reject
- On approval: instructions to invite the Degenaration bot; server appears on the Calls page

### 8. Legal pages
- Terms of Service, Privacy Policy, and a clear Risk Disclosure (memecoin trading can lose everything, platform is software not financial advice, 2% fee disclosed)
- Risk disclosure checkbox required at signup

## Build order (do one phase at a time, test each)

1. Project setup, design system, landing page
2. Supabase auth (Google + email) + onboarding flow
3. Privy wallet creation / wallet connect + devnet top-up display
4. Discord bot: receive + parse calls from a test server
5. Trading engine on DEVNET: call → rug-check → Jupiter swap → position tracking
6. TP/SL automation + user settings
7. Portfolio dashboard with charts
8. Discord owner application + admin approval panel
9. Legal pages + risk disclosure flow
10. Full end-to-end devnet test, then mainnet config switch

## Security requirements

- No private keys server-side, ever
- Session keys: trade-only scope, spend caps, revocable by user in one click
- Rate limiting on all API routes; input validation on parsed Discord messages (treat call messages as untrusted data)
- Audit log of every automated action per user
- Secrets in environment variables only

---

*Owner note: before public mainnet launch, get a lawyer to review the ToS/risk disclosure for your country. The non-custodial design minimizes licensing risk but doesn't erase it.*
