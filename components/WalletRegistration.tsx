"use client";

import { useEffect } from "react";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { getSolanaAddress } from "@/lib/solanaWallet";

// Keyed by user AND address so a wallet change within one session re-registers, while a
// simple remount does not. Module scope, matching ReferralCaptureCompletion: the point is to
// survive React remounts, and a page load legitimately re-verifies.
const attempted = new Set<string>();

/**
 * Registers the signed-in user's Solana wallet with the server exactly once per session.
 *
 * Until this existed nothing ever called app_user_upsert_wallet, so app_private.trading_wallets
 * was empty and the server could not name any user's wallet — which is why no server-side
 * balance reconciliation was possible. See docs/ai/ACCOUNTING_MODEL.md step 1.
 *
 * Renders nothing and blocks nothing. A failure here must never stand between a user and
 * their Portfolio, so there is no toast and no error surface: the next page load retries, and
 * a persistent failure shows up as a missing trading_wallets row in operator diagnostics
 * rather than as a broken screen. The one thing it must not do is silently retry forever, so
 * a 5xx unlocks after 15s and anything else stays locked for the session.
 *
 * The address below is used ONLY as a cache key. The server ignores the request body entirely
 * and takes the address from the verified identity token, so a tampered value here changes
 * nothing except how often this component re-fires.
 */
export default function WalletRegistration() {
  const { authenticated, user, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const address = getSolanaAddress(user);

  useEffect(() => {
    const userId = user?.id;
    if (!authenticated || !userId || !address || !identityToken) return;
    const key = `${userId}:${address}`;
    if (attempted.has(key)) return;
    attempted.add(key);

    let cancelled = false;
    getAccessToken()
      .then((token) => token ? fetch("/api/product/wallet/register", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "privy-id-token": identityToken },
        credentials: "same-origin"
      }) : null)
      .then((response) => {
        if (!cancelled && response && response.status >= 500) {
          window.setTimeout(() => attempted.delete(key), 15_000);
        }
      })
      .catch(() => {
        if (!cancelled) window.setTimeout(() => attempted.delete(key), 15_000);
      });

    return () => { cancelled = true; };
  }, [authenticated, address, getAccessToken, identityToken, user?.id]);

  return null;
}
