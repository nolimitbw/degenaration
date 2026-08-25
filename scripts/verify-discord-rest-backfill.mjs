import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { INGEST_CONCURRENCY, discordJson, discordRetryDelay, scanDiscordHistoryPage } = require("../lib/server/discord-rest-backfill");

assert.equal(INGEST_CONCURRENCY, 5, "history ingestion must stay bounded");

// Discord's global rate window can exceed the old five-second cap. Retrying early starts a
// fresh limited request every minute and can prevent the scanner from ever recovering.
const rateHeaders = { get: name => name === "retry-after" ? "32" : null };
assert.equal(discordRetryDelay({ headers: rateHeaders }, { retry_after: 2 }), 32_000);
assert.equal(discordRetryDelay({ headers: { get: () => null } }, { retry_after: 90 }), 45_000);
let rateFetches = 0;
let sleptFor = null;
const recovered = await discordJson("/channels/1/messages", "token", async () => {
  rateFetches += 1;
  if (rateFetches === 1) return { ok: false, status: 429, headers: rateHeaders, json: async () => ({ retry_after: 32 }) };
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
}, async delay => { sleptFor = delay; });
assert.deepEqual(recovered, []);
assert.equal(rateFetches, 2);
assert.equal(sleptFor, 32_000);

const channel = { channel_id: "1495930481018142801", channel_name: "calls", guild_id: "1495795490657275914" };
const mint = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const rows = [{
  id: "1495930481018142999",
  timestamp: "2026-01-01T00:00:00.000Z",
  content: "",
  embeds: [{ description: `CA: ${mint}` }],
  attachments: [],
  components: [],
  author: { id: "1495930481018142777", username: "relay", bot: true }
}];
const ingested = [];
let saved = null;
const result = await scanDiscordHistoryPage({
  channel,
  state: null,
  token: "token",
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => rows }),
  ingest: async payload => { ingested.push(payload); return { accepted: true }; },
  saveState: async (_channelId, state) => { saved = state; }
});

assert.equal(result.accepted, 1);
assert.equal(result.completed, true);
assert.equal(ingested[0].eventVersion, "history:2026-01-01T00:00:00.000Z");
assert.equal(ingested[0].mint, mint);
assert.equal(saved.newestMessageId, rows[0].id);
assert.equal(saved.oldestMessageId, rows[0].id);
assert.equal(saved.completed, true);

// A completed historical walk changes pagination direction. The persisted newest cursor must
// advance after a catch-up page, and the historical oldest bound must not be replaced by a
// recent message. This is the production regression that made every daily run return 200 while
// replaying the same first page forever.
const historicalOldest = "1400000000000000000";
const previousNewest = "1500000000000000000";
const caughtUpNewest = "1600000000000000000";
let catchupSaved = null;
const catchup = await scanDiscordHistoryPage({
  channel,
  state: {
    completed_at: "2026-08-09T00:00:00.000Z",
    newest_message_id: previousNewest,
    oldest_message_id: historicalOldest,
    messages_scanned: 100
  },
  token: "token",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => [{
      ...rows[0],
      id: caughtUpNewest,
      timestamp: "2026-08-10T00:00:00.000Z"
    }]
  }),
  ingest: async () => ({ accepted: true }),
  saveState: async (_channelId, state) => { catchupSaved = state; }
});

assert.equal(catchup.completed, true);
assert.equal(catchup.hasMore, false);
assert.equal(catchupSaved.newestMessageId, caughtUpNewest);
assert.equal(catchupSaved.oldestMessageId, historicalOldest);

// A full Discord page is not proof the catch-up is exhausted. The route uses this signal to
// keep walking within its bounded six-page budget instead of waiting another day per page.
const fullPage = Array.from({ length: 100 }, (_, index) => ({
  ...rows[0],
  id: String(BigInt(previousNewest) + BigInt(index + 1)),
  timestamp: new Date(Date.UTC(2026, 7, 10, 0, 0, index)).toISOString()
}));
const fullResult = await scanDiscordHistoryPage({
  channel,
  state: {
    completed_at: "2026-08-09T00:00:00.000Z",
    newest_message_id: previousNewest,
    oldest_message_id: historicalOldest,
    messages_scanned: 100
  },
  token: "token",
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => fullPage }),
  ingest: async () => ({ accepted: true }),
  saveState: async () => {}
});
assert.equal(fullResult.hasMore, true);

console.log("Vercel Discord REST history backfill preserves timestamp, advances catch-up cursors, and continues full pages.");
