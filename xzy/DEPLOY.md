# Deploying Xzy

**Nothing works until this is done.** The code in this folder is not running anywhere.
Telegram delivers messages by calling a URL you register with it; until that URL exists
and answers, the bot is silent no matter what the code says.

There are three layers, and each one lights up more of the product:

| Layer | What you need | What starts working |
| --- | --- | --- |
| 1. Deploy | A host + 4 env vars | `/start`, `/help`, `/list` reply |
| 2. Database | A Supabase project | Channel listing, calls, the Mini App |
| 3. Trading | Encryption key + scheduler | Wallets, copying, take-profit, stop-loss |

Do them in order. Layer 1 takes about ten minutes and is how you confirm the bot is alive.

---

## Layer 1 — get the bot replying

### 1. Revoke the exposed token

The token from BotFather was posted in a screenshot, so it is public. In Telegram:
BotFather → `/mybots` → `xzyofficialbot` → **API Token** → **Revoke current token**.

Copy the new one. It goes into a host's environment variable, never into this repo,
never into a chat.

### 2. Generate two secrets

On your Mac, in Terminal:

```bash
openssl rand -hex 32   # this is TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 16   # this is TELEGRAM_WEBHOOK_PATH
```

Keep both. They are what stops anyone who learns your URL from feeding the bot fake calls.

### 3. Deploy

Vercel is the least work. At vercel.com → **Add New → Project** → import
`nolimitbw/degenaration`.

**Set Root Directory to `xzy`.** This is the step everyone misses. Xzy is a subfolder;
without this Vercel builds degenaration instead and nothing here ever runs.

Add these four environment variables:

| Name | Value |
| --- | --- |
| `XZY_BOT_TOKEN` | the new token from step 1 |
| `TELEGRAM_WEBHOOK_SECRET` | the 32-byte hex from step 2 |
| `TELEGRAM_WEBHOOK_PATH` | the 16-byte hex from step 2 |
| `PUBLIC_APP_URL` | your deployment's URL, e.g. `https://xzy.vercel.app` |

`PUBLIC_APP_URL` is a chicken-and-egg: deploy once, copy the URL Vercel gives you, set the
variable, redeploy.

### 4. Register the webhook

This is the step that connects Telegram to your deployment. Nothing works without it.
From your Mac, with the same values:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://<YOUR_APP>.vercel.app/api/tg/webhook/<TELEGRAM_WEBHOOK_PATH>",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message","channel_post","edited_channel_post","my_chat_member","callback_query"],
    "drop_pending_updates": true
  }'
```

You should get `{"ok":true,"result":true,...}`.

`allowed_updates` matters: **Telegram does not send `my_chat_member` by default.** Without
it listed, channel listing silently never fires — the bot gets promoted and nothing
happens.

### 5. Test

Message the bot `/start`. You should get a reply with an **Open Xzy** button.

If it stays silent, ask Telegram what it thinks is wrong:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```

`last_error_message` tells you exactly what is failing — a 401 means the secret does not
match, a 404 means the path segment does not, and a 503 means the app is missing an
environment variable.

---

## Layer 2 — the database

1. Create a project at supabase.com.
2. SQL Editor → paste all of `supabase/schema.sql` → Run.
3. Project Settings → API → copy the **Project URL** and the **service_role** key.
4. Add to your host:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | the project URL |
| `SUPABASE_SERVICE_KEY` | the service_role key |
| `ADMIN_TELEGRAM_IDS` | your numeric Telegram ID (ask @userinfobot) |

The service_role key bypasses row-level security. It belongs only in server environment
variables — never in the repo, never in anything a browser can read.

Now channel listing works: add the bot as an admin to a channel and it appears as pending.
Approving it currently means flipping `status` to `approved` and setting `approved_at` in
the Supabase table editor — the admin UI is not built yet.

### The Mini App button

BotFather → `/mybots` → your bot → **Bot Settings → Menu Button** → set it to your
`PUBLIC_APP_URL`. That is what makes **Open Xzy** launch the app.

---

## Layer 3 — trading

```bash
openssl rand -hex 32   # this is WALLET_ENCRYPTION_KEY
openssl rand -hex 32   # this is CRON_SECRET
```

| Name | Value |
| --- | --- |
| `WALLET_ENCRYPTION_KEY` | 64 hex chars. **Back this up.** It decrypts every user wallet — lose it and every wallet is unrecoverable |
| `CRON_SECRET` | 64 hex chars, for the monitor endpoint |
| `SOLANA_RPC_URL` | a real RPC provider; the public endpoint is rate-limited into uselessness |
| `TRADING_MODE` | leave unset or `simulate` until you have done the checks below |

### The scheduler

Take-profit and stop-loss only fire when something calls `/api/cron/monitor`. Nothing calls
it on its own.

`vercel.json` declares a one-minute cron, but **Vercel's Hobby plan only runs crons once
per day**, which is useless for stop-losses. Either upgrade to Pro, or point an external
scheduler at it — cron-job.org runs every minute on its free tier:

- URL: `https://<YOUR_APP>.vercel.app/api/cron/monitor`
- Method: POST
- Header: `Authorization: Bearer <CRON_SECRET>`

Confirm it works by calling it yourself; a healthy response looks like
`{"ok":true,"checked":0,"exits":0,"closed":0,"errors":0}`.

### Before `TRADING_MODE=live`

```bash
cd xzy && npm run probe:jupiter
```

This quotes a real route and derives an entry price. **It has never been run against the
live API** — the environment Xzy was built in blocks Jupiter and Dexscreener — so it is
genuinely unknown whether the swap integration works. If it fails, fix that before going
anywhere near real funds. Check `JUPITER_API_URL` against Jupiter's current docs; they have
moved that endpoint before.

Then: set `TRADING_MODE=live`, fund one wallet with a small amount, copy one channel with
the smallest per-trade size, and watch one real trade open and close before trusting it
with anything more.

---

## Running it locally instead

Telegram requires a public HTTPS URL, so a local server needs a tunnel:

```bash
cd xzy
npm install
cp .env.example .env      # fill it in
npm run dev               # runs on :3000
npx localtunnel --port 3000   # or ngrok http 3000
```

Use the tunnel's HTTPS URL as `PUBLIC_APP_URL` and in `setWebhook`. The URL changes each
time the tunnel restarts, so the webhook has to be re-registered each time.
