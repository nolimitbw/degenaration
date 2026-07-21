"use client";
import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getBase58Decoder } from "@solana/kit";
import { getNet } from "./net";
import { sanitizeError } from "./server/guard";
import { executeBuy as extensionBuy } from "./execute";
import { getSolanaAddress } from "./solanaWallet";
import { recordTradeWithRetry } from "./recordTrade";

const SOL = "So11111111111111111111111111111111111111112";

type BuyArgs = { mint: string; solAmount: number; slippageBps: number; priceUsd?: number | null; symbol?: string; mev?: boolean };
type Result = { ok: boolean; sig?: string; error?: string; warning?: string };

/**
 * Returns an executeBuy that signs with the user's Privy EMBEDDED wallet (the wallet
 * Google/email sign-ups get), mirroring the proven SwapPanel loop. Falls back to a
 * browser-extension wallet (Phantom/Solflare/Backpack) when no embedded wallet is present.
 * Non-custodial throughout — the user's wallet signs every transaction.
 */
export function useExecuteBuy() {
  const { authenticated, user, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const embeddedAddr = getSolanaAddress(user);
  const privyWallet = wallets.find((wallet) => wallet.address === embeddedAddr);

  return useCallback(async function executeBuy(args: BuyArgs): Promise<Result> {
    if (authenticated && embeddedAddr && !walletsReady) return { ok: false, error: "Your wallet is still loading. Try again in a moment." };
    // No embedded wallet -> use an extension wallet (existing path).
    if (!authenticated || !embeddedAddr || !privyWallet) return extensionBuy({ ...args, authToken: await getAccessToken() });

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ inputMint: SOL, outputMint: args.mint, amount: String(Math.round(args.solAmount * 1e9)), userPublicKey: embeddedAddr, slippageBps: args.slippageBps, net: getNet(), mev: args.mev ?? true })
      }).then((r) => r.json());
      if (res.error || !res.swapTransaction)         return { ok: false, error: res.error || "could not build swap" };

      const raw = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
      const receipt = await signAndSendTransaction({ transaction: raw, wallet: privyWallet, chain: "solana:mainnet" });
      const sig = getBase58Decoder().decode(receipt.signature);

      const warning = token
        ? await recordTradeWithRetry({ mint: args.mint, side: "buy", solAmount: args.solAmount, priceUsd: args.priceUsd, sig, kind: "manual", userPubkey: embeddedAddr }, token)
        : null;
      return { ok: true, sig, warning: warning || undefined };
    } catch (e: any) {
      // The linked Solana wallet is EXTERNAL (Phantom/Solflare/Backpack), not a Privy
      // embedded wallet, so useSendTransaction rejects it — fall back to adapter signing.
      if (/embedded/i.test(sanitizeError(e) || "")) return extensionBuy({ ...args, authToken: await getAccessToken() });
      return { ok: false, error: sanitizeError(e) || "signing cancelled" };
    }
  }, [authenticated, embeddedAddr, getAccessToken, privyWallet, signAndSendTransaction, walletsReady]);
}
