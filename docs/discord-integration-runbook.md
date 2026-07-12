# Discord alpha-group integration — runbook

The whole pipeline is built and wired. This is the definitive state + the only remaining steps.

## The flow (as designed, matches the product vision)
1. A calls-group owner applies at `/apply` (or DMs / opens a ticket in your Discord).
2. **You manually vet** the group (real calls, not a scam).
3. On approval, the owner adds **our bot** to their server with the invite link below.
4. The owner runs `!register` in the exact channel they post calls in (bot replies to confirm).
5. That channel appears as **pending** in `call_channels`; you **approve** it.
6. From then on the bot forwards every call in that channel to `/api/ingest-call`, which
   records it, posts a structured relay into the Degenaration Discord, and lets the 24/7
   worker mirror it to that group's subscribers (rug-checked, capped).
7. Users pick which approved groups to copy on `/calls`, where 2x hit rate, peak multiples,
   measured-call coverage, and recent calls are derived from scanner data.

## What is DONE and verified
- **Discord app** "De Generation PR" — client id `1522107717836214405`.
- **Message Content Intent: ENABLED** and **Server Members Intent: ENABLED** (verified in the
  Developer Portal — without Message Content the bot cannot read calls; it's on).
- **Bot invite link:**
  `https://discord.com/oauth2/authorize?client_id=1522107717836214405&permissions=68608&scope=bot%20applications.commands`
  (permissions 68608 = View Channels + Read Message History + Send Messages, i.e. read calls
  and reply to `!register`.)
- **Bot code** (`server/bot/`): listener, `!register` self-registration, Solana-mint parser,
  posts to `/api/ingest-call` with the shared secret. Complete.
- **Ingest API** (`app/api/ingest-call/route.ts`): bot-secret auth, approved-channel check,
  dedup by message id, live price enrichment. Complete.
- **Call watcher** (`server/engine/calls.js`): rug-check gate (now fail-closed), per-group
  subscriber fan-out, daily-cap throttle with writeback, delegated signing. Complete + tested.
- **DB schema**: `call_channels` + `calls` execution columns + `subscriptions` signing columns
  — migration RUN in production Supabase (was previously missing; caused the worker's
  `calls.executed_at does not exist` error, now resolved once PostgREST cache refreshed).
- **Website UI**: `/apply` (owner application), `/calls` (browse approved groups, toggle copy,
  per-group settings). Complete.
- **Call-source measurement**: `supabase/call-source-platform.sql` adds source attribution and
  price/market-cap tracking. `server/engine/performance.js` refreshes recent calls so public
  metrics are earned, not supplied by a caller.

## Remaining steps
1. **Deploy/push `nolimitbw/Degencalls`** with the latest bridge code.
2. **Bot env**: `DISCORD_TOKEN`, `BOT_SHARED_SECRET`, `DEGENARATION_SITE_URL=https://degenaration.vercel.app`,
   and `CHANNELS_REFRESH_MS=30000`.
3. **Admin approval**: approve pending `call_channels` rows. The bot only records channels
   whose row is `status = approved`.

## Notes
- There are multiple "De Generation" apps in the portal. Use `1522107717836214405` because it
  matches the current `DISCORD_BOT_TOKEN`; consider deleting the older duplicates to avoid confusion.
- The bot invite link can be sent to owners after you approve them (the `/apply` success
  screen already promises "a Discord DM with the bot invite link if approved").
