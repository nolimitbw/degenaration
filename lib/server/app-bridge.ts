import { fetchWithTimeout } from "@/lib/server/guard";

type BridgeResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function callAppBridge<T>(operation: string, body: Record<string, unknown>): Promise<BridgeResult<T>> {
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.ADMIN_KEY;
  if (!base || !secret) return { ok: false, status: 503, error: "server not configured" };

  const response = await fetchWithTimeout(`${base.replace(/\/+$/, "")}/functions/v1/app-bridge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, ...body, p_secret: secret })
  }).catch(() => null);
  if (!response) return { ok: false, status: 502, error: "database request failed" };

  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status === 401 ? 503 : 502, error: data?.error || "database request rejected" };
  if (data?.ok === false) return { ok: false, status: Number(data.status) || 400, error: data.error || "request failed" };
  return { ok: true, data };
}
