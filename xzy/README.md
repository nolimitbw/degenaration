# Xzy

Copy trading for Telegram calls, on Solana.

Follow Telegram channels you trust. When one posts a Solana mint, Xzy records the call
and (once the trading engine lands) buys it for subscribers under their own size limits
and take-profit rules.

**This is an independent project.** It shares no code, database, or deployment with any
other product.

---

## Status

**Trading is implemented. The live Jupiter endpoint is still unverified.** Read that twice
before funding anything.

Working and tested (117 tests):

- Telegram webhook, channel listing by bot promotion, call extraction, journalling with
  database-level idempotency.
- Mini App `initData` HMAC verification — the app's entire auth boundary.
- Custodial wallets, AES-256-GCM encrypted at rest.
- Copy engine: per-trade size, daily ceiling, duplicate-call protection, spend reserved
  before the buy and refunded on failure.
- Exit engine: multi-level take-profit ladders and stop loss.
- **Full trade loop against a stub Jupiter**: buy, ladder up through two take-profits,
  collapse through the stop, close out. Exercises the real execute and monitor code.
- Channel scoring: peak tracking and per-channel median / best / hit-rate.
- Admin review screen for approving listed channels.
- Chat trading: `/wallet`, `/positions` with sell buttons, `/buy`, `/sell`.
- Fee ledger: platform cut per trade with a channel revenue share.

**Unverified:** the Jupiter swap integration has never run against the real API — the
environment this was built in blocks Jupiter and Dexscreener at the network level.
`npm run probe:jupiter` is the gate that must pass before `TRADING_MODE=live`. Jupiter has
relocated this endpoint before, so confirm `JUPITER_API_URL` against their current docs.

**Not built:** paying accrued fees out (they accrue; sending them is manual), position
reconciliation against on-chain state, per-channel filters like minimum liquidity.

### Simulation vs live

`TRADING_MODE` defaults to simulation. Routes, prices, and sizes are real — only the
transaction submission is skipped — so the whole path runs without moving funds. Setting
it to `live` is what makes the engine spend actual SOL.

### Before you deploy

```bash
npm run preflight
```

Reports every missing or misconfigured environment variable, and what breaks without it.

## How copying works

1. Open the bot, tap **Open Xzy**. A wallet is created on first open; deposit SOL to it.
2. Pick a channel from the marketplace.
3. Set four things: SOL per trade, max SOL per day, a take-profit ladder, a stop loss.
4. Tap **Start copying**.

From then on, when that channel posts a Solana mint: the call is journalled, checked
against your per-trade size, your remaining daily budget, and your balance, and bought if
all three pass. A minute-by-minute monitor then sells at your levels.

Take-profit percentages are of the **original** position, so "50% at 2x, 50% at 3x" sells
all of it. A gap up through several levels fires them in order. A stop loss exits
everything and takes precedence over any take-profit the price gapped past.

If a price feed goes down, positions are held rather than exited — a feed outage must
never read as a price crash.

## Setup

```bash
npm install
cp .env.example .env        # fill in the values, see below
npm run check               # typecheck + tests + build
npm run dev
```

### Environment

See `.env.example`. Generate the two webhook secrets yourself:

```bash
openssl rand -hex 32   # TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 16   # TELEGRAM_WEBHOOK_PATH
```

`XZY_BOT_TOKEN` comes from BotFather and is a password: anyone holding it controls the
bot. It belongs in your host's secret store, never in the repo and never in a chat.

### Database

Apply `supabase/schema.sql` to a fresh Supabase project. Every table has row-level
security enabled with no anon policy, so a leaked public key reads nothing; all access
goes through server code holding the service key.

### Registering the webhook

After deploying to an HTTPS origin:

```bash
npm run webhook:set
```

This requests `my_chat_member` explicitly — Telegram does **not** deliver that update
type by default, and channel listing does not work without it.

## Layout

```
app/                      Next.js routes
  api/tg/webhook/[secret] Telegram webhook receiver
  api/me, api/channels    Mini App API, authenticated by initData
lib/telegram/verify.ts    initData HMAC verification — the auth boundary
lib/telegram/parser.ts    mint extraction from post text
lib/solana/base58.ts      base58 decoder used to validate mints
server/webhook.ts         update routing, all side effects injected
server/deps.ts            real implementations of those side effects
supabase/schema.sql       tables, constraints, indexes, RLS
test/                     node:test suites
```

`server/webhook.ts` takes its side effects as parameters so the full decision tree —
which posts become calls, which channels get listed, who is told what — is tested
without a network, a database, or a live bot.

## Verifying changes

```bash
npm run check
```

Typecheck, tests, and a production build. Nothing ships red.

## Risk

Copy trading memecoins loses money for most people who try it. Xzy does not vet the
tokens a channel posts. A listed channel is not a recommendation.
