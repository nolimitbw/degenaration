"use client";

import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

const attemptedUsers = new Set<string>();

export default function ReferralCaptureCompletion() {
  const { authenticated, user, getAccessToken } = usePrivy();

  useEffect(() => {
    const userId = user?.id;
    if (!authenticated || !userId || attemptedUsers.has(userId)) return;
    attemptedUsers.add(userId);

    let cancelled = false;
    getAccessToken()
      .then((token) => token ? fetch("/api/product/referrals/complete", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        credentials: "same-origin"
      }) : null)
      .then((response) => {
        if (!cancelled && response && response.status >= 500) {
          window.setTimeout(() => attemptedUsers.delete(userId), 15_000);
        }
      })
      .catch(() => {
        if (!cancelled) window.setTimeout(() => attemptedUsers.delete(userId), 15_000);
      });

    return () => { cancelled = true; };
  }, [authenticated, getAccessToken, user?.id]);

  return null;
}
