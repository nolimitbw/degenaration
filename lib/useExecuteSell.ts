"use client";
import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSendTransaction } from "@privy-io/react-auth/solana";
import { supabase } from "./supabase";
import { getRpc, getNet } from "./net";
import { fetchWithTimeout, sanitizeError } from "./server/guard";
import { getSolanaAddress } from "./solanaWallet";
import { executeSell as extensionSell } from "./execute";

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
    if (!authenticated) return { ok: false, error: "Connect a wallet to sell" };
    // No Privy embedded Solana wallet -> use an extension wallet (mirrors useExecuteBuy).
    if (!embeddedAddr) return extensionSell(args);
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
      const res = await fetchWithTimeout("/api/swap", {
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
        await fetchWithTimeout("/api/record-trade", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ mint: args.mint, side: "sell", solAmount: solOut, priceUsd: args.priceUsd, feeSol: solOut ? solOut * 0.02 : 0, sig, kind: "manual" })
        }).catch(() => {});
      }
      return { ok: true, sig, soldUi };
    } catch (e: any) {
      // External (non-embedded) Solana wallet: Privy's embedded-only sender can't sign it —
      // fall back to adapter signing so Phantom/Solflare/Backpack users can also sell.
      if (/embedded/i.test(sanitizeError(e) || "")) return extensionSell(args);
      return { ok: false, error: sanitizeError(e) || "signing cancelled" };
    }
  }, [authenticated, embeddedAddr, sendTransaction]);
}
