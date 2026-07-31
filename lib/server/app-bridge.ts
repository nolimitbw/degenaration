import { fetchWithTimeout } from "@/lib/server/guard";

type BridgeResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

// These messages are USER-VISIBLE. lib/product-api.ts `parseResponse` throws the `error`
// field verbatim and the dashboards render it, so "server not configured" and "database
// request failed" were reaching the public UI — internal language that spec 23 forbids, and
// meaningless to the person reading it. Verified: the bot builder displayed "server not
// configured" verbatim when the bridge was unset.
//
// The operator detail is not lost; it goes to the server log via `internal()` below. Only
// the client-facing string changed. Business errors from the edge function still pass
// through untouched, because those ARE user-actionable ("slug already taken").
const UNAVAILABLE = "This is temporarily unavailable. Please try again shortly.";

function internal(operation: string, detail: string) {
  console.error(`[app-bridge] ${operation}: ${detail}`);
  return UNAVAILABLE;
}

export async function callAppBridge<T>(operation: string, body: Record<string, unknown>): Promise<BridgeResult<T>> {
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.ADMIN_KEY;
  if (!base || !secret) return { ok: false, status: 503, error: internal(operation, "SUPABASE_URL or ADMIN_KEY is not set") };

  const response = await fetchWithTimeout(`${base.replace(/\/+$/, "")}/functions/v1/app-bridge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, ...body, p_secret: secret })
  }).catch(() => null);
  if (!response) return { ok: false, status: 502, error: internal(operation, "bridge request failed or timed out") };

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status === 401 ? 503 : 502,
      error: internal(operation, `bridge rejected with ${response.status}: ${data?.error || "no detail"}`)
    };
  }
  if (data?.ok === false) return { ok: false, status: Number(data.status) || 400, error: data.error || "request failed" };
  return { ok: true, data };
}
