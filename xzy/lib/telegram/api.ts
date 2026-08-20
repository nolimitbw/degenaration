import { requireEnv } from "../env.ts";

/**
 * Thin Telegram Bot API client. Deliberately not a library: we use a handful of
 * methods and a dependency that can read the bot token is a dependency that can
 * exfiltrate it.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export type InlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
};

export type SendMessageOptions = {
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
  disablePreview?: boolean;
  parseMode?: "HTML" | "MarkdownV2";
};

async function call<T>(method: string, payload: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  const token = requireEnv("XZY_BOT_TOKEN");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store"
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
    if (!body?.ok) return null;
    return (body.result ?? null) as T | null;
  } catch {
    // A failed send is a lost notification, never a lost call: the call is already
    // journaled by the time we get here.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTML is the safer of Telegram's parse modes for untrusted interpolation — escaping
 * is three characters and total, whereas MarkdownV2 has eighteen reserved characters
 * and fails closed by rejecting the whole message.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sendMessage(chatId: string, text: string, options: SendMessageOptions = {}) {
  return call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode ?? "HTML",
    link_preview_options: { is_disabled: options.disablePreview ?? true },
    reply_markup: options.replyMarkup
  });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return call<boolean>("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: false });
}

export function getChatMemberCount(chatId: string) {
  return call<number>("getChatMemberCount", { chat_id: chatId });
}

export function setMyCommands(commands: { command: string; description: string }[]) {
  return call<boolean>("setMyCommands", { commands });
}
