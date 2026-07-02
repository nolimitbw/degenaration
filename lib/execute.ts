"use client";
import { supabase } from "./supabase";
import { getRpc, getNet } from "./net";

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

type BuyArgs = { mint: string; solAmount: number; slippageBps: number; priceUsd?: number | null; symbol?: string };
type Result = { ok: boolean; sig?: string; error?: string };

export async function executeBuy(args: BuyArgs, provider?: Provider): Promise<Result> {
  const wallet = provider || pickProvider();
  if (!wallet) return { ok: false, error: "No Solana wallet found. Install Phantom, Solflare or Backpack." };
  try {
    await wallet.connect?.();
    const pubkey = wallet.publicKey?.toBase58?.();
    if (!pubkey) return { ok: false, error: "Wallet not connected" };

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/swap", {
      method: "POST",
      headers: { "content-type": "application/json", ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ inputMint: SOL, outputMint: args.mint, amount: Math.floor(args.solAmount * 1e9), userPublicKey: pubkey, slippageBps: args.slippageBps, net: getNet() })
    }).then((r) => r.json());
    if (res.error || !res.swapTransaction) return { ok: false, error: res.error || "could not build swap" };

    const web3 = await import("@solana/web3.js");
    const raw = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
    const tx = web3.VersionedTransaction.deserialize(raw);
    const signed = await wallet.signAndSendTransaction(tx);
    const sig = signed?.signature ?? signed;

    if (session?.access_token) {
      await fetch("/api/record-trade", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mint: args.mint, side: "buy", solAmount: args.solAmount, priceUsd: args.priceUsd, feeSol: args.solAmount * 0.02, sig, kind: "manual" })
      }).catch(() => {});
    }
    return { ok: true, sig };
  } catch (e: any) {
    return { ok: false, error: e.message || "signing cancelled" };
  }
}
