"use client";

type TradeRecord = {
  mint: string;
  side: "buy" | "sell";
  solAmount?: number;
  priceUsd?: number | null;
  sig: string;
  kind: "manual" | "entry" | "tp1" | "tp2" | "sl";
  userPubkey: string;
};

const RETRY_DELAYS = [0, 900, 1800];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function recordTradeWithRetry(record: TradeRecord, authToken: string) {
  let lastError = "Trade history sync failed";

  for (const delay of RETRY_DELAYS) {
    if (delay) await wait(delay);
    try {
      const response = await fetch("/api/record-trade", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${authToken}` },
        body: JSON.stringify(record)
      });
      const data = await response.json().catch(() => null);
      if (response.ok || data?.error === "transaction already recorded") return null;
      lastError = typeof data?.error === "string" ? data.error : `Trade history sync failed (${response.status})`;

      const retryable = response.status >= 500 || response.status === 409 || /confirm|database|verification/i.test(lastError);
      if (!retryable) break;
    } catch {
      lastError = "Trade history sync could not reach the server";
    }
  }

  return `${lastError}. The on-chain transaction was sent; do not submit it again.`;
}
