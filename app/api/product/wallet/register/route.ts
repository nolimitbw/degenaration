import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { rpcResponse } from "@/lib/server/product";
import { callPrivyRpc, requirePrivySolanaWallet, requirePrivyUser } from "@/lib/server/privy";

/**
 * POST /api/product/wallet/register   — no body is read.
 * GET  /api/product/wallet/register   — the server's answer to "which wallet is mine".
 *
 * The canonical wallet-registration path (docs/ai/ACCOUNTING_MODEL.md step 1). Before this
 * existed, app_private.trading_wallets had no writer at all: app_user_upsert_wallet was
 * defined, bridge-allowlisted and deployed, but nothing in the application ever called it.
 * The server consequently could not name any user's wallet, which made every server-side
 * balance reconciliation impossible.
 *
 * THE ADDRESS IS NEVER READ FROM THE REQUEST. requirePrivySolanaWallet extracts it from the
 * verified Privy identity token. The POST body is not parsed, so there is no field a caller
 * could use to influence which address is recorded — not even a correct one belonging to
 * them. That is deliberate: a user with both an embedded and a connected wallet must not get
 * to choose which one the ledger attributes their balance to on a per-request basis.
 *
 * Idempotent by construction. The RPC upserts on (privy_user_id, address), so a replay
 * re-verifies the same row rather than creating a second. Cross-user claims are refused by
 * the RPC with 42501 and never reveal who holds the address.
 */

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 20, windowSeconds: 60 });
  if (limited) return limited;

  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const verified = await requirePrivySolanaWallet(req, user.privyUserId);
  if (!verified.ok) return verified.response;

  const result = await callPrivyRpc("app_user_upsert_wallet", {
    p_privy_user_id: user.privyUserId,
    p_wallet_address: verified.wallet.address,
    p_privy_wallet_id: verified.wallet.walletId,
    // Not user input: it records how the wallet reached us, which is what an operator needs
    // when a delegated wallet later fails to sign.
    p_label: verified.wallet.delegated ? "Delegated automation wallet" : "Privy wallet"
  });

  if (!result.ok) {
    // 42501 from the RPC means the address is actively registered to a different account.
    // Surfaced as a distinct, actionable message; the other owner is never named.
    if (result.status === 401 || result.status === 403) {
      return NextResponse.json(
        {
          error: "This wallet is already registered to another DegenAration account.",
          code: "WALLET_CLAIMED"
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;

  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  return rpcResponse(await callPrivyRpc("app_user_primary_wallet", {
    p_privy_user_id: user.privyUserId
  }));
}
