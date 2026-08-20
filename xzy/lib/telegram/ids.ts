/**
 * Telegram ID shapes.
 *
 * Chat IDs are signed 64-bit integers. Users and private chats are positive; groups
 * and channels are negative, and supergroups/channels are conventionally prefixed
 * -100. They exceed Number.MAX_SAFE_INTEGER in principle, so they are carried as
 * strings everywhere and only ever compared as strings.
 */

const USER_ID = /^\d{1,19}$/;
const CHAT_ID = /^-?\d{1,19}$/;

export function isTelegramUserId(value: unknown): value is string {
  return typeof value === "string" && USER_ID.test(value) && value !== "0";
}

export function isTelegramChatId(value: unknown): value is string {
  return typeof value === "string" && CHAT_ID.test(value) && value !== "0" && value !== "-0";
}

/** Channels and supergroups have negative IDs; a positive one is a private chat. */
export function isChannelChatId(value: string): boolean {
  return isTelegramChatId(value) && value.startsWith("-");
}

export function toChatId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value !== 0) return String(value);
  if (isTelegramChatId(value)) return value;
  return null;
}

export function toUserId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (isTelegramUserId(value)) return value;
  return null;
}
