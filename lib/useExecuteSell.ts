"use client";
import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getBase58Decoder } from "@solana/kit";
import { getNet } from "./net";
import { fetchWithTimeout, sanitizeError } from "./server/guard";
import { getSolanaAddress } from "./solanaWallet";
import { executeSell as extensionSell } from "./execute";
import { recordTradeWithRetry } from "./recordTrade";

const SOL = "So11111111111111111111111111111111111111112";

type SellArgs = { mint: string; pct: number; slippageBps: number; priceUsd?: number | null; symbol?: string; mev?: boolean };
type Result = { ok: boolean; sig?: string; error?: string; warning?: string; soldUi?: number };

/**
 * Sell a percentage (0-1) of the user's on-chain balance of `mint` back to SOL.
 * Fetches the exact raw balance at execution time (no decimal guessing), builds a Jupiter
 * swap token->SOL via /api/swap, and signs with the user's Privy embedded wallet.
 * Non-custodial — the user's wallet signs. Mirrors useExecuteBuy's proven loop.
 */
export function useExecuteSell() {
  const { authenticated, user, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const embeddedAddr = getSolanaAddress(user);
  const privyWallet = wallets.find((wallet) => wallet.address === embeddedAddr);

  return useCallback(async function executeSell(args: SellArgs): Promise<Result> {
    if (!authenticated) return { ok: false, error: "Connect a wallet to sell" };
    if (embeddedAddr && !walletsReady) return { ok: false, error: "Your wallet is still loading. Try again in a moment." };
    // No Privy embedded Solana wallet -> use an extension wallet (mirrors useExecuteBuy).
    if (!embeddedAddr || !privyWallet) return extensionSell({ ...args, authToken: await getAccessToken() });
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

      const token = await getAccessToken();
      const res = await fetchWithTimeout("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ inputMint: args.mint, outputMint: SOL, amount: amount.toString(), userPublicKey: embeddedAddr, slippageBps: args.slippageBps, net, mev: args.mev ?? true })
      }).then((r) => r.json());
      if (res.error || !res.swapTransaction) return { ok: false, error: res.error || "could not build swap" };

      const buf = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
      const receipt = await signAndSendTransaction({ transaction: buf, wallet: privyWallet, chain: "solana:mainnet" });
      const sig = getBase58Decoder().decode(receipt.signature);

      const soldUi = (bal.decimals > 0 ? Number(amount) / 10 ** bal.decimals : Number(amount));
      const solOut = res.outAmount ? Number(res.outAmount) / 1e9 : undefined;
      const warning = token
        ? await recordTradeWithRetry({ mint: args.mint, side: "sell", solAmount: solOut, priceUsd: args.priceUsd, sig, kind: "manual", userPubkey: embeddedAddr }, token)
        : null;
      return { ok: true, sig, soldUi, warning: warning || undefined };
    } catch (e: any) {
      // External (non-embedded) Solana wallet: Privy's embedded-only sender can't sign it —
      // fall back to adapter signing so Phantom/Solflare/Backpack users can also sell.
      if (/embedded/i.test(sanitizeError(e) || "")) return extensionSell({ ...args, authToken: await getAccessToken() });
      return { ok: false, error: sanitizeError(e) || "signing cancelled" };
    }
  }, [authenticated, embeddedAddr, getAccessToken, privyWallet, signAndSendTransaction, walletsReady]);
}
