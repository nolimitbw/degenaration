"use client";
import { useState } from "react";
import { supabase } from "./supabase";

const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export type SwapArgs = { inputMint: string; outputMint: string; amount: number; userPublicKey: string; slippageBps?: number };
type SwapState = { status: "idle" | "quoting" | "signing" | "sending" | "done" | "error"; sig?: string; error?: string; outAmount?: string };

/**
 * Client swap: fetch unsigned tx from /api/swap, sign with the user's wallet, broadcast to devnet.
 * The component passes its Privy `signTransaction` (obtained from the useSignTransaction hook at the
 * top level of the component). The platform NEVER holds keys — the user's wallet signs.
 */
export function useSwap() {
  const [state, setState] = useState<SwapState>({ status: "idle" });

  async function signAndSend(args: SwapArgs, signTransaction: (tx: any) => Promise<any>) {
    try {
      setState({ status: "quoting" });
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(args)
      }).then((r) => r.json());
      if (res.error || !res.swapTransaction) throw new Error(res.error || "no transaction");

      const web3 = await import("@solana/web3.js");
      const rawBytes = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
      const tx = web3.VersionedTransaction.deserialize(rawBytes);

      setState({ status: "signing", outAmount: res.outAmount });
      const signed = await signTransaction(tx);

      setState({ status: "sending", outAmount: res.outAmount });
      const conn = new web3.Connection(DEVNET_RPC);
      const sig = await conn.sendRawTransaction(signed.serialize());
      await conn.confirmTransaction(sig);

      setState({ status: "done", sig, outAmount: res.outAmount });
      return sig;
    } catch (e: any) {
      setState({ status: "error", error: e.message });
      return null;
    }
  }

  return { state, signAndSend };
}
