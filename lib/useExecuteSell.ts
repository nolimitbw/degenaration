"use client";
import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSendTransaction } from "@privy-io/react-auth/solana";
import { supabase } from "./supabase";
import { getRpc, getNet } from "./net";
import { getSolanaAddress } from "./solanaWallet";

const SOL = "So11111111111111111111111111111111111111112";

type SellArgs = { mint: string; pct: number; slippageBps: number; priceUsd?: number | null; symbol?: string; mev?: boolean };
type Result = { ok: boolean; sig?: string; error?: string; soldUi?: number };

/**
 * Sell a percentage (0-1) of the user's on-chain balance of `mint` back to SOL.
 * Fetches the exact raw balance at execution time (no decimal guessing), builds a Jupiter
 * swap token->SOL via /api/swap, and signs with the user's Privy embedded wallet.
 * Non-custodial — the user's wallet signs. Mirrors useExecuteBuy's proven loop.
 */
export function useExecuteSell() {
  const { authenticated, user } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const embeddedAddr = getSolanaAddress(user);

  return useCallback(async function executeSell(args: SellArgs): Promise<Result> {
    if (!authenticated || !embeddedAddr) return { ok: false, error: "Connect a wallet to sell" };
    const pct = Math.min(1, Math.max(0, args.pct));
    if (pct <= 0) return { ok: false, error: "Pick a sell amount" };
    try {
      const net = getNet();
      const bal = await fetch(`/api/token-balance?owner=${embeddedAddr}&mint=${args.mint}&net=${net}`).then((r) => r.json());
      if (bal.error) return { ok: false, error: bal.error };
      const rawTotal = BigInt(bal.rawAmount || "0");
      if (rawTotal <= BigInt(0)) return { ok: false, error: "You don't hold this token" };
      // exact raw amount for the chosen percentage
      const amount = (rawTotal * BigInt(Math.round(pct * 10000))) / BigInt(10000);
      if (amount <= BigInt(0)) return { ok: false, error: "Amount too small" };

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json", ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ inputMint: args.mint, outputMint: SOL, amount: amount.toString(), userPublicKey: embeddedAddr, slippageBps: args.slippageBps, net, mev: args.mev ?? true })
      }).then((r) => r.json());
      if (res.error || !res.swapTransaction) return { ok: false, error: res.error || "could not build swap" };

      const web3 = await import("@solana/web3.js");
      const buf = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
      const tx = web3.VersionedTransaction.deserialize(buf);
      const connection = new web3.Connection(getRpc(), "confirmed");
      const receipt: any = await sendTransaction({ transaction: tx, connection });
      const sig = receipt?.signature ?? undefined;

      const soldUi = (bal.decimals > 0 ? Number(amount) / 10 ** bal.decimals : Number(amount));
      const solOut = res.outAmount ? Number(res.outAmount) / 1e9 : undefined;
      if (session?.access_token) {
        await fetch("/api/record-trade", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ mint: args.mint, side: "sell", solAmount: solOut, priceUsd: args.priceUsd, feeSol: solOut ? solOut * 0.02 : 0, sig, kind: "manual" })
        }).catch(() => {});
      }
      return { ok: true, sig, soldUi };
    } catch (e: any) {
      return { ok: false, error: e.message || "signing cancelled" };
    }
  }, [authenticated, embeddedAddr, sendTransaction]);
}
