import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { fetchWithTimeout } from "@/lib/server/guard";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function appId() {
  return process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
}

function keySet() {
  const id = appId();
  if (!id) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${id}/jwks.json`));
  return jwks;
}

export async function requirePrivyUser(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const keys = keySet();
  const id = appId();
  if (!bearer || !keys || !id) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  try {
    const { payload } = await jwtVerify(bearer, keys, { issuer: "privy.io", audience: id });
    if (!payload.sub) throw new Error("missing subject");
    return { ok: true as const, privyUserId: String(payload.sub) };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
}

export function serviceHeaders(extra?: Record<string, string>) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return null;
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...extra };
}

export function serviceUrl() {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

export function rpcConfig() {
  const url = serviceUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.ADMIN_KEY;
  if (!url || !key || !secret) return null;
  return {
    url,
    secret,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }
  };
}

export async function callPrivyRpc<T>(name: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const cfg = rpcConfig();
  if (!cfg) return { ok: false, status: 503, error: "server not configured" };
  const response = await fetchWithTimeout(`${cfg.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: cfg.headers,
    body: JSON.stringify({ p_secret: cfg.secret, ...body })
  }).catch(() => null);
  if (!response) return { ok: false, status: 502, error: "database request failed" };
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: 502, error: data?.message || "database request rejected" };
  if (data?.ok === false) return { ok: false, status: Number(data.status) || 400, error: data.error || "request failed" };
  return { ok: true, data };
}
