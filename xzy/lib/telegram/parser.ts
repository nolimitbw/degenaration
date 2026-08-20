import { isSolanaAddress } from "../solana/base58.ts";

/**
 * Extracts Solana token mints from a Telegram channel post.
 *
 * Product rule: any Solana mint posted in a listed channel is a call. A post naming
 * three mints is three calls. The parser does not score, rank, or second-guess the
 * caller's intent — the journal records what was posted and the ranking is computed
 * later from what the price actually did.
 *
 * SECURITY: post text is untrusted input from anyone who can post in that channel.
 * We only ever extract base58 strings that decode to 32-byte public keys. No text
 * from a post is ever evaluated, executed, or interpreted as an instruction.
 */

const BASE58_CANDIDATE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

/** Mints reachable from a link carry more intent than one pasted in passing. */
const LINK_MINT =
  /(?:pump\.fun\/(?:coin\/)?|dexscreener\.com\/solana\/|birdeye\.so\/token\/|solscan\.io\/token\/|jup\.ag\/swap\/[A-Za-z0-9]+-|jup\.ag\/tokens\/)([1-9A-HJ-NP-Za-km-z]{32,44})/g;

/**
 * Addresses that are valid public keys but are never a call: wrapped SOL, the stables,
 * and the token programs. Without this a post saying "paired against USDC" books a call
 * on USDC.
 */
const NEVER_A_CALL = new Set([
  "So11111111111111111111111111111111111111112", // Wrapped SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token program
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022 program
  "11111111111111111111111111111111" // System program
]);

/** A single post cannot mean unlimited calls; this bounds a paste-bomb. */
export const MAX_CALLS_PER_POST = 5;
/** Telegram caps posts at 4096 characters; anything longer is not a real post. */
export const MAX_POST_LENGTH = 4096;

export type Confidence = "high" | "medium";

export type ParsedCall = {
  mint: string;
  confidence: Confidence;
};

/**
 * Parse a post into calls. Link-wrapped mints rank "high", bare pasted addresses
 * "medium". Links come first, then bare addresses in the order they appear; a mint
 * seen both ways keeps the higher confidence.
 */
export function parseCalls(text: string | null | undefined): ParsedCall[] {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_POST_LENGTH) return [];

  const found = new Map<string, Confidence>();

  const consider = (mint: string, confidence: Confidence) => {
    if (NEVER_A_CALL.has(mint)) return;
    if (!isSolanaAddress(mint)) return;
    if (confidence === "high" || !found.has(mint)) found.set(mint, confidence);
  };

  for (const match of text.matchAll(LINK_MINT)) consider(match[1]!, "high");
  for (const candidate of text.match(BASE58_CANDIDATE) ?? []) consider(candidate, "medium");

  return [...found.entries()].slice(0, MAX_CALLS_PER_POST).map(([mint, confidence]) => ({ mint, confidence }));
}

/** The single strongest call in a post, or null when the post names no mint. */
export function parseCall(text: string | null | undefined): ParsedCall | null {
  return parseCalls(text)[0] ?? null;
}
