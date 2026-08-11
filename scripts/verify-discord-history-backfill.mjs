import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { backfillApprovedChannels, scanChannel } = require("../server/bot/history-backfill");
const { createMessageHandlers } = require("../server/bot/handlers");
const { normalizeIngestRequest, buildIngestRpcParams } = require("../lib/discord-ingest");

const makeMessage = (n) => ({
  id: String(100000000000000000n + BigInt(n)),
  createdTimestamp: Date.UTC(2026, 0, 1) + n * 1000
});
const journal = Array.from({ length: 230 }, (_, index) => makeMessage(index + 1));
const channel = {
  id: "1495930481018142801",
  isTextBased: () => true,
  messages: {
    async fetch({ limit, before, after }) {
      let rows = journal;
      if (before) rows = rows.filter((message) => BigInt(message.id) < BigInt(before));
      if (after) rows = rows.filter((message) => BigInt(message.id) > BigInt(after));
      rows = after ? rows.slice(0, limit) : rows.slice(-limit);
      return new Map(rows.map((message) => [message.id, message]));
    }
  }
};

let durable = null;
const seen = [];
const saveState = async (_channelId, state) => {
  durable = {
    newest_message_id: state.newestMessageId || durable?.newest_message_id || null,
    oldest_message_id: state.oldestMessageId || durable?.oldest_message_id || null,
    completed: state.completed,
    messages_scanned: Math.max(durable?.messages_scanned || 0, state.messagesScanned || 0)
  };
};

const first = await scanChannel({
  channel, state: null, saveState,
  ingestMessage: async (message) => seen.push(message.id),
  maxMessages: 150, log: () => {}
});
assert.equal(first.truncated, true);
assert.equal(new Set(seen).size, 200, "a safety stop must finish the fetched page without losing its tail");

const secondSeen = [];
const second = await scanChannel({
  channel, state: durable, saveState,
  ingestMessage: async (message) => secondSeen.push(message.id),
  maxMessages: 150, log: () => {}
});
assert.equal(second.completed, true);
assert.equal(secondSeen.length, 30);
assert.equal(new Set([...seen, ...secondSeen]).size, 230, "resume must cover the whole journal exactly once");

// One guild may revoke access while another remains approved. That channel must be reported,
// not allowed to abort every later/earlier journal in the same run.
const isolatedSeen = [];
const isolatedSummary = await backfillApprovedChannels({
  client: {
    channels: {
      async fetch(id) {
        if (id === "blocked") throw new Error("Missing Access");
        return channel;
      }
    }
  },
  approvedChannels: { blocked: {}, readable: {} },
  getState: async () => ({ completed: true, newest_message_id: journal[228].id }),
  saveState: async () => {},
  ingestMessage: async (message) => isolatedSeen.push(message.id),
  maxMessagesPerChannel: 100,
  log: () => {}
});
assert.equal(isolatedSummary.failedChannels, 1);
assert.equal(isolatedSummary.channels, 1);
assert.equal(isolatedSeen.length, 1, "an inaccessible guild must not abort the readable guild");

const normalized = normalizeIngestRequest({
  guildId: "1495795490657275914",
  channelId: "1495930481018142801",
  messageId: "1495930481018142999",
  mint: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  eventType: "create",
  eventVersion: "history:2026-01-01T00:00:00.000Z"
});
assert.equal(normalized.ok, true);
assert.equal(normalized.historicalBackfill, true);
const params = buildIngestRpcParams({
  normalized,
  price: { symbol: "NOW", calledMcap: 999, calledPrice: 5, calledLiquidity: 100 },
  secret: "test"
});
assert.equal(params.p_called_price_usd, null);
assert.equal(params.p_called_mcap, null);
assert.equal(params.p_called_liquidity_usd, null);

let acknowledged = 0;
let ingestedVersion = null;
const handlers = createMessageHandlers({
  parseMessage: () => ({ mint: normalized.mint, confidence: "embed-address" }),
  ingestEvent: async (event) => {
    ingestedVersion = event.eventVersion;
    return { accepted: true, mint: event.call.mint };
  },
  approvedChannel: () => ({
    groupId: "source", groupName: "SLPR DEGEN", guildId: "1495795490657275914",
    scannerAcknowledgmentsEnabled: true
  }),
  acknowledge: async () => { acknowledged += 1; },
  selfId: () => "1495930481018142888"
});
await handlers.onHistoricalMessage({
  id: "1495930481018142999",
  createdTimestamp: Date.UTC(2026, 0, 1),
  content: normalized.mint,
  embeds: [], attachments: [], components: [],
  author: { id: "1495930481018142777", username: "caller", bot: true },
  guild: { id: "1495795490657275914" },
  channel: { id: "1495930481018142801", name: "calls" }
});
assert.equal(ingestedVersion, "history:2026-01-01T00:00:00.000Z");
assert.equal(acknowledged, 0, "historical calls must never reply into old Discord messages");

console.log("Discord history cursor, resume, completeness, timestamp, no-ack, and no-fabricated-price checks passed.");
