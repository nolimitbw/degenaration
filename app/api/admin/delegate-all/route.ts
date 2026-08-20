import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-shot operator tool: add the app's authorization key as an additional signer on every
 * user wallet, so delegated signing works without each client granting it by hand.
 *
 * WHY THIS EXISTS. Privy signs on a user's behalf only when the app's key is a signer for
 * that wallet. Until now the only way to get there was the consent card on /wallet, so every
 * client had to find and tap it — and until they did, their bot claimed calls and lost every
 * one at the signer. Privy's wallet-update API exposes `additional_signers`, which may allow
 * an app to do this server-side; this route is how we find out against the real API rather
 * than by reading docs.
 *
 * It runs HERE, not from a laptop, because PRIVY_APP_SECRET exists in this environment and
 * must not be copied anywhere else.
 *
 * SAFETY
 *   - POST only, and gated on BOT_SHARED_SECRET compared in constant time.
 *   - `?dryRun=1` lists what it would touch and changes nothing. Run that first.
 *   - Adds a SIGNER; it never changes a wallet's owner, so a user keeps control of their
 *     wallet and can revoke from the app.
 *   - Returns status codes and Privy's own error text, never a credential.
 */

const PRIVY_AUTH_BASE = "https://auth.privy.io/api/v1";
const PRIVY_WALLET_BASE = "https://api.privy.io/v1";

function authorized(req: Request): boolean {
  const secret = process.env.BOT_SHARED_SECRET || "";
  const supplied = req.headers.get("x-admin-secret") || "";
  if (!secret || !supplied) return false;
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

function basicAuth(): string {
  const id = process.env.PRIVY_APP_ID || "";
  const secret = process.env.PRIVY_APP_SECRET || "";
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

function privyHeaders(): Record<string, string> {
  return {
    Authorization: basicAuth(),
    "privy-app-id": process.env.PRIVY_APP_ID || "",
    "content-type": "application/json"
  };
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const signerId = (url.searchParams.get("signerId") || "").trim();
  if (!signerId) {
    return NextResponse.json(
      { error: "signerId is required — the key quorum id from Privy → Keys and quorums" },
      { status: 400 }
    );
  }

  const missing = ["PRIVY_APP_ID", "PRIVY_APP_SECRET"].filter((n) => !process.env[n]);
  if (missing.length) {
    return NextResponse.json({ error: `missing ${missing.join(", ")}` }, { status: 500 });
  }

  // ---- collect every Solana wallet across all users ----
  const wallets: { walletId: string; address: string; userId: string }[] = [];
  let cursor: string | undefined;
  let pages = 0;
  try {
    do {
      const q = new URL(`${PRIVY_AUTH_BASE}/users`);
      q.searchParams.set("limit", "100");
      if (cursor) q.searchParams.set("cursor", cursor);
      const res = await fetch(q, { headers: privyHeaders(), cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        return NextResponse.json(
          { step: "list users", status: res.status, privy: String(body?.error || body?.message || "").slice(0, 300) },
          { status: 502 }
        );
      }
      for (const user of body?.data || []) {
        for (const acct of user?.linked_accounts || []) {
          if (acct?.type === "wallet" && acct?.chain_type === "solana" && acct?.id) {
            wallets.push({ walletId: acct.id, address: acct.address, userId: user.id });
          }
        }
      }
      cursor = body?.next_cursor || undefined;
      pages += 1;
    } while (cursor && pages < 20);
  } catch (e: any) {
    return NextResponse.json({ step: "list users", error: String(e?.message || e).slice(0, 300) }, { status: 502 });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      signerId,
      walletsFound: wallets.length,
      sample: wallets.slice(0, 5).map((w) => ({ walletId: w.walletId, address: w.address }))
    });
  }

  // Privy refused the raw PATCH with "Missing privy-authorization-signature". That header is
  // derived from PRIVY_AUTHORIZATION_KEY and the SDK produces it; hand-rolling P-256 request
  // signing here would be a second implementation of the one thing that must not be subtly
  // wrong. Use the SDK, and report which method carried it so the next run is not guesswork.
  let sdk: any = null;
  let sdkMethod = "none";
  try {
    const { PrivyClient } = require("@privy-io/server-auth");
    const client = new PrivyClient(process.env.PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!, {
      walletApi: { authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_KEY }
    });
    sdk = client.walletApi;
    for (const name of ["updateWallet", "update", "addSigners", "addSigner"]) {
      if (typeof sdk?.[name] === "function") { sdkMethod = name; break; }
    }
  } catch (e: any) {
    return NextResponse.json({ step: "sdk init", error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
  if (sdkMethod === "none") {
    const names = sdk ? Object.getOwnPropertyNames(Object.getPrototypeOf(sdk)).filter((n) => typeof sdk[n] === "function") : [];
    return NextResponse.json({ step: "sdk method", error: "no update method found", available: names }, { status: 500 });
  }

  // ---- add the signer, one wallet at a time so one refusal does not hide the rest ----
  const results: { walletId: string; status: number; ok: boolean; privy?: string }[] = [];
  for (const w of wallets) {
    try {
      await sdk[sdkMethod]({ walletId: w.walletId, additionalSigners: [{ signerId }] });
      results.push({ walletId: w.walletId, status: 200, ok: true });
    } catch (e: any) {
      results.push({ walletId: w.walletId, status: 0, ok: false, privy: String(e?.message || e).slice(0, 240) });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return NextResponse.json({
    signerId,
    sdkMethod,
    walletsFound: wallets.length,
    succeeded,
    failed: results.length - succeeded,
    // The first distinct refusals, which is what tells us whether Privy permits this at all.
    refusals: [...new Map(results.filter((r) => !r.ok).map((r) => [r.privy, r])).values()].slice(0, 3),
    results: results.slice(0, 20)
  });
}
