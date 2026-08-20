import { db } from "../db/client.ts";
import type { XzyUser } from "../db/types.ts";

/**
 * Resolve the internal user row for an authenticated Telegram identity, creating it on
 * first sight. Keyed on the numeric Telegram ID, never the username.
 */
export async function ensureUser(input: {
  tgId: string;
  username: string | null;
  firstName: string | null;
}): Promise<XzyUser | null> {
  const existing = await db<XzyUser[]>(`users?tg_id=eq.${encodeURIComponent(input.tgId)}&select=*&limit=1`);
  if (existing?.[0]) return existing[0];

  const created = await db<XzyUser[]>("users", {
    method: "POST",
    body: { tg_id: input.tgId, username: input.username, first_name: input.firstName }
  });
  if (created?.[0]) return created[0];

  // Lost a race with a concurrent first request; the row exists now.
  const raced = await db<XzyUser[]>(`users?tg_id=eq.${encodeURIComponent(input.tgId)}&select=*&limit=1`);
  return raced?.[0] ?? null;
}
