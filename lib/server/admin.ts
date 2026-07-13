import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { fetchWithTimeout } from "@/lib/server/guard";

const OWNER_EMAILS = (process.env.ADMIN_OWNER_EMAILS || process.env.NEXT_PUBLIC_ADMIN_OWNER_EMAILS || "Flipthatsol@gmail.com")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function appId() {
  return process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
}

function getJwks() {
  const id = appId();
  if (!id) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${id}/jwks.json`));
  return jwks;
}

async function verifyPrivyJwt(token: string) {
  const keySet = getJwks();
  const id = appId();
  if (!keySet || !id) return null;
  const { payload } = await jwtVerify(token, keySet, { issuer: "privy.io", audience: id });
  return payload;
}

async function tryVerifyPrivyJwt(token: string | undefined | null) {
  if (!token) return null;
  try {
    return await verifyPrivyJwt(token);
  } catch {
    return null;
  }
}

function emailFromIdPayload(payload: any) {
  const linkedRaw = payload?.linked_accounts;
  let linked: any[] = [];
  try { linked = typeof linkedRaw === "string" ? JSON.parse(linkedRaw) : Array.isArray(linkedRaw) ? linkedRaw : []; } catch {}
  const account = linked.find((item) => item?.type === "email" || item?.type === "google_oauth");
  return String(account?.address || account?.email || payload?.email || "").trim().toLowerCase();
}

export async function requireAdmin(req: NextRequest) {
  const legacyKey = process.env.ADMIN_KEY;
  if (legacyKey && req.headers.get("x-admin-key") === legacyKey) return { ok: true as const, email: "legacy-admin-key" };

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const idToken = req.headers.get("x-privy-id-token")?.trim() || req.cookies.get("privy-id-token")?.value;
  if (!bearer && !idToken) return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const identity = await tryVerifyPrivyJwt(idToken);
  const access = await tryVerifyPrivyJwt(bearer);
  const verified = identity || access;

  if (!verified?.sub) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (identity?.sub && access?.sub && identity.sub !== access.sub) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const email = emailFromIdPayload(identity) || emailFromIdPayload(access);
  if (!OWNER_EMAILS.includes(email)) return { ok: false as const, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { ok: true as const, email };
}

export function adminRpcConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.ADMIN_KEY;
  if (!url || !key || !secret) return null;
  return {
    url,
    secret,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }
  };
}

export async function callAdminRpc<T>(name: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const cfg = adminRpcConfig();
  if (!cfg) return { ok: false, status: 503, error: "admin database not configured" };
  const response = await fetchWithTimeout(`${cfg.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: cfg.headers,
    body: JSON.stringify({ p_secret: cfg.secret, ...body })
  }).catch(() => null);
  if (!response) return { ok: false, status: 502, error: "admin rpc failed" };
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: 502, error: "admin rpc rejected" };
  if (data?.ok === false) return { ok: false, status: Number(data.status) || 400, error: data.error || "admin action failed" };
  return { ok: true, data };
}
