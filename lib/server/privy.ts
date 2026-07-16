import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { callAppBridge } from "@/lib/server/app-bridge";
import { ownsPrivyWallet } from "@/lib/server/privy-wallet";

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

export async function requirePrivyWallet(
  req: NextRequest,
  privyUserId: string,
  walletAddress: string,
  walletId: string
) {
  const token = req.headers.get("privy-id-token")?.trim();
  const keys = keySet();
  const id = appId();
  if (!token || !keys || !id) {
    return { ok: false as const, response: NextResponse.json({ error: "wallet ownership proof required" }, { status: 401 }) };
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: "privy.io", audience: id });
    if (!ownsPrivyWallet(payload, privyUserId, walletAddress, walletId)) throw new Error("wallet mismatch");
    return { ok: true as const };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "wallet does not belong to this user" }, { status: 403 }) };
  }
}

export async function callPrivyRpc<T>(name: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  return callAppBridge<T>(name, body);
}
