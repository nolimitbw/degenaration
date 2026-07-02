# Degenaration — Features Roadmap (ideas from Mizar + Trojan)

Concepts studied from Mizar and Trojan, mapped to our own build. We take the *concepts*,
not their copy or code.

## Already built [DONE]

- **Landing, auth, onboarding, dashboard, wallet** — live
- **Discord Calls** (copy-groups + per-group TP/SL/size settings) — our version of Trojan "Alpha groups" copy
- **Alpha ranked leaderboard** (`/alpha`) — Groups / Calls / Callers tabs, Points, Total Return, Hit Rate, Median, Best Call [Trojan Alpha]
- **Trading terminal** (`/terminal`) — chart + Market/Limit + slippage + TP/SL/MEV/auto-retry [Mizar terminal]
- **Admin commissions + withdrawal** (`/admin/commissions`) — total 2% earned, fee-wallet balance, sign-and-withdraw
- **Paper demo, admin approvals, API routes** (price/quote/rugcheck/swap/balance/withdraw)

## High-value next features (from the two apps)

### From Trojan
1. **Trenches — new-token discovery feed.** Live stream of just-launched tokens (New / About /
   Migrated) with age, holder %, dev %, volume, MC, and one-tap quick-buy. Core degen surface.
2. **Explorer — token screener.** Sortable/filterable lists: Hot / New / Gainers / Top / Live,
   with sparkline, market cap, liquidity, price %, volume, timeframe filter.
3. **Wallet Tracker.** Follow top ("KOL") wallets, get alerts when they buy, optional auto-copy.
   A second copy-trading source alongside Discord calls. Import a library of known wallets.
4. **Holdings / Performance.** Portfolio value over time (1d–All Time) with a PnL chart, per-wallet
   and per-token breakdown, shareable PnL card.
5. **Watchlist ticker.** Top strip of starred/trending tokens with live prices (already partially
   present on our landing).
6. **Arena — gamified competitions.** Trading leaderboards/competitions for engagement.

### From Mizar
7. **Managed deposit address per user** with QR (we have via Privy embedded wallets).
8. **Snipe automation** — auto-buy a token the instant it appears/qualifies (our Discord engine
   is this; extend to Trenches new-launches).
9. **Limit orders + advanced order types** in the terminal.
10. **Account: 2FA, linked Telegram/Discord, session manager.**

## Suggested build order

1. Trenches feed (discovery) + Explorer screener — biggest daily-use surfaces
2. Wallet Tracker (second copy source) + alerts
3. Holdings performance chart + shareable PnL
4. Limit orders + snipe-on-launch in the engine
5. Account security (2FA, sessions), Telegram bot
6. Arena competitions

## Monetization (yours)

- 2% fee on every trade (in/out, partials) via Jupiter platform fee → your fee wallet
- Admin withdrawal already built
- Later: premium tiers (faster execution, more auto-copy slots), listing fees for call groups

## Reality checks (unchanged)

- Real trading needs the wallet-signing loop finished in-browser + your fee wallet set
- Security review + legal sign-off before real money (see SECURITY.md, GO-LIVE.md)
- Rotate the Discord bot token before public launch
