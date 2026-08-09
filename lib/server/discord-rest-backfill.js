const { parseMessage } = require("../../server/bot/parser");
const { buildIngestPayload } = require("../../server/bot/ingest");

const DISCORD_API = "https://discord.com/api/v10";
const PAGE_SIZE = 100;

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
  for (const message of messages) {
    const parsed = parseMessage(message);
    if (!parsed) continue;
    const timestamp = new Date(message.timestamp).toISOString();
    const payload = buildIngestPayload({
      guildId: channel.guild_id,
      channelId: channel.channel_id,
      channelName: channel.channel_name,
      messageId: message.id,
      caller: message.member?.nick || message.author?.global_name || message.author?.username || "Discord caller",
      call: parsed.mint ? parsed : null,
      rejectionReason: parsed.rejected ? "ambiguous_mint" : null,
      eventType: "create",
      eventVersion: `history:${timestamp}`
    });
    const result = await ingest(payload);
    if (result?.accepted) accepted += 1;
    else if (result?.rejected) rejected += 1;
  }

  const nextNewest = messages.length ? snowflakeMax(messages) : newest;
  const nextOldest = messages.length ? snowflakeMin(messages) : oldest;
  const nextCompleted = completed || messages.length < PAGE_SIZE;
  const messagesScanned = Number(state?.messages_scanned || 0) + messages.length;
  if (messages.length || !completed) {
    await saveState(channel.channel_id, {
      newestMessageId: newest || nextNewest,
      oldestMessageId: nextOldest,
      completed: nextCompleted,
      messagesScanned,
      lastError: null
    });
  }
  return { channelId: channel.channel_id, scanned: messages.length, accepted, rejected, completed: nextCompleted };
}

module.exports = {
  DISCORD_API,
  PAGE_SIZE,
  normalizeDiscordMessage,
  scanDiscordHistoryPage,
  snowflakeMin,
  snowflakeMax
};
