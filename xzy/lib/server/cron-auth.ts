import { timingSafeEqual } from "node:crypto";
import { optionalEnv } from "../env.ts";

/**
 * Shared gate for the scheduled endpoints. They run unattended on a timer, so the only
 * thing standing between the internet and them is this token.
 */
export function isScheduledRequest(req: Request): boolean {
  const secret = optionalEnv("CRON_SECRET");
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
