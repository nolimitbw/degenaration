# Discord bot — real-server integration

End-to-end flow, now fully built:

```
Discord group owner adds the bot -> owner types !register in their call channel
  -> channel shows as PENDING in site Admin (/admin/channels) -> you approve it
  -> bot forwards every call in that channel to POST /api/ingest-call
  -> site records the call (Alpha/Calls leaderboard) -> the 24/7 worker mirrors it
     to that group's subscribers (delegated signing, per-user size + daily cap).
```

## 1. Create the bot (Discord Developer Portal)
1. Current bot app: `De Generation PR` (`1522107717836214405`).
2. Bot tab -> Add Bot -> copy the **token** (DISCORD_BOT_TOKEN).
3. Enable **Message Content Intent** (Bot -> Privileged Gateway Intents).
4. OAuth2 -> URL Generator -> scopes `bot`, permissions `Read Messages/View Channels` +
   `Read Message History`. Share this invite URL with group owners:
   `https://discord.com/oauth2/authorize?client_id=1522107717836214405&permissions=68608&scope=bot%20applications.commands`

## 2. Database (Supabase SQL editor)
Run `supabase/discord-bot.sql` once (adds `call_channels`, call dedup/exec columns, and
subscription signing columns).
Run `supabase/call-source-platform.sql` once for source attribution and performance columns.
Production also has secret-checked bot RPCs for register, approved-channel refresh, and ingest,
so the Discord tracker path no longer needs a Supabase service-role key in Vercel or the bot.

## 3. Website env (Vercel -> Settings -> Environment Variables), then redeploy
- `BOT_SHARED_SECRET` — a long random string (the bot sends it as `x-bot-secret`).
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `ADMIN_KEY` — server-only key for /admin/channels if you want browser-based approvals.

## 4. Run the bot (Railway / Render / any Node host)
Deploy the real bot from `nolimitbw/Degencalls`, with env:
- `DISCORD_TOKEN`
- `BOT_SHARED_SECRET` (same as the website)
- `DEGENARATION_SITE_URL=https://degenaration.vercel.app`
- `CHANNELS_REFRESH_MS=30000`

## 5. Onboard a group
1. Group owner invites the bot (step 1 URL) to their server.
2. Owner types `!register` in the channel where they post calls (needs Manage Server).
3. You approve it at `/admin/channels`.
4. Done — new calls in that channel now auto-record and mirror to subscribers who toggled
   that group on in `/calls` (and granted delegated auto-trading in `/wallet`).

## Safety
- The bot only reads APPROVED channels (loaded from the DB, refreshed every 30s).
- The parser only ever extracts a base58 mint or a known token link — never executes text.
- Every call is rug-checked before any wallet moves; each subscriber has a per-call size and
  a daily cap; execution requires the worker's DELEGATED_SIGNING=on (off = watch-only).
