import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { callAppBridge } from "@/lib/server/app-bridge";

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

export async function callAdminRpc<T>(name: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  return callAppBridge<T>(name, body);
}
