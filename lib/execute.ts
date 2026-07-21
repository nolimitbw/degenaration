"use client";
import { getRpc, getNet } from "./net";
import { fetchWithTimeout, sanitizeError } from "./server/guard";
import { recordTradeWithRetry } from "./recordTrade";

const SOL = "So11111111111111111111111111111111111111112";

type Provider = any;
export function detectWallets(): { name: string; provider: Provider }[] {
  if (typeof window === "undefined") return [];
  const w = window as any;
  const out: { name: string; provider: Provider }[] = [];
  if (w.phantom?.solana || w.solana?.isPhantom) out.push({ name: "Phantom", provider: w.phantom?.solana || w.solana });
  if (w.solflare?.isSolflare) out.push({ name: "Solflare", provider: w.solflare });
  if (w.backpack) out.push({ name: "Backpack", provider: w.backpack });
  return out;
}
export function pickProvider(): Provider | null {
  const ws = detectWallets();
  return ws[0]?.provider ?? null;
}

type BuyArgs = { mint: string; solAmount: number; slippageBps: number; priceUsd?: number | null; symbol?: string; mev?: boolean; authToken?: string | null };
type SellArgs = { mint: string; pct: number; slippageBps: number; priceUsd?: number | null; symbol?: string; mev?: boolean; authToken?: string | null };
type Result = { ok: boolean; sig?: string; error?: string; warning?: string; soldUi?: number };

export async function executeBuy(args: BuyArgs, provider?: Provider): Promise<Result> {
  const wallet = provider || pickProvider();
  if (!wallet) return { ok: false, error: "No Solana wallet found. Install Phantom, Solflare or Backpack." };
  try {
    await wallet.connect?.();
    const pubkey = wallet.publicKey?.toBase58?.();
    if (!pubkey) return { ok: false, error: "Wallet not connected" };

    const url = `/api/swap`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(args.authToken ? { authorization: `Bearer ${args.authToken}` } : {}) },
      body: JSON.stringify({ inputMint: SOL, outputMint: args.mint, amount: BigInt(Math.round(args.solAmount * 1e9)).toString(), userPublicKey: pubkey, slippageBps: args.slippageBps, net: getNet(), mev: args.mev ?? true })
    }).then((r) => r.json());
    if (res.error || !res.swapTransaction) return { ok: false, error: res.error || "could not build swap" };

    const web3 = await import("@solana/web3.js");
    const raw = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
    const tx = web3.VersionedTransaction.deserialize(raw);
    const signed = await wallet.signAndSendTransaction(tx);
    const sig = signed?.signature ?? signed;

    const warning = args.authToken
      ? await recordTradeWithRetry({ mint: args.mint, side: "buy", solAmount: args.solAmount, priceUsd: args.priceUsd, sig, kind: "manual", userPubkey: pubkey }, args.authToken)
      : null;
    return { ok: true, sig, warning: warning || undefined };
  } catch (e: any) {
    return { ok: false, error: sanitizeError(e) || "signing cancelled" };
  }
}

/**
 * Sell a percentage (0-1) of the connected EXTENSION wallet's balance of `mint` back to SOL.
 * Used as the fallback when a user's only Solana wallet is external (Phantom/Solflare/Backpack)
 * and Privy's embedded-only useSendTransaction can't sign. Mirrors executeBuy's loop.
 */
export async function executeSell(args: SellArgs, provider?: Provider): Promise<Result> {
  const wallet = provider || pickProvider();
  if (!wallet) return { ok: false, error: "No Solana wallet found. Install Phantom, Solflare or Backpack." };
  try {
    await wallet.connect?.();
    const pubkey = wallet.publicKey?.toBase58?.();
    if (!pubkey) return { ok: false, error: "Wallet not connected" };

    const pct = Math.min(1, Math.max(0, args.pct));
    if (pct <= 0) return { ok: false, error: "Pick a sell amount" };
    const bal = await fetchWithTimeout(`/api/token-balance?owner=${pubkey}&mint=${args.mint}&net=${getNet()}`).then((r) => r.json());
    if (bal.error) return { ok: false, error: bal.error };
    const rawTotal = BigInt(bal.rawAmount || "0");
    if (rawTotal <= BigInt(0)) return { ok: false, error: "You don't hold this token" };
    const amount = (rawTotal * BigInt(Math.round(pct * 10000))) / BigInt(10000);
    if (amount <= BigInt(0)) return { ok: false, error: "Amount too small" };

    const res = await fetchWithTimeout("/api/swap", {
      method: "POST",
      headers: { "content-type": "application/json", ...(args.authToken ? { authorization: `Bearer ${args.authToken}` } : {}) },
      body: JSON.stringify({ inputMint: args.mint, outputMint: SOL, amount: amount.toString(), userPublicKey: pubkey, slippageBps: args.slippageBps, net: getNet(), mev: args.mev ?? true })
    }).then((r) => r.json());
    if (res.error || !res.swapTransaction) return { ok: false, error: res.error || "could not build swap" };

    const web3 = await import("@solana/web3.js");
    const raw = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
    const tx = web3.VersionedTransaction.deserialize(raw);
    const signed = await wallet.signAndSendTransaction(tx);
    const sig = signed?.signature ?? signed;

    const soldUi = bal.decimals > 0 ? Number(amount) / 10 ** bal.decimals : Number(amount);
    const solOut = res.outAmount ? Number(res.outAmount) / 1e9 : undefined;
    const warning = args.authToken
      ? await recordTradeWithRetry({ mint: args.mint, side: "sell", solAmount: solOut, priceUsd: args.priceUsd, sig, kind: "manual", userPubkey: pubkey }, args.authToken)
      : null;
    return { ok: true, sig, soldUi, warning: warning || undefined };
  } catch (e: any) {
    return { ok: false, error: sanitizeError(e) || "signing cancelled" };
  }
}
