import { parseCalls } from "../lib/telegram/parser.ts";
import { toChatId, toUserId, isChannelChatId } from "../lib/telegram/ids.ts";
import { READING_STATUSES, REMOVED_STATUSES } from "../lib/telegram/updates.ts";
import type { TgUpdate, TgMessage, TgChatMemberUpdated } from "../lib/telegram/updates.ts";
import type { Channel } from "../lib/db/types.ts";
import type { InlineKeyboardButton } from "../lib/telegram/api.ts";

/**
 * Webhook routing for the Xzy bot.
 *
 * Every side effect is injected. That is not ceremony: it means the whole decision tree
 * — which posts become calls, which channels get listed, who gets told what — is
 * exercised in tests without a network, a database, or a live bot. The route handler is
 * then a thin wrapper that supplies real implementations.
 */

export type RecordCallInput = {
  channelId: string;
  chatId: string;
  mint: string;
  messageId: string;
  confidence: string;
  eventVersion: string;
  caller: string | null;
  postedAt: Date;
};

export type ListChannelInput = {
  chatId: string;
  title: string | null;
  username: string | null;
  listedByTgId: string | null;
};

export type WebhookDeps = {
  sendMessage(chatId: string, text: string, options?: { replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] } }): Promise<unknown>;
  answerCallbackQuery(id: string, text?: string): Promise<unknown>;
  getChannel(chatId: string): Promise<Channel | null>;
  listChannel(input: ListChannelInput): Promise<Channel | null>;
  markChannelRemoved(chatId: string): Promise<unknown>;
  recordCall(input: RecordCallInput): Promise<{ accepted: boolean; id: string | null }>;
  upsertUser(input: { tgId: string; username: string | null; firstName: string | null }): Promise<unknown>;
  /**
   * Fan a newly recorded call out to the channel's subscribers. Called once per accepted
   * call, after it is journalled — the journal is the source of truth, and a copy that
   * fails must never cost us the record of what was called.
   */
  dispatchCopy(input: { callId: string; channelId: string; mint: string }): Promise<unknown>;
  miniAppUrl: string;
  now(): Date;
};

/** What the handler did, returned for logging and asserted against in tests. */
export type WebhookOutcome = {
  kind:
    | "ignored"
    | "channel_listed"
    | "channel_removed"
    | "calls_recorded"
    | "no_calls_in_post"
    | "post_from_unlisted_channel"
    | "post_from_unapproved_channel"
    | "command"
    | "callback";
  detail?: string;
  callsRecorded?: number;
};

const ignored = (detail: string): WebhookOutcome => ({ kind: "ignored", detail });

function miniAppButton(url: string, text = "Open Xzy"): { inline_keyboard: InlineKeyboardButton[][] } {
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}

/**
 * A stable identifier for "this version of this post". Edits produce a new version so
 * an edited call is recorded as its own event rather than silently overwriting the
 * original — the journal keeps both, and the original call time still stands.
 */
function eventVersionFor(message: TgMessage, edited: boolean): string {
  if (!edited) return "original";
  const editedAt = typeof message.edit_date === "number" ? message.edit_date : 0;
  return `edit:${editedAt}`;
}

async function handleChannelPost(
  message: TgMessage,
  edited: boolean,
  deps: WebhookDeps
): Promise<WebhookOutcome> {
  const chatId = toChatId(message.chat?.id);
  const messageId = typeof message.message_id === "number" ? String(message.message_id) : null;
  if (!chatId || !messageId) return ignored("post without chat or message id");
  if (!isChannelChatId(chatId)) return ignored("post from a non-channel chat");

  const channel = await deps.getChannel(chatId);
  if (!channel) return { kind: "post_from_unlisted_channel", detail: chatId };
  // A pending or rejected channel is read but not recorded. Listing is not approval.
  if (channel.status !== "approved") return { kind: "post_from_unapproved_channel", detail: channel.status };

  const text = [message.text, message.caption].filter(Boolean).join("\n");
  const calls = parseCalls(text);
  if (calls.length === 0) return { kind: "no_calls_in_post" };

  const postedAt =
    typeof message.date === "number" ? new Date(message.date * 1000) : deps.now();
  const eventVersion = eventVersionFor(message, edited);
  const caller = typeof message.author_signature === "string" ? message.author_signature.slice(0, 100) : null;

  let recorded = 0;
  for (const call of calls) {
    const result = await deps.recordCall({
      channelId: channel.id,
      chatId,
      mint: call.mint,
      messageId,
      confidence: call.confidence,
      eventVersion,
      caller,
      postedAt
    });
    if (!result.accepted || !result.id) continue;
    recorded += 1;
    await deps.dispatchCopy({ callId: result.id, channelId: channel.id, mint: call.mint });
  }

  return { kind: "calls_recorded", callsRecorded: recorded };
}

async function handleMyChatMember(
  update: TgChatMemberUpdated,
  deps: WebhookDeps
): Promise<WebhookOutcome> {
  const chatId = toChatId(update.chat?.id);
  if (!chatId) return ignored("membership change without chat id");
  if (update.chat?.type !== "channel") return ignored("membership change outside a channel");

  const status = update.new_chat_member?.status;
  const promoterId = toUserId(update.from?.id);

  if (status && READING_STATUSES.has(status)) {
    const channel = await deps.listChannel({
      chatId,
      title: update.chat?.title ?? null,
      username: update.chat?.username ?? null,
      listedByTgId: promoterId
    });
    // Telling the promoter privately is best-effort: they may not have started the bot,
    // in which case Telegram refuses the message. The listing still stands.
    if (promoterId) {
      await deps.sendMessage(
        promoterId,
        [
          `<b>${escape(update.chat?.title ?? "Your channel")}</b> is now listed on Xzy.`,
          "",
          "It is <b>pending review</b>. Once approved, every Solana mint posted there becomes a copyable call and the channel earns a share of the fees from traders who follow it.",
          "",
          "Nothing is copied until review completes."
        ].join("\n"),
        { replyMarkup: miniAppButton(deps.miniAppUrl, "View listing") }
      );
    }
    return { kind: "channel_listed", detail: channel?.status ?? "pending" };
  }

  if (status && REMOVED_STATUSES.has(status)) {
    // Losing admin means losing the read path. Stop the listing rather than leave a
    // source that looks live but silently receives nothing.
    await deps.markChannelRemoved(chatId);
    return { kind: "channel_removed", detail: status };
  }

  return ignored(`unhandled member status: ${status ?? "none"}`);
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function handleCommand(message: TgMessage, deps: WebhookDeps): Promise<WebhookOutcome> {
  const chatId = toChatId(message.chat?.id);
  const fromId = toUserId(message.from?.id);
  if (!chatId || !fromId || message.from?.is_bot) return ignored("command without a human sender");

  // Best-effort. If the database is unreachable the user still gets their reply —
  // a broken front door is a worse failure than a missed profile row, and the row is
  // rewritten on their next message anyway.
  try {
    await deps.upsertUser({
      tgId: fromId,
      username: message.from?.username ?? null,
      firstName: message.from?.first_name ?? null
    });
  } catch {
    // Intentionally swallowed; see above.
  }

  const command = (message.text ?? "").trim().split(/\s+/)[0]?.toLowerCase().split("@")[0] ?? "";

  if (command === "/start") {
    await deps.sendMessage(
      chatId,
      [
        "<b>Xzy</b> — copy trading for Telegram calls.",
        "",
        "Follow the Telegram channels you trust. When one posts a Solana mint, Xzy can buy it for you automatically, with your own size limits and take-profit rules.",
        "",
        "Open the app to browse listed channels and set up a wallet.",
        "",
        "<i>Copy trading loses money for most people who try it. Only trade what you can afford to lose entirely.</i>"
      ].join("\n"),
      { replyMarkup: miniAppButton(deps.miniAppUrl) }
    );
    return { kind: "command", detail: "/start" };
  }

  if (command === "/list") {
    await deps.sendMessage(
      chatId,
      [
        "<b>Listing your channel on Xzy</b>",
        "",
        "1. Open your channel's settings in Telegram.",
        "2. Administrators → Add Administrator → search for this bot.",
        "3. Add it. No permissions need to be enabled — reading posts is enough.",
        "",
        "Your channel then appears as pending for review. We only ever read posts; the bot cannot post, edit, or delete anything in your channel."
      ].join("\n"),
      { replyMarkup: miniAppButton(deps.miniAppUrl, "Open Xzy") }
    );
    return { kind: "command", detail: "/list" };
  }

  if (command === "/help") {
    await deps.sendMessage(
      chatId,
      [
        "<b>Xzy commands</b>",
        "",
        "/start — open the app",
        "/list — list your channel as a call source",
        "/help — this message",
        "",
        "Everything else lives in the app: wallet, channels you follow, positions, and limits."
      ].join("\n"),
      { replyMarkup: miniAppButton(deps.miniAppUrl) }
    );
    return { kind: "command", detail: "/help" };
  }

  return ignored(`unknown command: ${command || "(empty)"}`);
}

/** Route one Telegram update. Never throws — a thrown error would make Telegram retry. */
export async function handleUpdate(update: TgUpdate, deps: WebhookDeps): Promise<WebhookOutcome> {
  try {
    if (update.my_chat_member) return await handleMyChatMember(update.my_chat_member, deps);
    if (update.channel_post) return await handleChannelPost(update.channel_post, false, deps);
    if (update.edited_channel_post) return await handleChannelPost(update.edited_channel_post, true, deps);

    if (update.callback_query?.id) {
      await deps.answerCallbackQuery(update.callback_query.id);
      return { kind: "callback" };
    }

    if (update.message?.chat?.type === "private" && typeof update.message.text === "string") {
      return await handleCommand(update.message, deps);
    }

    return ignored("no handler for this update type");
  } catch (error) {
    // Telegram redelivers on a non-2xx, so a bug here would become a retry storm.
    // Swallow, report, and let the caller still answer 200.
    return ignored(`handler error: ${error instanceof Error ? error.message : "unknown"}`);
  }
}
