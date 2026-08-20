import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram Mini App `initData` verification.
 *
 * THIS IS THE ENTIRE AUTH BOUNDARY for the Mini App. Everything the client sends is
 * attacker-controlled; the only reason we believe a user is who they claim to be is
 * that this HMAC checks out against our bot token. Treat changes here as security
 * changes.
 *
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *   secret_key       = HMAC_SHA256(key="WebAppData", message=bot_token)
 *   data_check_string = "k=v" pairs, excluding `hash`, sorted by key, joined with "\n"
 *   expected         = HMAC_SHA256(key=secret_key, message=data_check_string), hex
 */

export type TelegramUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isPremium: boolean;
};

export type VerifiedInitData = {
  user: TelegramUser;
  authDate: Date;
  startParam: string | null;
  chatInstance: string | null;
};

export type VerifyFailure = { ok: false; reason: string };
export type VerifySuccess = { ok: true; data: VerifiedInitData };
export type VerifyResult = VerifySuccess | VerifyFailure;

/**
 * How old an `initData` payload may be and still be accepted. Telegram reissues it on
 * every Mini App open, so a day is generous while still bounding replay of a payload
 * captured from a log or a shared screenshot.
 */
export const MAX_INIT_DATA_AGE_SECONDS = 86_400;

/**
 * `signature` is Telegram's separate Ed25519 third-party signature. It is excluded from
 * the HMAC data-check string alongside `hash`; including it makes valid payloads fail.
 */
const EXCLUDED_FROM_CHECK_STRING = new Set(["hash", "signature"]);

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseUser(raw: string | undefined): TelegramUser | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const user = parsed as Record<string, unknown>;
  // The numeric Telegram ID is the identity anchor. Usernames are reassignable and are
  // stored for display only — never keyed on.
  if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value.slice(0, 128) : null);
  return {
    id: String(user.id),
    firstName: str(user.first_name),
    lastName: str(user.last_name),
    username: str(user.username),
    languageCode: str(user.language_code),
    isPremium: user.is_premium === true
  };
}

/**
 * Verify a raw `initData` query string against the bot token.
 *
 * `now` is injectable so the freshness window is testable without faking system time.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  options: { now?: Date; maxAgeSeconds?: number } = {}
): VerifyResult {
  if (typeof initData !== "string" || initData.length === 0) return { ok: false, reason: "empty initData" };
  if (typeof botToken !== "string" || botToken.length === 0) return { ok: false, reason: "missing bot token" };
  // Bound the work an unauthenticated caller can make us do.
  if (initData.length > 8192) return { ok: false, reason: "initData too large" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: "missing or malformed hash" };

  const checkString = [...params.entries()]
    .filter(([key]) => !EXCLUDED_FROM_CHECK_STRING.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");

  if (!safeEqualHex(expected, hash.toLowerCase())) return { ok: false, reason: "signature mismatch" };

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw || !/^\d{1,15}$/.test(authDateRaw)) return { ok: false, reason: "missing auth_date" };
  const authDate = new Date(Number(authDateRaw) * 1000);
  if (Number.isNaN(authDate.getTime())) return { ok: false, reason: "invalid auth_date" };

  const now = options.now ?? new Date();
  const maxAge = options.maxAgeSeconds ?? MAX_INIT_DATA_AGE_SECONDS;
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > maxAge) return { ok: false, reason: "initData expired" };
  // A payload dated meaningfully in the future is a clock problem or a forgery attempt.
  if (ageSeconds < -300) return { ok: false, reason: "auth_date in the future" };

  const user = parseUser(params.get("user") ?? undefined);
  if (!user) return { ok: false, reason: "missing or invalid user" };

  return {
    ok: true,
    data: {
      user,
      authDate,
      startParam: params.get("start_param"),
      chatInstance: params.get("chat_instance")
    }
  };
}
