# Discord alpha-group integration — runbook

The whole pipeline is built and wired. This is the definitive state + the only remaining steps.

## The flow (as designed, matches the product vision)
1. A calls-group owner applies at `/apply` (or DMs / opens a ticket in your Discord).
2. **You manually vet** the group (real calls, not a scam).
3. On approval, the owner adds **our bot** to their server with the invite link below.
4. The owner runs `!register` in the exact channel they post calls in (bot replies to confirm).
5. That channel appears as **pending** in `call_channels`; you **approve** it.
6. From then on the bot forwards every call in that channel to `/api/ingest-call`, which
   records it; the 24/7 worker mirrors it to that group's subscribers (rug-checked, capped).
7. Users pick which approved groups to copy on `/calls`, with per-group size/TP/SL/cap.

## What is DONE and verified
- **Discord app** "De Generation" — client id `1521883553682559116`.
- **Message Content Intent: ENABLED** and **Server Members Intent: ENABLED** (verified in the
  Developer Portal — without Message Content the bot cannot read calls; it's on).
- **Bot invite link (verified — resolves to a real "Add a bot to a server" screen):**
  `https://discord.com/oauth2/authorize?client_id=1521883553682559116&permissions=68608&scope=bot`
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

## Remaining steps (need your credentials — I cannot handle tokens/secrets)
1. **Bot token**: Developer Portal → app `1521883553682559116` → Bot → Reset Token → copy it
   (shown once). This is a credential; keep it secret.
2. **Deploy the bot** as a second Railway service (same project as `degenaration-worker`):
   - Start command: `node bot/index.js` (root `server/`); ensure `discord.js` is installed in
     the deployed service (it's in `server/bot/package.json`).
   - Env vars: `DISCORD_BOT_TOKEN` (step 1), `BOT_SHARED_SECRET` (any long random string —
     must MATCH the frontend's, step 3), `INGEST_URL=https://degenaration.vercel.app/api/ingest-call`,
     `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CHANNELS_REFRESH_MS=30000`.
3. **Frontend secret**: set `BOT_SHARED_SECRET` in Vercel to the SAME value as the bot, so
   `/api/ingest-call` accepts the bot's posts. Redeploy.
4. **Admin approval**: approve pending `call_channels` rows (an admin action; the bot only
   reads channels whose row is `status = approved`).

## Notes
- There are 3 "De Generation" apps in the portal (duplicates). Use `1521883553682559116` —
  it's the one with the intents configured. Consider deleting the other two to avoid confusion.
- The bot invite link can be sent to owners after you approve them (the `/apply` success
  screen already promises "a Discord DM with the bot invite link if approved").
