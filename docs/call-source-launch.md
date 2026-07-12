# Call-source platform launch

## What it does

1. A caller adds the Degenaration Discord bot with only View Channels, Read Message
   History, and Send Messages permissions.
2. A server manager runs `!register` in each channel they explicitly want scanned.
3. The channel waits for platform approval. The bot ignores every non-approved channel.
4. Approved calls are recorded with their source, channel, caller, entry market data,
   and parser confidence. The original Discord message body and account id are not retained.
   The bot can also post the structured call to the official
   Degenaration Discord relay channel.
5. The worker refreshes each recent call against DexScreener. The site derives 2x hit
   rate, average/median peak multiple, best call, call count, and caller rankings from
   that persisted data.
6. A user compares those results on `/calls`, chooses a source, and saves their own
   copy size, stop-loss, take-profit, slippage, and daily cap.

## Required configuration

1. Run `supabase/call-source-platform.sql` after the existing `calls.sql` and
   `discord-bot.sql` migrations.
2. Add `RELAY_CHANNEL_ID` to the bot service. It must be the text-channel id of the
   Degenaration Discord channel that should receive approved source calls. Leave it
   unset to disable relaying while still recording calls.
3. Keep the existing bot environment variables: `DISCORD_BOT_TOKEN`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`, `BOT_SHARED_SECRET`, and `INGEST_URL`.
4. Run `node worker.js` with the same Supabase credentials. The performance scanner is
   watch-only: it reads public token data and never moves funds.

## Metric definition

- **Measured call:** an approved call with a captured entry price or market cap and a
  later live scan.
- **2x hit rate:** percentage of measured calls whose recorded peak reached 2.00x or
  higher than their entry.
- **Peak multiple:** highest observed price multiple since the call; it is not a
  subscriber's realized PnL and does not assume a user entered at exactly that price.
- **Current multiple:** latest observed price relative to entry. It is stored for the
  source feed and can be surfaced later without changing historical peak data.

The worker tracks calls for the latest 30 days so sources are compared on the same
current window. No claims should be made for a source until it has measured calls.
