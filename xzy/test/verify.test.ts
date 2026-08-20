import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyInitData } from "../lib/telegram/verify.ts";

/**
 * These tests sign fixtures with the same algorithm the server verifies, using a
 * throwaway token. If the implementation and the spec ever drift apart, real Telegram
 * payloads start failing — so the fixtures are built here rather than pasted from a
 * capture, which would freeze in whatever shape it was captured.
 */
const TOKEN = "123456:test-token-not-a-real-secret";

function signInitData(fields: Record<string, string>): string {
  const checkString = Object.entries(fields)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

const NOW = new Date("2026-01-01T00:00:00Z");
const authDate = String(Math.floor(NOW.getTime() / 1000));
const USER = JSON.stringify({ id: 4242, first_name: "Ada", username: "ada", is_premium: true });

test("accepts a correctly signed payload and extracts the user", () => {
  const initData = signInitData({ auth_date: authDate, query_id: "abc", user: USER });
  const result = verifyInitData(initData, TOKEN, { now: NOW });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.user.id, "4242");
  assert.equal(result.data.user.username, "ada");
  assert.equal(result.data.user.isPremium, true);
});

test("rejects a payload signed with a different token", () => {
  const initData = signInitData({ auth_date: authDate, user: USER });
  const result = verifyInitData(initData, "999999:some-other-token", { now: NOW });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "signature mismatch");
});

test("rejects a payload whose fields were tampered with after signing", () => {
  const initData = signInitData({ auth_date: authDate, user: USER });
  // Swap in a different user while keeping the original hash — the classic forgery.
  const params = new URLSearchParams(initData);
  params.set("user", JSON.stringify({ id: 9999, first_name: "Mallory" }));

  const result = verifyInitData(params.toString(), TOKEN, { now: NOW });
  assert.equal(result.ok, false);
});

test("rejects a payload older than the freshness window", () => {
  const old = String(Math.floor(NOW.getTime() / 1000) - 90_000);
  const initData = signInitData({ auth_date: old, user: USER });

  const result = verifyInitData(initData, TOKEN, { now: NOW });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "initData expired");
});

test("rejects a payload dated far in the future", () => {
  const future = String(Math.floor(NOW.getTime() / 1000) + 8_000);
  const initData = signInitData({ auth_date: future, user: USER });

  const result = verifyInitData(initData, TOKEN, { now: NOW });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "auth_date in the future");
});

test("excludes the Ed25519 signature field from the HMAC check string", () => {
  // Telegram sends `signature` alongside `hash`; including it in the check string
  // makes every genuine payload fail. This asserts we ignore it.
  const initData = signInitData({ auth_date: authDate, user: USER });
  const withSignature = `${initData}&signature=abc123def456`;

  const result = verifyInitData(withSignature, TOKEN, { now: NOW });
  assert.equal(result.ok, true);
});

test("rejects empty, malformed, and oversized input", () => {
  assert.equal(verifyInitData("", TOKEN, { now: NOW }).ok, false);
  assert.equal(verifyInitData("user=x&hash=nothex", TOKEN, { now: NOW }).ok, false);
  assert.equal(verifyInitData("a=1".padEnd(9000, "b"), TOKEN, { now: NOW }).ok, false);
});

test("rejects a valid signature carrying no user", () => {
  const initData = signInitData({ auth_date: authDate, query_id: "abc" });
  const result = verifyInitData(initData, TOKEN, { now: NOW });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "missing or invalid user");
});
