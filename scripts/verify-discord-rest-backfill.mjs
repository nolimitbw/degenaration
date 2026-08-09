import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { INGEST_CONCURRENCY, scanDiscordHistoryPage } = require("../lib/server/discord-rest-backfill");

assert.equal(INGEST_CONCURRENCY, 5, "history ingestion must stay bounded");

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

console.log("Vercel Discord REST history backfill preserves timestamp, cursor, and parsed mint.");
