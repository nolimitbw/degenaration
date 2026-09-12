# Deploying the worker to Render's free tier

Railway's trial expired and removed every deployment, which is the sole cause of 13 of the 18
failing readiness checks in production. This moves the worker to a free host.

**Vercel cannot do this job.** The worker is a web service running five polling loops — call
watcher every 8s, copy watcher 10s, limits 8s, heartbeat 30s, performance 300s. Vercel functions
cap at 300s and cannot hold a loop, and the Hobby plan allows two cron jobs at one run per day,
both already used. A stop-loss that checks once a day is not a stop-loss. Vercel keeps the two
jobs whose cadence genuinely suits it: the Discord history backfill and the call-price scanner.

---

## What you do

### 1. Create the blueprint

Render dashboard → **New** → **Blueprint** → this repository → branch
`codex/final-degenaration-2026-08-08`.

`render.yaml` declares the worker as `type: web`, `plan: free`, `rootDir: server`,
`healthCheckPath: /health`. Render's free tier covers web services, so this one qualifies.

**Deploy only `degenaration-worker`.** The second service in the file,
`degenaration-discord-bot`, is `type: worker` and Render does not offer background workers on
the free plan — it is marked `plan: starter` for that reason. You do not need it yet:
`degencalls` is already listening in both approved guilds, and the Vercel backfill cron covers
the rest.

### 2. Set the secrets

Every value below is declared `sync: false` in `render.yaml`, so Render will prompt for each one.
Copy them from the Railway service while you still have dashboard access.

```
SUPABASE_URL                SUPABASE_SERVICE_KEY
MAINNET_RPC                 SOLANA_RPC_URL
PRIVY_APP_ID                PRIVY_APP_SECRET        PRIVY_AUTHORIZATION_KEY
PLATFORM_FEE_ACCOUNT        BOT_SHARED_SECRET
```

Two you set deliberately rather than copy:

| Variable | First deploy | Why |
|---|---|---|
| `WORKER_NET` | `mainnet` | This was hardcoded to `devnet`. Production requires `network === "mainnet"`, so a devnet worker deploys green and the app correctly refuses to trust it — the most expensive kind of wrong. |
| `DELEGATED_SIGNING` | `off` | Watch-only. Bring the service up and confirm it heartbeats before it can sign anything. |

### 3. Point the app at it

Render will give the service a URL like `https://degenaration-worker.onrender.com`. Set it on
**Vercel** as `AUTOMATION_WORKER_URL`, then redeploy the app.

Until this is set, `workerHealth` stays failed no matter how healthy the worker is — the app has
no address to ask.

---

## Sleep, and why the worker now pings itself

Render suspends a free web service after roughly fifteen minutes without an **inbound** HTTP
request. A suspended worker is not watch-only, it is absent: it misses the calls it exists to
catch and its lease goes stale. None of its own polling counts, because that traffic is outbound.

So the worker requests its own public URL every ten minutes. The round trip leaves the platform
and returns through the router, which is what the idle timer measures. Render injects
`RENDER_EXTERNAL_URL` automatically, so there is nothing to configure; on any other host the
variable is absent and the whole block is inert.

**This prevents sleep, it does not end it.** A service already suspended has no process to run
the timer. If you ever find it asleep, one request to `/health` wakes it and the ping resumes.

---

## Verifying, in order

**1. The service is up**

```bash
curl -s https://<your-worker>.onrender.com/health | jq '{status, mode, network, signingEnabled}'
```

Expect `status: "ok"`, `mode: "watch-only"`, `network: "mainnet"`, `signingEnabled: false`.

**2. It is reporting into the database** — this is the check that matters, because it is the one
the app actually asks. `app_private.worker_leases` was empty for the entire life of the project
while the worker ran, because nothing ever called the writer.

```sql
select instance_id, expires_at, updated_at from app_private.worker_leases order by updated_at desc;
```

A row should appear within 30 seconds and refresh continuously.

**3. The app agrees**

```bash
curl -s https://degenaration.vercel.app/api/platform/config | jq '.automation.failedCheck'
```

`workerLease` should stop being the answer.

**4. The journal starts filling by itself.** The performance scanner runs in-process every 300s,
so the Vercel cron becomes a backstop rather than the only path.

---

## Only then, signing

Set `DELEGATED_SIGNING=on`. With the master gate already enabled, this is the last switch between
a saved bot and a real trade.

The worker refuses to start with signing on unless it can also exit a position — see the
`REFUSING TO START` guard in `server/worker.js`. That is deliberate: a bot that can enter and
cannot exit is worse than one that does nothing.

Suggested sequence: watch-only for a day, confirm the lease is steady and the journal is
scanning, then enable signing with one funded test wallet before anyone else's money is in scope.

---

## Still outstanding after this

The platform fee account. You collect **0%** until the Associated Token Account exists — and you
do not need the fee wallet's private key to create it. See `docs/ai/OWNER_RUNBOOK.md`.
