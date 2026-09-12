import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { PrivyClient } from "@privy-io/server-auth";
import { callAppBridge } from "@/lib/server/app-bridge";
import { privyWalletFromPayload, solanaWalletFromPayload } from "@/lib/server/privy-wallet";
import { linkedAccounts } from "@/lib/server/privy-wallet";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let privyAdmin: PrivyClient | null = null;

function appId() {
  // Browser access tokens are issued for the public Privy app configured in PrivyProvider.
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.PRIVY_APP_ID || "";
}

function keySet() {
  const id = appId();
  if (!id) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${id}/jwks.json`));
  return jwks;
}

function adminClient() {
  const id = appId();
  const secret = process.env.PRIVY_APP_SECRET || "";
  if (!id || !secret) return null;
  if (!privyAdmin) privyAdmin = new PrivyClient(id, secret);
  return privyAdmin;
}

async function hasCurrentDelegation(privyUserId: string, walletAddress: string, walletId: string) {
  const client = adminClient();
  if (!client) return false;
  const current = await client.getUserById(privyUserId);
  return current.linkedAccounts.some((account) => {
    if (account.type !== "wallet" || account.chainType !== "solana") return false;
    const accountId = "id" in account ? String(account.id || "") : "";
    return account.address === walletAddress
      && (!accountId || accountId === walletId)
      && account.delegated === true;
  });
}

export async function requirePrivyUser(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    || req.cookies.get("privy-token")?.value;
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
    const wallet = privyWalletFromPayload(payload, privyUserId, walletAddress, walletId);
    if (!wallet) throw new Error("wallet mismatch");
    // Identity tokens can remain cached briefly after addSigners succeeds. Ownership still
    // comes from the signed token; only refresh the delegation flag from Privy's server API.
    const delegated = wallet.delegated === true
      || await hasCurrentDelegation(privyUserId, walletAddress, walletId).catch(() => false);
    return { ok: true as const, delegated };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "wallet does not belong to this user" }, { status: 403 }) };
  }
}

/**
 * The caller's Solana wallet, taken from the verified identity token and from nowhere else.
 *
 * Use this when the server is RECORDING which wallet a user owns. requirePrivyWallet above
 * is for the other case — when the caller legitimately names a wallet and the server checks
 * it — and the two must not be confused: letting the request body choose the address during
 * registration would let a caller with several linked wallets decide which one the ledger
 * attributes their balance to.
 */
export async function requirePrivySolanaWallet(req: NextRequest, privyUserId: string) {
  const token = req.headers.get("privy-id-token")?.trim();
  const keys = keySet();
  const id = appId();
  if (!token || !keys || !id) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "wallet ownership proof required" }, { status: 401 })
    };
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: "privy.io", audience: id });
    const wallet = solanaWalletFromPayload(payload, privyUserId);
    if (!wallet) throw new Error("no verified solana wallet");
    return { ok: true as const, wallet };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "no verified Solana wallet on this account" }, { status: 403 })
    };
  }
}

/**
 * A Discord identity taken only from Privy's signed identity token.
 *
 * Access tokens establish the DegenAration user but omit linked-account claims. Owner
 * linking therefore requires the identity token as a second signed proof and checks that
 * both tokens belong to the same Privy subject.
 */
export async function requirePrivyDiscordIdentity(req: NextRequest, privyUserId: string) {
  const token = req.headers.get("privy-id-token")?.trim();
  const keys = keySet();
  const id = appId();
  if (!token || !keys || !id) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "verified Discord identity required" }, { status: 428 })
    };
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: "privy.io", audience: id });
    if (String(payload.sub || "") !== privyUserId) throw new Error("identity subject mismatch");
    const account = linkedAccounts(payload).find((item: any) => item?.type === "discord_oauth");
    const subject = String(account?.subject || "").trim();
    if (!/^\d{17,20}$/.test(subject)) throw new Error("Discord identity missing");
    return {
      ok: true as const,
      identity: {
        subject,
        username: String(account?.username || "").trim().slice(0, 100) || null
      }
    };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "verified Discord identity required" }, { status: 428 })
    };
  }
}

export async function callPrivyRpc<T>(name: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  return callAppBridge<T>(name, body);
}
