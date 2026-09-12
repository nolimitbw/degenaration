# Deployment

What must be true for DegenAration to actually function, derived from live database state
and from the environment variables the code really reads. Spec §24 release gates.

## Why this document exists

Requirement 6 asked why two approved Discord sources show no measured performance. The
live database answered it:

```
approved_groups        2      -- sources are approved
call_channels          2      -- channels are approved
calls                  1      -- ONE call, in 12 days, via the /alpha slash command
raw_signals            0      -- the journal has never received anything
market_snapshots       0      -- no price has ever been sampled
performance_snapshots  0      -- nothing has ever been aggregated
durable_jobs           0
worker_leases          0      -- the worker has never taken a lease
```

The single call has `last_scanned_at = NULL` and identical called / peak / latest prices —
captured once at ingestion and never refreshed.

**The dashes on the marketplace are correct.** There is genuinely nothing measured. This
was never a code defect.

## Root cause: the Discord bot had no deployment target

`render.yaml` defined exactly one service, `degenaration-worker`, whose `startCommand`
runs `worker.js`. The Discord gateway bot is a **separate program** — `server/bot/index.js`,
with its own `package.json` and its own `discord.js` dependency — and it was not in the
file at all. It therefore never ran as a managed service, so no gateway listener existed to
observe messages.

A second service, `degenaration-discord-bot`, has now been added (type `worker`, since it
holds a gateway connection and serves no HTTP).

## The env var gap

The code reads **24** variables. `render.yaml` previously declared **11**. Thirteen were
undeclared, including every one the bot cannot start without:

| Variable | Needed by | Consequence when missing |
|---|---|---|
| `DISCORD_BOT_TOKEN` | bot | Cannot connect to Discord **at all** |
| `INGEST_URL` | bot | Calls are parsed and then go nowhere |
| `BOT_SHARED_SECRET` | bot + engine | Bot → site requests are unauthenticated and rejected |
| `SITE_URL`, `NEXT_PUBLIC_SITE_URL` | bot | Broken links in bot replies |
| `BOT_REGISTER_URL`, `BOT_APPROVED_CHANNELS_URL`, `BOT_GUILD_STATUS_URL` | bot | `/register`, channel refresh, `/degen status` fail |
| `SOLANA_RPC_URL` | worker safety checks | Falls back to a public endpoint; rate limits cause fail-closed blocks |
| `RELAY_CHANNEL_ID`, `TELEGRAM_BOT_TOKEN`, `CHANNELS_REFRESH_MS`, `BOT_BUILD` | bot | Optional |

All are now declared with `sync: false`, so Render prompts for each rather than starting a
service that silently does nothing.

## Owner actions, in order

These need credentials or authorization that only the owner holds. None can be done from a
development session.

1. **Set `PLATFORM_FEE_ACCOUNT`** to the destination fee wallet, on the worker service and
   in Vercel. Until then `configuredPlatformFeeBps()` returns 0 and **no fee is collected
   on any trade** — the entire proven fee model earns nothing.
2. **Set `DISCORD_BOT_TOKEN`, `INGEST_URL`, `BOT_SHARED_SECRET`** and deploy
   `degenaration-discord-bot`. This is what starts ingestion and closes requirement 6.
   Confirm afterwards that `raw_signals` begins to grow and that the duplicate `/register`
   is gone from the Discord client.
3. **Deploy the worker** so the performance scanner runs. Confirm `market_snapshots` grows
   and that `calls.last_scanned_at` stops being NULL.
4. **Fund a devnet wallet** and exercise one withdrawal end to end. The rules have 11 unit
   tests and the RPC's locked-capital query is verified against live Postgres
   (in-flight buy intents counted, sells and terminal states excluded), but no real signature
   has ever been produced.
5. **Decide on `public.calls`** — see `DATABASE_AUDIT.md` S-1. It is world-readable
   including raw message bodies and caller names. Negligible at 1 row; it scales the moment
   ingestion starts, so decide before step 2.
6. **Decide on RLS for `app_private.call_executions`** — low severity (the schema is not
   reachable by API roles) but it is the only table without RLS.

## Keep automation off until reviewed

`WORKER_NET=devnet`, `DELEGATED_SIGNING=off`, and `COPY_TRADING=off` are deliberate. Steps
2 and 3 make the bot and scanner run — they do **not** enable automated execution. Turning
that on is a separate, explicit decision gated on controlled review (§12, §13), and nothing
in this remediation flips it.
