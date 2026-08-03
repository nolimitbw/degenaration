import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { rpcResponse, UUID_RE } from "@/lib/server/product";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

/**
 * POST /api/product/portfolio/withdraw/signature
 * body: { withdrawalId, txSignature }
 *
 * Persists the signature of the transfer the user actually signed and sent.
 *
 * This is what makes a confirmed withdrawal recoverable. The server is non-custodial: it
 * builds an unsigned transaction and the user's wallet broadcasts it, so the signature is the
 * one fact the server cannot reconstruct afterwards. Recording it immediately means that if
 * anything downstream fails — the process dies, the database write for history fails, the
 * user closes the tab — reconciliation can still find the transfer on chain and settle it.
 *
 * Called by the modal straight after signAndSendTransaction returns, before any UI update.
 *
 * Idempotent: re-posting the same signature for the same withdrawal succeeds. A DIFFERENT
 * signature for the same withdrawal is refused with 409, because two signatures for one
 * intent means two broadcasts, and that is the thing this whole path exists to prevent.
 */
export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 20, windowSeconds: 60, failClosed: true });
  if (limited) return limited;

  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const withdrawalId = String(body?.withdrawalId || "").trim();
  const txSignature = String(body?.txSignature || "").trim();
  if (!UUID_RE.test(withdrawalId)) {
    return NextResponse.json({ error: "invalid withdrawal id" }, { status: 400 });
  }
  // Solana signatures are base58 and 64 bytes, which encodes to 86-88 characters.
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(txSignature)) {
    return NextResponse.json({ error: "invalid transaction signature" }, { status: 400 });
  }

  // The RPC scopes the lookup to the owner, so one user cannot attach a signature to
  // another's withdrawal even holding a valid id.
  return rpcResponse(await callPrivyRpc("app_user_record_withdrawal_signature", {
    p_privy_user_id: user.privyUserId,
    p_intent_id: withdrawalId,
    p_tx_signature: txSignature
  }));
}
