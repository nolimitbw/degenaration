import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

const SNOWFLAKE = /^\d{17,20}$/;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function isBotRequest(req: NextRequest) {
  const expected = process.env.BOT_SHARED_SECRET;
  const supplied = req.headers.get("x-bot-secret");
  if (!expected || !supplied) return false;
  return timingSafeEqual(digest(expected), digest(supplied));
}

export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === "string" && SNOWFLAKE.test(value);
}
