import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server/auth";
import { ensureUser } from "@/lib/server/user";
import { db } from "@/lib/db/client";
import { createWallet } from "@/lib/solana/wallet";
import { getSolBalance, isLiveTrading } from "@/lib/trading/jupiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WalletRow = { id: string; address: string };

/**
 * The user's wallet. Created on first request so onboarding is a single tap rather than
 * a setup flow.
 *
 * The encrypted secret is never selected into this handler and the private key is never
 * returned in any form.
 */
export async function GET(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const user = await ensureUser({
    tgId: auth.user.id,
    username: auth.user.username,
    firstName: auth.user.firstName
  });
  if (!user) return NextResponse.json({ error: "could not load account" }, { status: 503 });

  let rows = await db<WalletRow[]>(`wallets?user_id=eq.${user.id}&select=id,address&limit=1`);

  if (!rows?.length) {
    const wallet = createWallet();
    rows = await db<WalletRow[]>("wallets", {
      method: "POST",
      body: { user_id: user.id, address: wallet.address, encrypted_secret: wallet.encrypted.ciphertext }
    });
    // A unique-violation here means a concurrent request already made one; read it back
    // rather than handing this caller a second wallet.
    if (!rows?.length) rows = await db<WalletRow[]>(`wallets?user_id=eq.${user.id}&select=id,address&limit=1`);
  }

  const address = rows?.[0]?.address;
  if (!address) return NextResponse.json({ error: "could not create wallet" }, { status: 503 });

  return NextResponse.json({
    address,
    balanceSol: await getSolBalance(address),
    live: isLiveTrading()
  });
}
