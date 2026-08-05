/**
 * The listener's decision logic, separated from the gateway connection.
 *
 * Why this file exists: index.js registers every handler with `client.on(...)` at module
 * scope and calls `client.login()` on import. Requiring it therefore opens a Discord
 * connection, which made the exact code deployed to Railway the only stage of the ingestion
 * chain no test could execute. The parser was covered, the ingest RPC was covered, the
 * fan-out was covered — and the part that decides *whether the parser is called at all* was
 * not. Everything that gate gets wrong looks identical to a quiet channel:
 *
 *   - the approved-channel lookup,
 *   - skipping only our own messages rather than every bot (a call channel is bots),
 *   - the reply fallback, and its rule that a parent's ambiguity is not the reply's fault,
 *   - the "Discord attached the embed after the message" case, which is the one that
 *     carries the mint when the original content was a bare URL,
 *   - the delete gate, which forwards a retraction only for a message that became a call.
 *
 * index.js keeps the wiring and supplies the Discord-shaped dependencies; this file holds
 * the decisions. Nothing here imports discord.js, so it runs under a plain fixture.
 */

const INGESTED_LIMIT = 5000;

/**
 * Message IDs this process successfully ingested.
 *
 * Bounded: a long-running bot in an active server would otherwise grow this without limit.
 * Losing the oldest entries only means an old deletion is not journaled, which is the safe
 * direction — the alternative is opening a raw signal and a rejected parse for every
 * deleted message in the channel, burying the retractions that matter under moderation.
 */
class IngestedMessages {
  constructor(limit = INGESTED_LIMIT) {
    this.limit = Math.max(1, limit);
    this.ids = new Set();
  }

  remember(messageId) {
    this.ids.add(messageId);
    while (this.ids.size > this.limit) {
      const oldest = this.ids.values().next().value;
      this.ids.delete(oldest);
    }
    return this;
  }

  has(messageId) {
    return this.ids.has(messageId);
  }

  forget(messageId) {
    return this.ids.delete(messageId);
  }

  get size() {
    return this.ids.size;
  }
}

function callerName(msg) {
  return String(msg?.member?.displayName || msg?.author?.globalName || msg?.author?.username || "Discord caller").slice(0, 100);
}

/**
 * Build the three gateway handlers.
 *
 * Every dependency is a function rather than a value because each one is live at the moment
 * the event arrives: the approved-channel map is refreshed on a timer, and the bot's own id
 * does not exist until the client is ready.
 */
function createMessageHandlers({
  parseMessage,
  ingestEvent,
  approvedChannel,
  selfId = () => null,
  log = () => {},
  noteFreshness = () => {},
  ingested = new IngestedMessages(),
  onLegacyRegister = null,
  onError = (scope, error) => console.error(`[bot] ${scope} failed:`, error?.message)
}) {
  /**
   * Resolve a message into a parse result, including the message it replied to.
   *
   * The parent is only consulted when the reply itself carries nothing, so an ordinary
   * reply to a call does not re-ingest that call. It is read from the channel cache first;
   * a parent that is neither cached nor fetchable simply means the reply is treated on its
   * own content, which is the safe direction.
   */
  async function parseWithContext(msg) {
    const direct = parseMessage(msg);
    if (direct) return direct;
    const parentId = msg?.reference?.messageId;
    if (!parentId) return null;
    let parent = msg.channel?.messages?.cache?.get?.(parentId) || null;
    if (!parent && typeof msg.fetchReference === "function") {
      parent = await msg.fetchReference().catch(() => null);
    }
    return parent ? parseMessage({ ...msg, referencedMessage: parent }) : null;
  }

  /**
   * Ingest one detected call and report what happened either way.
   *
   * A rejection is logged rather than dropped silently. "We saw two addresses and refused to
   * pick one" is the single most useful thing an owner can be told about a source whose
   * calls are not appearing, and it was previously indistinguishable from no message at all.
   */
  async function handleDetectedCall({ msg, group, parsed, eventType, eventVersion, editedAt }) {
    if (parsed?.rejected) {
      log("call.rejected", {
        channelId: msg.channel.id, messageId: msg.id, group: group.groupName || group.groupId,
        reason: parsed.rejected, candidates: parsed.candidates, eventType
      });
      return null;
    }
    if (!parsed?.mint) return null;
    noteFreshness(msg.channel.id, "lastDetected");
    log("call.detected", {
      channelId: msg.channel.id, messageId: msg.id, group: group.groupName || group.groupId,
      mint: parsed.mint, confidence: parsed.confidence, eventType
    });
    try {
      return await ingestEvent({
        channelId: msg.channel.id,
        channelName: msg.channel.name,
        messageId: msg.id,
        caller: callerName(msg),
        group,
        call: parsed,
        eventType,
        eventVersion,
        editedAt
      });
    } catch (e) {
      onError("ingest", e);
      return null;
    }
  }

  async function onMessageCreate(msg) {
    if (!msg?.guild) return;
    // Our own messages only — NOT all bots. Call channels overwhelmingly relay through a
    // webhook or a companion bot, so `author.bot` excluded exactly the messages that carry
    // the calls. Skipping just ourselves keeps the relay embed from feeding back in.
    if (msg.author?.id && msg.author.id === selfId()) return;

    // Legacy fallback: `!register` in the channel they want watched.
    if (onLegacyRegister && !msg.author?.bot && String(msg.content || "").trim().toLowerCase() === "!register") {
      await onLegacyRegister(msg);
      return;
    }

    // Otherwise: only act in APPROVED call channels.
    const group = approvedChannel(msg.channel?.id);
    if (!group) return;

    const parsed = await parseWithContext(msg);
    return handleDetectedCall({ msg, group, parsed, eventType: "create", eventVersion: "original" });
  }

  /**
   * Edits, and the embed that arrives after the message.
   *
   * Two different events reach this handler and they are not the same thing:
   *
   *  1. A real user edit. The mint may have changed, so the journal supersedes the previous
   *     call and records a new one — `bot_ingest_discord_signal_v2` already implements that,
   *     and until recently nothing ever called it with `eventType: "edit"`.
   *  2. Discord attaching an unfurled embed to an unchanged message, moments after it was
   *     posted. `editedTimestamp` stays null for this. It matters because a message whose
   *     only content is a bare URL has no mint at create time and DOES have one once the
   *     embed lands — so treating it as noise loses the call entirely.
   */
  async function onMessageUpdate(oldMessage, newMessage) {
    try {
      const msg = newMessage?.partial && typeof newMessage.fetch === "function"
        ? await newMessage.fetch().catch(() => null)
        : newMessage;
      if (!msg?.guild) return;
      if (msg.author?.id && msg.author.id === selfId()) return;
      const group = approvedChannel(msg.channel?.id);
      if (!group) return;

      const editedAt = msg.editedTimestamp ? new Date(msg.editedTimestamp).toISOString() : null;
      const wasEdited = Boolean(editedAt) && (oldMessage?.partial || oldMessage?.editedTimestamp !== msg.editedTimestamp);

      if (wasEdited) {
        const parsed = await parseWithContext(msg);
        return await handleDetectedCall({ msg, group, parsed, eventType: "edit", eventVersion: String(msg.editedTimestamp), editedAt });
      }

      // Case 2. Only worth ingesting when the embed supplied something the original content
      // did not; otherwise the create already journaled it and this would be pure duplicate.
      if (parseMessage({ content: msg.content })?.mint) return;
      const fromEmbed = parseMessage(msg);
      if (!fromEmbed?.mint) return;
      return await handleDetectedCall({ msg, group, parsed: fromEmbed, eventType: "create", eventVersion: "embed" });
    } catch (e) {
      onError("message update", e);
    }
  }

  /**
   * A deleted call is retracted, not forgotten.
   *
   * Forwarded only for a message this process actually ingested. A blanket forward would
   * open a raw signal and a rejected parse for every deleted message in the channel, which
   * buries the retractions that matter among ordinary moderation.
   */
  async function onMessageDelete(message) {
    try {
      if (!ingested.has(message?.id)) return;
      const group = approvedChannel(message?.channel?.id);
      if (!group) return;
      ingested.forget(message.id);
      log("call.deleted", { channelId: message.channel.id, messageId: message.id, group: group.groupName || group.groupId });
      return await ingestEvent({
        channelId: message.channel.id,
        channelName: message.channel?.name,
        messageId: message.id,
        caller: null,
        group,
        call: null,
        eventType: "delete",
        eventVersion: "deleted",
        editedAt: new Date().toISOString()
      });
    } catch (e) {
      onError("message delete", e);
    }
  }

  return { onMessageCreate, onMessageUpdate, onMessageDelete, parseWithContext, handleDetectedCall };
}

module.exports = { createMessageHandlers, IngestedMessages, callerName, INGESTED_LIMIT };
