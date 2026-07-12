"use client";
import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSendTransaction } from "@privy-io/react-auth/solana";
import { getRpc, getNet } from "./net";
import { fetchWithTimeout, sanitizeError } from "./server/guard";
import { executeBuy as extensionBuy } from "./execute";
import { getSolanaAddress } from "./solanaWallet";

const SOL = "So11111111111111111111111111111111111111112";

type BuyArgs = { mint: string; solAmount: number; slippageBps: number; priceUsd?: number | null; symbol?: string; mev?: boolean };
type Result = { ok: boolean; sig?: string; error?: string };

/**
 * Returns an executeBuy that signs with the user's Privy EMBEDDED wallet (the wallet
 * Google/email sign-ups get), mirroring the proven SwapPanel loop. Falls back to a
 * browser-extension wallet (Phantom/Solflare/Backpack) when no embedded wallet is present.
 * Non-custodial throughout — the user's wallet signs every transaction.
 */
export function useExecuteBuy() {
  const { authenticated, user, getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const embeddedAddr = getSolanaAddress(user);

  return useCallback(async function executeBuy(args: BuyArgs): Promise<Result> {
    // No embedded wallet -> use an extension wallet (existing path).
    if (!authenticated || !embeddedAddr) return extensionBuy({ ...args, authToken: await getAccessToken() });

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ inputMint: SOL, outputMint: args.mint, amount: String(Math.round(args.solAmount * 1e9)), userPublicKey: embeddedAddr, slippageBps: args.slippageBps, net: getNet(), mev: args.mev ?? true })
      }).then((r) => r.json());
      if (res.error || !res.swapTransaction)         return { ok: false, error: res.error || "could not build swap" };

      const web3 = await import("@solana/web3.js");
      const raw = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
      const tx = web3.VersionedTransaction.deserialize(raw);
      const connection = new web3.Connection(getRpc(), "confirmed");
      const receipt: any = await sendTransaction({ transaction: tx, connection });
      const sig = receipt?.signature ?? undefined;

      if (token) {
        const feeSol = res.platformFeeBps ? args.solAmount * (Number(res.platformFeeBps) / 10000) : 0;
        await fetchWithTimeout("/api/record-trade", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ mint: args.mint, side: "buy", solAmount: args.solAmount, priceUsd: args.priceUsd, feeSol, sig, kind: "manual", userPubkey: embeddedAddr })
        }).catch(() => {});
      }
      return { ok: true, sig };
    } catch (e: any) {
      // The linked Solana wallet is EXTERNAL (Phantom/Solflare/Backpack), not a Privy
      // embedded wallet, so useSendTransaction rejects it — fall back to adapter signing.
      if (/embedded/i.test(sanitizeError(e) || "")) return extensionBuy({ ...args, authToken: await getAccessToken() });
      return { ok: false, error: sanitizeError(e) || "signing cancelled" };
    }
  }, [authenticated, embeddedAddr, getAccessToken, sendTransaction]);
}
