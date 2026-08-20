import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { optionalEnv, requireEnv } from "../env.ts";

/**
 * Swap execution through Jupiter.
 *
 * Jupiter quotes a route and returns a ready-to-sign transaction; we sign it with the
 * user's key and submit it. Slippage is always explicit — a swap sent without a slippage
 * bound on a thin memecoin pool is a swap that can fill at any price at all.
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS = LAMPORTS_PER_SOL;

/**
 * Jupiter's swap API base.
 *
 * Jupiter has moved this endpoint before (the older `quote-api.jup.ag/v6` host was
 * retired in favour of the `swap/v1` API, with a keyed `api.jup.ag` tier alongside the
 * free `lite-api.jup.ag` one). It is configurable so a future move is an environment
 * change rather than a redeploy, and so the paid tier can be swapped in when rate
 * limits start mattering.
 *
 * VERIFY THIS AGAINST JUPITER'S CURRENT DOCS BEFORE GOING LIVE. `npm run probe:jupiter`
 * checks reachability and a real quote.
 */
const quoteApi = () => optionalEnv("JUPITER_API_URL")?.replace(/\/+$/, "") ?? "https://lite-api.jup.ag/swap/v1";
const HTTP_TIMEOUT_MS = 12_000;

export type QuoteResult = {
  /** Raw route object, passed back to Jupiter verbatim to build the swap. */
  route: unknown;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
};

export function rpcUrl(): string {
  return optionalEnv("SOLANA_RPC_URL") ?? "https://api.mainnet-beta.solana.com";
}

export function connection(): Connection {
  return new Connection(rpcUrl(), "confirmed");
}

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quote a swap. `amount` is in the input token's smallest unit (lamports for SOL).
 * `slippageBps` is hundredths of a percent: 300 = 3%.
 */
export async function getQuote(input: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
}): Promise<QuoteResult | null> {
  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount.toString(),
    slippageBps: String(Math.max(1, Math.min(input.slippageBps, 5_000))),
    onlyDirectRoutes: "false"
  });

  const quote = await getJson<{ outAmount?: string; inAmount?: string; priceImpactPct?: string }>(
    `${quoteApi()}/quote?${params.toString()}`
  );
  if (!quote?.outAmount || !quote.inAmount) return null;

  return {
    route: quote,
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    priceImpactPct: Number(quote.priceImpactPct ?? 0)
  };
}

export type SwapResult =
  | { ok: true; signature: string; outAmount: string }
  | { ok: false; error: string };

/**
 * Sign and submit a swap for a quoted route.
 *
 * The transaction is confirmed before returning. A swap we cannot confirm is reported as
 * a failure with its signature, because the alternative — assuming success — books a
 * position the user may not actually hold.
 */
export async function executeSwap(input: {
  quote: QuoteResult;
  signer: Keypair;
  conn?: Connection;
}): Promise<SwapResult> {
  const conn = input.conn ?? connection();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let swapResponse: { swapTransaction?: string } | null = null;
  try {
    const res = await fetch(`${quoteApi()}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: input.quote.route,
        userPublicKey: input.signer.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto"
      }),
      signal: controller.signal,
      cache: "no-store"
    });
    if (!res.ok) return { ok: false, error: `swap build failed (HTTP ${res.status})` };
    swapResponse = (await res.json()) as { swapTransaction?: string };
  } catch {
    return { ok: false, error: "swap build request failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!swapResponse?.swapTransaction) return { ok: false, error: "no swap transaction returned" };

  let signature: string;
  try {
    const transaction = VersionedTransaction.deserialize(Buffer.from(swapResponse.swapTransaction, "base64"));
    transaction.sign([input.signer]);
    signature = await conn.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });
  } catch (error) {
    return { ok: false, error: `submit failed: ${error instanceof Error ? error.message : "unknown"}` };
  }

  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const confirmation = await conn.confirmTransaction(
      { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed"
    );
    if (confirmation.value.err) {
      return { ok: false, error: `transaction failed on chain: ${JSON.stringify(confirmation.value.err)}` };
    }
  } catch {
    // Submitted but unconfirmed. Reported as a failure so no position is booked, with
    // the signature preserved so it can be reconciled against the chain later.
    return { ok: false, error: `unconfirmed: ${signature}` };
  }

  return { ok: true, signature, outAmount: input.quote.outAmount };
}

export async function getSolBalance(address: string, conn?: Connection): Promise<number | null> {
  try {
    const lamports = await (conn ?? connection()).getBalance(new PublicKey(address), "confirmed");
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return null;
  }
}

/**
 * Price feed base. Configurable for the same reasons as the swap API: the provider can
 * move, a paid tier may be needed for rate limits, and tests point it at a local stub.
 */
const priceApi = () => optionalEnv("PRICE_API_URL")?.replace(/\/+$/, "") ?? "https://api.dexscreener.com";

/** Best-effort USD price for a mint, used for entry marks and exit evaluation. */
export async function getPriceUsd(mint: string): Promise<number | null> {
  const data = await getJson<{ pairs?: { chainId?: string; baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }[] }>(
    `${priceApi()}/latest/dex/tokens/${mint}`
  );
  const pair = (data?.pairs ?? [])
    .filter((item) => item?.chainId === "solana" && item?.baseToken?.address === mint)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const price = Number(pair?.priceUsd);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Explicit opt-in before anything can move real funds. Absent means simulate. */
export function isLiveTrading(): boolean {
  return optionalEnv("TRADING_MODE") === "live";
}

export function requireEncryptionKey(): void {
  requireEnv("WALLET_ENCRYPTION_KEY");
}
