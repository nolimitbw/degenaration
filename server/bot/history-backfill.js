/** Durable Discord journal backfill. State is persisted after every page, so a restart
 * resumes from the oldest confirmed cursor and never rescans an unchanged server journal. */

const PAGE_SIZE = 100;

function ordered(messages) {
  return [...messages.values()].sort((a, b) => Number(a.createdTimestamp) - Number(b.createdTimestamp));
}

async function scanChannel({ channel, state, saveState, ingestMessage, maxMessages, log }) {
  let messagesScanned = 0;
  let newestMessageId = state?.newest_message_id || state?.newestMessageId || null;
  let oldestMessageId = state?.oldest_message_id || state?.oldestMessageId || null;
  let completed = Boolean(state?.completed_at || state?.completed);

  // First recover anything posted while the listener was offline. Gateway events handle
  // messages after this process becomes ready; database idempotency closes the overlap.
  if (newestMessageId) {
    let after = newestMessageId;
    while (messagesScanned < maxMessages) {
      const page = await channel.messages.fetch({ limit: PAGE_SIZE, after });
      const batch = ordered(page);
      if (!batch.length) break;
      for (const message of batch) {
        await ingestMessage(message);
        messagesScanned += 1;
        after = message.id;
        newestMessageId = message.id;
      }
      await saveState(channel.id, { newestMessageId, oldestMessageId, completed, messagesScanned });
      if (batch.length < PAGE_SIZE) break;
    }
  }

  // A completed historical walk only needs the catch-up pass above.
  if (!completed) {
    let before = oldestMessageId || undefined;
    while (messagesScanned < maxMessages) {
      const page = await channel.messages.fetch({ limit: PAGE_SIZE, ...(before ? { before } : {}) });
      const batch = ordered(page);
      if (!batch.length) { completed = true; break; }
      if (!newestMessageId) newestMessageId = batch[batch.length - 1].id;
      for (const message of batch) {
        await ingestMessage(message);
        messagesScanned += 1;
      }
      oldestMessageId = batch[0].id;
      before = oldestMessageId;
      if (batch.length < PAGE_SIZE) completed = true;
      await saveState(channel.id, { newestMessageId, oldestMessageId, completed, messagesScanned });
      log("history.backfill.page", { channelId: channel.id, messages: batch.length, completed });
      if (completed) break;
    }
  }

  const truncated = !completed && messagesScanned >= maxMessages;
  await saveState(channel.id, {
    newestMessageId, oldestMessageId, completed, messagesScanned,
    lastError: truncated ? `safety limit reached at ${maxMessages} messages` : null
  });
  return { completed, truncated, messagesScanned };
}

async function backfillApprovedChannels({
  client, approvedChannels, getState, saveState, ingestMessage,
  maxMessagesPerChannel = 50000, log = () => {}
}) {
  const summary = { channels: 0, completedChannels: 0, truncatedChannels: 0, failedChannels: 0, messagesScanned: 0 };
  for (const channelId of Object.keys(approvedChannels)) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
        log("history.backfill.skipped", { channelId, reason: "channel is not readable text" });
        summary.failedChannels += 1;
        continue;
      }
      summary.channels += 1;
      const state = await getState(channelId);
      const result = await scanChannel({
        channel, state, saveState, ingestMessage,
        maxMessages: maxMessagesPerChannel, log
      });
      summary.messagesScanned += result.messagesScanned;
      if (result.completed) summary.completedChannels += 1;
      if (result.truncated) summary.truncatedChannels += 1;
    } catch (error) {
      summary.failedChannels += 1;
      await saveState(channelId, { completed: false, messagesScanned: 0, lastError: String(error?.message || error) }).catch(() => {});
      log("history.backfill.channel_failed", { channelId, error: String(error?.message || error).slice(0, 160) });
    }
  }
  log("history.backfill.completed", summary);
  return summary;
}

module.exports = { backfillApprovedChannels, scanChannel, ordered, PAGE_SIZE };
