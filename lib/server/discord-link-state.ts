import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DISCORD_LINK_STATE_COOKIE = "degen_discord_link_state";

function secret() {
  return process.env.DISCORD_LINK_SIGNING_SECRET || process.env.ADMIN_KEY || "";
}

function signature(payload: string, key: string) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueDiscordLinkState(sessionId: string, privyUserId: string, now = Date.now()) {
  const key = secret();
  if (!key) return null;
  const expiresAt = now + 10 * 60_000;
  const payload = [sessionId, Buffer.from(privyUserId).toString("base64url"), String(expiresAt), randomBytes(24).toString("base64url")].join(".");
  return { token: `${payload}.${signature(payload, key)}`, expiresAt };
}

export function verifyDiscordLinkState(
  token: string | undefined,
  sessionId: string,
  privyUserId: string,
  now = Date.now()
) {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 5) return false;
  const payload = parts.slice(0, 4).join(".");
  const supplied = Buffer.from(parts[4]);
  const expected = Buffer.from(signature(payload, key));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  const [boundSession, encodedUser, expires] = parts;
  let boundUser = "";
  try { boundUser = Buffer.from(encodedUser, "base64url").toString(); } catch { return false; }
  return boundSession === sessionId && boundUser === privyUserId && Number(expires) > now;
}
