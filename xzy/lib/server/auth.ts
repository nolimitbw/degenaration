import { verifyInitData } from "../telegram/verify.ts";
import type { TelegramUser } from "../telegram/verify.ts";
import { optionalEnv, adminTelegramIds } from "../env.ts";

/**
 * Authenticates a Mini App request.
 *
 * The client sends the raw `initData` string Telegram handed it, in the
 * `X-Telegram-Init-Data` header. We re-verify the HMAC on every request rather than
 * issuing our own session token: initData is already short-lived and bound to the bot,
 * and a second token would be a second thing to get wrong.
 */

export type AuthResult =
  | { ok: true; user: TelegramUser; isAdmin: boolean }
  | { ok: false; status: 401 | 503; reason: string };

export function authenticate(req: Request): AuthResult {
  const token = optionalEnv("XZY_BOT_TOKEN");
  if (!token) return { ok: false, status: 503, reason: "server not configured" };

  const initData = req.headers.get("x-telegram-init-data");
  if (!initData) return { ok: false, status: 401, reason: "missing init data" };

  const result = verifyInitData(initData, token);
  if (!result.ok) return { ok: false, status: 401, reason: result.reason };

  return { ok: true, user: result.data.user, isAdmin: adminTelegramIds().has(result.data.user.id) };
}
