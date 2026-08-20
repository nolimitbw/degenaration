# CLAUDE.md — Xzy

Telegram-native copy trading for Solana memecoins. **This app moves real money.** A bug
here costs users funds, not a re-render.

## Read first, every session

1. This file.
2. `README.md` — what works, what is unverified, what is not built.
3. `DEPLOY.md` — the deployment path and the parts that fail silently.
4. `PROJECT.md` — why this lives inside the degenaration repo and shares nothing with it.

If this file conflicts with what the code actually does, **the code wins** — and fix this
file in the same commit.

## Hard boundary: Xzy is not degenaration

Xzy sits at `xzy/` inside the `degenaration` repo purely for storage. It shares no code,
no tables, no config, no deployment.

- Never `import` anything from outside `xzy/`. Never make degenaration import from here.
- Never touch files above `xzy/` except the root `tsconfig.json` exclusion, which must
  keep listing `"xzy"` — without it 337 type errors from this project leak into
  degenaration's typecheck.
- Work from inside `xzy/`. `cd xzy` before anything.

## What exists

```
app/api/tg/webhook/[secret]/  Telegram webhook receiver
app/api/{me,channels,wallet,subscriptions,positions}/  Mini App API, initData-authenticated
app/api/cron/monitor/         one exit-rule pass over open positions
app/page.tsx                  the Mini App
components/CopySetup.tsx      the whole configuration screen
lib/telegram/verify.ts        initData HMAC — the Mini App's entire auth boundary
lib/telegram/parser.ts        mint extraction from post text
lib/solana/{base58,wallet}.ts base58 decode; AES-256-GCM wallet encryption
lib/trading/rules.ts          take-profit ladders and stop loss (pure)
lib/trading/caps.ts           per-trade and daily spend limits (pure)
lib/trading/jupiter.ts        quotes and swap submission
server/webhook.ts             update routing, side effects injected
server/copy.ts                one call -> buys for every eligible subscriber
server/monitor.ts             one tick -> sells whatever the rules say
server/{deps,trading-deps}.ts real implementations of those injected effects
supabase/schema.sql           tables, constraints, indexes, RLS
test/                         87 tests, node:test
```

**The pattern that matters:** `server/webhook.ts`, `server/copy.ts`, and `server/monitor.ts`
take every side effect as a parameter. That is why the money-moving decision tree is
testable without a chain, a wallet, or a database. **Keep it that way.** If you add a
side effect, add it to the deps type — do not import a live client into those files.

## Invariants — changing any of these silently loses user money

- **Take-profit percentages are of the ORIGINAL position**, not the remainder. "50% at 2x,
  50% at 3x" sells all of it.
- **Stop loss is evaluated before take-profits and exits everything.** If price gapped
  through a TP down to the stop, the position is underwater now.
- **A zero, negative, or missing price is a broken feed — hold, never sell.** Panic-selling
  on an outage is the actual loss.
- **Daily spend is reserved before the buy, refunded on failure.** Over-count the day
  rather than under-count it.
- **Positions carry a copy of the exit rules from open time.** Editing a ladder must never
  rewrite a trade already running.
- **Dedup lives in the database**, in `positions (subscription_id, call_id)` and
  `calls (chat_id, message_id, event_version, mint)`. Telegram redelivers freely and a
  restart loses any in-memory guard.
- **A failed sell leaves its level un-hit** so the next tick retries.
- **One failing position must not abort the monitor tick** — that would block every other
  user's stop-loss.
- **Telegram user IDs are the identity anchor.** Usernames are reassignable; never key on one.
- **The webhook always answers 200 once authentic.** A non-2xx makes Telegram retry forever.

If a change requires breaking one of these, say so explicitly and explain the trade —
do not do it quietly.

## Verify before claiming done

```bash
cd xzy && npm run check     # typecheck + 87 tests + production build
```

Never edit a test, a type, or a script to make a failure disappear. If something fails,
report it failing.

**Tests passing is not the same as working.** For anything touching a route or the UI,
run it and exercise the real path:

```bash
npm run build && PORT=3000 \
  XZY_BOT_TOKEN=123456:fake TELEGRAM_WEBHOOK_SECRET=s1 TELEGRAM_WEBHOOK_PATH=p1 \
  WALLET_ENCRYPTION_KEY=$(printf 'c%.0s' {1..64}) CRON_SECRET=dev PUBLIC_APP_URL=http://localhost:3000 \
  npm start
```

Then POST a real update to `/api/tg/webhook/p1` with header
`x-telegram-bot-api-secret-token: s1` and check the outcome. Playwright can drive the Mini
App; stub the API routes with `page.route` and inject a signed `initData` via
`addInitScript`.

## Autonomy

Act. Do not ask permission for reversible work: which task is next, file layout, copy,
styling inside the palette, refactors, bug fixes, adding tests. Make the call, do it,
report what you observed.

**Stop and ask only for:**

1. Secrets only the owner has — bot token, Supabase keys, RPC keys.
2. Anything that spends real money: setting `TRADING_MODE=live`, funding a wallet,
   sending a mainnet transaction.
3. Deleting files you did not create, force-pushing, rewriting history.
4. A real fork in product direction.

Batch everything else into one list at the end of the turn.

## The current job: get it deployed

Nothing is running anywhere. Follow `DEPLOY.md`. What the owner must do personally
(accounts, secrets) versus what you can do (everything else) is marked there.

Things that fail **silently** and will waste an hour each:

- Vercel Root Directory must be `xzy`, or it builds the wrong project and succeeds.
- `setWebhook` must list `my_chat_member` in `allowed_updates`. Telegram omits it by
  default, so channel listing never fires and nothing errors.
- Vercel Hobby cron runs **daily**, not per-minute. Stop-losses would go unchecked for a
  day. Use an external scheduler.
- `getWebhookInfo` → `last_error_message` is the fastest diagnosis when the bot is silent.

## Known unknown: Jupiter

**The swap integration has never run against the live API.** It was built in a sandbox that
blocks Jupiter and Dexscreener.

```bash
npm run probe:jupiter
```

That must pass before `TRADING_MODE=live`. `JUPITER_API_URL` defaults to
`https://lite-api.jup.ag/swap/v1`; Jupiter has relocated this endpoint before, so verify
it against their current docs rather than trusting the default. If the probe fails, fixing
it is the highest-priority task in the project.

## Design

Gold `#f0b429`, white text, dim-black surfaces (`#080808` base, `#0d0d0d` panels), green
gains, red losses. Tokens live in `tailwind.config.ts`.

No gradient text, no glowing blobs, no glassmorphism, no neon washes, no emoji as UI
chrome. The Mini App is a mobile viewport inside Telegram — design for one thumb.

**Never render unknown as zero.** An unpriced position shows an em dash, not `0%`. A
channel with no measured calls says "not measured yet", not `0%`. Inventing a number the
user reads as a track record is worse than showing nothing.

The owner has said the UI needs a detailed, professional pass. Treat the current screens as
functional, not finished — but do not restyle them mid-task without being asked.

## Never

- Commit a real secret. `.env` is gitignored; keep it that way. If one is pasted into
  chat, say it must be rotated.
- Return, log, or send a wallet private key anywhere. It exists only inside
  `decryptSecretKey` and its immediate caller.
- Weaken `verifyInitData` or the webhook's two checks to make something work.
- Set `TRADING_MODE=live` on your own initiative.
- Claim something is verified when it was only tested.
