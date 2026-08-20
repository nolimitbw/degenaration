import { loadKeypair } from "../solana/wallet.ts";
import { getQuote, executeSwap, getPriceUsd, connection, WSOL_MINT, LAMPORTS, isLiveTrading } from "./jupiter.ts";

/**
 * The swap path: turn SOL into a token and back again.
 *
 * Separated from storage so the money-moving half can be tested against a stub Jupiter
 * without a database in the way. `server/trading-deps.ts` wires these into the copy
 * engine and monitor.
 *
 * When TRADING_MODE is not "live", the route and price are quoted for real and only the
 * submission is skipped — so unit maths, entry marks, and failure handling are exercised
 * on exactly the same code path that live trading uses.
 */

export type BuyResult =
  | { ok: true; signature: string; tokensOut: string; entryPriceUsd: number | null }
  | { ok: false; error: string };

export type SellResult = { ok: true; signature: string; solOut: number } | { ok: false; error: string };

/**
 * Buy `amountSol` worth of `mint`.
 *
 * The entry price is derived from the quote actually filled, not from a separate price
 * lookup, so take-profit and stop-loss measure against what was really paid — slippage
 * included — rather than an idealised mid price the user never got.
 */
export async function buyToken(input: {
  mint: string;
  amountSol: number;
  slippageBps: number;
  encryptedSecret: string;
}): Promise<BuyResult> {
  if (!(input.amountSol > 0)) return { ok: false, error: "buy amount must be above zero" };

  const lamports = BigInt(Math.floor(input.amountSol * LAMPORTS));
  const quote = await getQuote({
    inputMint: WSOL_MINT,
    outputMint: input.mint,
    amount: lamports,
    slippageBps: input.slippageBps
  });
  if (!quote) return { ok: false, error: "no route for this token" };

  const tokensOut = Number(quote.outAmount);
  if (!Number.isFinite(tokensOut) || tokensOut <= 0) return { ok: false, error: "route returned nothing" };

  const solPriceUsd = await getPriceUsd(WSOL_MINT);
  const entryPriceUsd = solPriceUsd ? (input.amountSol * solPriceUsd) / tokensOut : null;

  if (!isLiveTrading()) {
    return { ok: true, signature: `simulated:${Date.now()}`, tokensOut: quote.outAmount, entryPriceUsd };
  }

  const signer = loadKeypair(input.encryptedSecret);
  // A wallet we cannot decrypt is a hard stop, never a retry: either the ciphertext is
  // corrupt or the master key changed, and neither is fixed by trying again.
  if (!signer) return { ok: false, error: "wallet key unavailable" };

  const result = await executeSwap({ quote, signer, conn: connection() });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, signature: result.signature, tokensOut: result.outAmount, entryPriceUsd };
}

/**
 * Sell part of a position.
 *
 * `fractionOfOriginal` is a slice of the position as originally opened, while
 * `tokensRemaining` is what is actually left — so the two are reconciled here rather
 * than at the call site, where getting it backwards would silently sell the wrong size.
 */
export async function sellToken(input: {
  mint: string;
  tokensRemaining: string;
  remainingFraction: number;
  fractionOfOriginal: number;
  slippageBps: number;
  encryptedSecret: string;
}): Promise<SellResult> {
  const tokens = Number(input.tokensRemaining);
  if (!(tokens > 0) || !(input.remainingFraction > 0)) return { ok: false, error: "nothing left to sell" };

  const shareOfHolding = Math.min(1, input.fractionOfOriginal / input.remainingFraction);
  const amount = BigInt(Math.floor(tokens * shareOfHolding));
  if (amount <= 0n) return { ok: false, error: "sell amount rounds to zero" };

  const quote = await getQuote({
    inputMint: input.mint,
    outputMint: WSOL_MINT,
    amount,
    slippageBps: input.slippageBps
  });
  if (!quote) return { ok: false, error: "no exit route" };

  const solOut = Number(quote.outAmount) / LAMPORTS;
  if (!Number.isFinite(solOut) || solOut <= 0) return { ok: false, error: "exit route returned nothing" };

  if (!isLiveTrading()) {
    return { ok: true, signature: `simulated:${Date.now()}`, solOut };
  }

  const signer = loadKeypair(input.encryptedSecret);
  if (!signer) return { ok: false, error: "wallet key unavailable" };

  const result = await executeSwap({ quote, signer, conn: connection() });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, signature: result.signature, solOut };
}
