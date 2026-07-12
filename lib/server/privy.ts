import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

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
