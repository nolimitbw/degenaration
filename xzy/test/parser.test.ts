import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCalls, parseCall, MAX_CALLS_PER_POST } from "../lib/telegram/parser.ts";
import { isSolanaAddress, decodeBase58 } from "../lib/solana/base58.ts";

// Real mainnet mints, used as fixtures because they exercise the decoder for real.
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

test("base58 decodes to 32 bytes for real Solana addresses", () => {
  assert.equal(decodeBase58(BONK)?.length, 32);
  assert.equal(isSolanaAddress(BONK), true);
  assert.equal(isSolanaAddress(WIF), true);
});

test("rejects strings that look base58 but are not 32-byte keys", () => {
  // A transaction signature is 64 bytes and far longer than an address.
  assert.equal(isSolanaAddress("5".repeat(88)), false);
  // Contains characters outside the base58 alphabet (0, O, I, l).
  assert.equal(isSolanaAddress("0OIl" + BONK.slice(4)), false);
  assert.equal(isSolanaAddress("short"), false);
});

test("extracts a bare mint at medium confidence", () => {
  const calls = parseCalls(`aping ${BONK} lfg`);
  assert.deepEqual(calls, [{ mint: BONK, confidence: "medium" }]);
});

test("ranks a link-wrapped mint above a bare one", () => {
  const calls = parseCalls(`new one https://pump.fun/coin/${WIF} and also ${BONK}`);
  assert.equal(calls[0]?.mint, WIF);
  assert.equal(calls[0]?.confidence, "high");
  assert.equal(calls[1]?.mint, BONK);
  assert.equal(calls[1]?.confidence, "medium");
});

test("a post naming several mints is several calls", () => {
  const calls = parseCalls(`${BONK}\n${WIF}`);
  assert.equal(calls.length, 2);
});

test("the same mint posted twice collapses to one call at the higher confidence", () => {
  const calls = parseCalls(`${BONK} — chart: https://dexscreener.com/solana/${BONK}`);
  assert.deepEqual(calls, [{ mint: BONK, confidence: "high" }]);
});

test("never books a call on wrapped SOL or the stables", () => {
  // "paired against USDC" must not become a call on USDC.
  assert.deepEqual(parseCalls(`${USDC} pair, ${WSOL} route`), []);
  const calls = parseCalls(`buy ${BONK}, it is paired against ${USDC}`);
  assert.deepEqual(calls, [{ mint: BONK, confidence: "medium" }]);
});

test("ignores posts with no mint, and non-string input", () => {
  assert.deepEqual(parseCalls("gm everyone, big things coming"), []);
  assert.deepEqual(parseCalls(""), []);
  assert.deepEqual(parseCalls(null), []);
  assert.deepEqual(parseCalls(undefined), []);
});

test("bounds a paste bomb", () => {
  const manyMints = Array.from({ length: 40 }, () => BONK).join(" ");
  assert.ok(parseCalls(manyMints).length <= MAX_CALLS_PER_POST);

  // Beyond Telegram's own post limit, treat it as not a real post at all.
  assert.deepEqual(parseCalls(`${BONK} `.repeat(3000)), []);
});

test("parseCall returns the strongest single call, or null", () => {
  assert.equal(parseCall(`https://pump.fun/coin/${WIF} ${BONK}`)?.mint, WIF);
  assert.equal(parseCall("nothing here"), null);
});
