const { parseMessage } = require("../discord-parser");

const DISCORD_API = "https://discord.com/api/v10";
const PAGE_SIZE = 100;
const INGEST_CONCURRENCY = 5;

function buildHistoricalPayload({ channel, message, parsed }) {
  return {
    guildId: channel.guild_id,
    channelId: channel.channel_id,
    channelName: channel.channel_name || null,
    messageId: message.id,
    caller: message.member?.nick || message.author?.global_name || message.author?.username || "Discord caller",
    mint: parsed?.mint || null,
    confidence: parsed?.confidence || null,
    candidateType: parsed?.candidateType || null,
    rejectionReason: parsed?.rejected ? "ambiguous_mint" : null,
    eventType: "create",
    eventVersion: `history:${new Date(message.timestamp).toISOString()}`,
    editedAt: null
  };
}

const snowflakeMin = (messages) => messages.reduce((value, message) =>
  value === null || BigInt(message.id) < BigInt(value) ? message.id : value, null);
const snowflakeMax = (messages) => messages.reduce((value, message) =>
  value === null || BigInt(message.id) > BigInt(value) ? message.id : value, null);

function normalizeDiscordMessage(message, channel) {
  return {
    ...message,
    channel: { id: channel.channel_id, name: channel.channel_name || null },
    guild: { id: channel.guild_id },
    referencedMessage: message.referenced_message
      ? normalizeDiscordMessage(message.referenced_message, channel)
      : null
  };
}

async function discordJson(path, token, fetchImpl = fetch) {
  let response = await fetchImpl(`${DISCORD_API}${path}`, {
    headers: { authorization: `Bot ${token}`, "user-agent": "DegenAration journal backfill/1.0" },
    cache: "no-store"
  });
  if (response.status === 429) {
    const limited = await response.json().catch(() => ({}));
    const delay = Math.min(5000, Math.max(250, Number(limited.retry_after || 1) * 1000));
    await new Promise(resolve => setTimeout(resolve, delay));
    response = await fetchImpl(`${DISCORD_API}${path}`, {
      headers: { authorization: `Bot ${token}`, "user-agent": "DegenAration journal backfill/1.0" },
      cache: "no-store"
    });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Discord history request failed (${response.status})`);
  return data;
}

async function scanDiscordHistoryPage({ channel, state, token, ingest, saveState, fetchImpl = fetch }) {
  const completed = Boolean(state?.completed_at || state?.completed);
  const newest = state?.newest_message_id || null;
  const oldest = state?.oldest_message_id || null;
  const direction = completed ? "after" : "before";
  const cursor = completed ? newest : oldest;
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set(direction, cursor);
  const raw = await discordJson(`/channels/${channel.channel_id}/messages?${query}`, token, fetchImpl);
  const messages = Array.isArray(raw) ? raw.map(message => normalizeDiscordMessage(message, channel)) : [];
  messages.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));

  let accepted = 0;
  let rejected = 0;
  for (let index = 0; index < messages.length; index += INGEST_CONCURRENCY) {
    const batch = messages.slice(index, index + INGEST_CONCURRENCY);
    const results = await Promise.all(batch.map(async (message) => {
      const parsed = parseMessage(message);
      if (!parsed) return null;
      return ingest(buildHistoricalPayload({ channel, message, parsed }));
    }));
    for (const result of results) {
      if (result?.accepted) accepted += 1;
      else if (result?.rejected) rejected += 1;
    }
  }

  const nextNewest = messages.length ? snowflakeMax(messages) : newest;
  const nextOldest = messages.length ? snowflakeMin(messages) : oldest;
  const nextCompleted = completed || messages.length < PAGE_SIZE;
  const hasMore = messages.length === PAGE_SIZE;
  const messagesScanned = Number(state?.messages_scanned || 0) + messages.length;
  if (messages.length || !completed) {
    await saveState(channel.channel_id, {
      // During the historical walk, `newest` anchors the top of the archive while `oldest`
      // moves backwards. Once that walk is complete the direction flips: `newest` must move
      // forward after every catch-up page and the historical lower bound must stay intact.
      // Using `newest || nextNewest` here made every completed channel replay the same first
      // page forever, while replacing `oldest` destroyed the recorded journal range.
      newestMessageId: completed ? nextNewest : (newest || nextNewest),
      oldestMessageId: completed ? oldest : nextOldest,
      completed: nextCompleted,
      messagesScanned,
      lastError: null
    });
  }
  return {
    channelId: channel.channel_id,
    scanned: messages.length,
    accepted,
    rejected,
    completed: nextCompleted,
    hasMore
  };
}

module.exports = {
  DISCORD_API,
  PAGE_SIZE,
  INGEST_CONCURRENCY,
  normalizeDiscordMessage,
  buildHistoricalPayload,
  scanDiscordHistoryPage,
  snowflakeMin,
  snowflakeMax
};
