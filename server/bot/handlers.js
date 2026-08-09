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
 * Message IDs this process successfully ingested. Kept only for local diagnostics now that
 * approved-channel deletes are always forwarded: a process-memory gate cannot preserve a
 * retraction across a restart. The database makes an unknown delete rejected evidence and
 * never a call, so durability no longer depends on this bounded cache.
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
 * Counts, not content.
 *
 * The single most useful fact about a message that produced no call is whether the process
 * could SEE it. `contentLength: 0` together with `embeds: 0` on a message a human watched
 * someone type is the signature of missing message content — the MessageContent intent or the
 * channel's Read Messages permission — and it is indistinguishable from "the parser found no
 * mint" unless the shape is recorded.
 *
 * Deliberately no text, no author id, no attachment URL. A call channel's messages are the
 * source owner's, not ours to copy into a log aggregator, and the counts are enough to decide
 * what to do next.
 */
function describeShape(msg) {
  const size = (value) => {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value.size === "number") return value.size;
    return 0;
  };
  const embeds = Array.isArray(msg?.embeds) ? msg.embeds : [];
  return {
    contentLength: typeof msg?.content === "string" ? msg.content.length : 0,
    embeds: embeds.length,
    // An embed with a title but no fields parses very differently from one with twenty.
    embedFields: embeds.reduce((total, embed) => total + (Array.isArray(embed?.fields) ? embed.fields.length : 0), 0),
    components: size(msg?.components),
    attachments: size(msg?.attachments),
    isReply: Boolean(msg?.reference?.messageId),
    authorIsBot: Boolean(msg?.author?.bot),
    viaWebhook: Boolean(msg?.webhookId)
  };
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
  acknowledge = async () => {},
  selfId = () => null,
  log = () => {},
  noteFreshness = () => {},
  ingested = new IngestedMessages(),
  onLegacyRegister = null,
  onError = (scope, error) => console.error(`[bot] ${scope} failed:`, error?.message)
}) {
  /** Messages seen in channels this process does not watch, by channel. Diagnostics only. */
  const unapprovedSeen = new Map();
  /** Messages seen in a watched channel that arrived from a DIFFERENT guild, by channel. */
  const guildMismatch = new Map();

  /**
   * The approved channel for this message, or null — and the guild has to match.
   *
   * The map is keyed on the channel alone, which is what it was before. The pair check is the
   * addition, and it is not about snowflake collisions: `source_ref` is built from the
   * REGISTERED guild, and every downstream projection keys on it, so a stale registration
   * attributes a call to the wrong source and nothing can detect it — the only two values being
   * compared came from the same row.
   *
   * A registration with no stored guild is not treated as a match and not treated as a refusal
   * either: it resolves on the channel alone, exactly as before, because refusing it would
   * silence a legitimately approved channel over missing metadata.
   */
  function resolveChannel(msg) {
    const group = approvedChannel(msg?.channel?.id);
    if (!group) return null;
    const registered = group.guildId;
    const actual = msg?.guild?.id;
    if (registered && actual && registered !== actual) {
      guildMismatch.set(msg.channel.id, (guildMismatch.get(msg.channel.id) || 0) + 1);
      log("call.guild-mismatch", {
        channelId: msg.channel.id,
        messageId: msg.id,
        registeredGuild: registered,
        actualGuild: actual,
        reason: "channel is registered to a different guild"
      });
      return null;
    }
    return group;
  }
  /**
   * Everything this process has SEEN, whether or not it became a call.
   *
   * The counter that matters is `messagesReceived`. If it is 0 while a human is posting, the
   * gateway is not delivering MESSAGE_CREATE at all — a privileged-intent or channel-permission
   * fault — and no amount of parser work will help. Every other number here is only meaningful
   * once that one is moving. Counters, never content.
   */
  const counters = {
    messagesReceived: 0,
    inApprovedChannel: 0,
    skippedSelf: 0,
    detected: 0,
    refusedAmbiguous: 0,
    ignoredNoMint: 0,
    emptyPayload: 0,
    updates: 0,
    deletes: 0
  };
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
      counters.refusedAmbiguous += 1;
      const rejectionReason = "ambiguous_mint";
      log("call.rejected", {
        channelId: msg.channel.id, messageId: msg.id, group: group.groupName || group.groupId,
        reason: rejectionReason, parserReason: parsed.rejected, candidates: parsed.candidates, eventType
      });
      try {
        return await ingestEvent({
          guildId: msg.guild?.id || null,
          channelId: msg.channel.id,
          channelName: msg.channel.name,
          messageId: msg.id,
          caller: callerName(msg),
          group,
          call: null,
          rejectionReason,
          eventType,
          eventVersion,
          editedAt
        });
      } catch (e) {
        onError("rejection ingest", e);
        return null;
      }
    }
    if (!parsed?.mint) {
      // NOT a silent return. This branch is reached by every ordinary message in an approved
      // channel, so it looks like the one to stay quiet on — and staying quiet is what made
      // the listener undiagnosable. On 2026-08-05 a real mint was posted in an approved
      // channel and the process logged NOTHING: no detection, no rejection, nothing. That is
      // consistent with three completely different faults — the gateway never delivered the
      // message, the bot cannot read that channel, or the parser found no mint — and the logs
      // could not tell them apart, so the next step was a guess.
      //
      // The message's SHAPE is what separates them, so it is recorded rather than the content:
      // empty content AND no embeds on a message a human saw text in means the bot is not
      // receiving message content, which is a permission or intent fault. Content present with
      // no mint is a parser result. No message-shaped log line at all means the event never
      // arrived. Nothing here logs message text, author ids or attachment URLs — the shape is
      // enough to choose the next action, and the content is not ours to copy into a log.
      counters.ignoredNoMint += 1;
      log("call.ignored", {
        channelId: msg.channel.id,
        messageId: msg.id,
        group: group.groupName || group.groupId,
        reason: "no mint found in this message",
        eventType,
        shape: describeShape(msg)
      });
      return null;
    }
    counters.detected += 1;
    noteFreshness(msg.channel.id, "lastDetected");
    log("call.detected", {
      channelId: msg.channel.id, messageId: msg.id, group: group.groupName || group.groupId,
      mint: parsed.mint, confidence: parsed.confidence, eventType
    });
    try {
      const outcome = await ingestEvent({
        guildId: msg.guild?.id || null,
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
      if (outcome?.accepted === true && outcome?.duplicate !== true && eventType !== "delete"
          && !String(eventVersion || "").startsWith("history:")
          && group.scannerAcknowledgmentsEnabled !== false) {
        try {
          await acknowledge({ msg, group, call: parsed, eventType, eventVersion, outcome });
        } catch (error) {
          onError("acknowledgment", error);
        }
      }
      return outcome;
    } catch (e) {
      onError("ingest", e);
      return null;
    }
  }

  async function onMessageCreate(msg) {
    if (msg?.partial && typeof msg.fetch === "function") {
      msg = await msg.fetch().catch((error) => {
        onError("message create fetch", error);
        return null;
      });
    }
    if (!msg?.guild) return;
    counters.messagesReceived += 1;
    // A message with no content, no embeds and no attachments is the shape a process gets when
    // it is connected but not authorised to read content. Counted separately from "no mint",
    // because the two need completely different fixes.
    const shape = describeShape(msg);
    if (!shape.contentLength && !shape.embeds && !shape.attachments && !shape.components) {
      counters.emptyPayload += 1;
    }
    // Our own messages only — NOT all bots. Call channels overwhelmingly relay through a
    // webhook or a companion bot, so `author.bot` excluded exactly the messages that carry
    // the calls. Skipping just ourselves keeps the relay embed from feeding back in.
    if (msg.author?.id && msg.author.id === selfId()) { counters.skippedSelf += 1; return; }

    // Legacy fallback: `!register` in the channel they want watched.
    if (onLegacyRegister && !msg.author?.bot && String(msg.content || "").trim().toLowerCase() === "!register") {
      await onLegacyRegister(msg);
      return;
    }

    // Otherwise: only act in APPROVED call channels, and only for the guild each is
    // registered to.
    const group = resolveChannel(msg);
    if (!group) {
      // Counted, not logged per message: an unapproved channel in a busy guild would flood the
      // log and drown the events that matter. The counter answers "is the approved map what I
      // think it is?" — which is the other way this fault presents, and it is reported by
      // /degen status rather than by a line per message.
      unapprovedSeen.set(msg.channel?.id, (unapprovedSeen.get(msg.channel?.id) || 0) + 1);
      return;
    }
    counters.inApprovedChannel += 1;

    const parsed = await parseWithContext(msg);
    return handleDetectedCall({ msg, group, parsed, eventType: "create", eventVersion: "original" });
  }

  /**
   * Journal a message fetched from Discord history without producing a public reply.
   * The timestamp is carried in the immutable event version so the database can preserve
   * when the source actually posted the call rather than when this repair discovered it.
   */
  async function onHistoricalMessage(msg) {
    if (msg?.partial && typeof msg.fetch === "function") {
      msg = await msg.fetch().catch((error) => {
        onError("historical message fetch", error);
        return null;
      });
    }
    if (!msg?.guild) return null;
    if (msg.author?.id && msg.author.id === selfId()) return null;
    const group = resolveChannel(msg);
    if (!group) return null;
    const timestamp = Number(msg.createdTimestamp);
    if (!Number.isFinite(timestamp)) {
      onError("historical message", new Error("message has no creation timestamp"));
      return null;
    }
    const parsed = await parseWithContext(msg);
    return handleDetectedCall({
      msg,
      group,
      parsed,
      eventType: "create",
      eventVersion: `history:${new Date(timestamp).toISOString()}`
    });
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
      const group = resolveChannel(msg);
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
 * Every deletion in an approved channel is forwarded. The former process-memory gate lost
 * retractions whenever the listener restarted between create and delete. The journal records
 * a non-call deletion as rejected evidence and destroys nothing; that small diagnostic cost is
 * preferable to publishing a deleted call forever.
   */
  async function onMessageDelete(message) {
    try {
      const group = resolveChannel(message);
      if (!group) return;
      ingested.forget(message.id);
      log("call.deleted", { channelId: message.channel.id, messageId: message.id, group: group.groupName || group.groupId });
      return await ingestEvent({
        guildId: message.guild?.id || null,
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

  return {
    onMessageCreate, onHistoricalMessage, onMessageUpdate, onMessageDelete, parseWithContext, handleDetectedCall,
    /** What this process has seen but not watched. Answers "is the approved map correct?" */
    diagnostics: () => ({
      ...counters,
      unapprovedChannelsSeen: unapprovedSeen.size,
      unapprovedMessages: [...unapprovedSeen.values()].reduce((a, b) => a + b, 0),
      guildMismatchChannels: guildMismatch.size,
      guildMismatchMessages: [...guildMismatch.values()].reduce((a, b) => a + b, 0),
      // The one-line reading of all of the above, so an operator does not have to infer it.
      verdict:
        counters.messagesReceived === 0
          ? "no MESSAGE_CREATE received since boot — if anyone has posted, this is a gateway " +
            "intent or channel-permission fault, not a parser one"
          : counters.emptyPayload === counters.messagesReceived
            ? "every message arrived with no content, embeds or attachments — the process is " +
              "connected but cannot read message content"
            : counters.inApprovedChannel === 0
              ? "messages are arriving, but none in a watched channel — check the approved map"
              : "messages are arriving in watched channels and being parsed"
    })
  };
}

module.exports = { createMessageHandlers, IngestedMessages, callerName, describeShape, INGESTED_LIMIT };
