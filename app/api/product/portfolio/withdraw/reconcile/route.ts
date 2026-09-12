import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

/**
 * POST /api/product/portfolio/withdraw/reconcile
 *
 * Settles the caller's submitted withdrawals against the network.
 *
 * WHY THIS EXISTS
 *
 * `app_user_record_withdrawal_signature` moves an intent to `submitted`, and
 * `app_user_settle_withdrawal` was written to move it to `confirmed`. Nothing in production
 * ever called the second one — a grep for it finds test scripts and nothing else.
 *
 * That is not a cosmetic gap. `app_user_withdrawable_state` counts every `submitted` intent
 * toward pendingWithdrawalLamports, and the withdraw modal subtracts that from spendable. So a
 * withdrawal that SUCCEEDED on chain and was never settled removes its own amount from the
 * owner's balance permanently: the modal shows 0 available, every percentage button is
 * disabled, and the user is told they have nothing to withdraw while the money is sitting in
 * their wallet. One live intent had held 0.89 SOL that way for three days.
 *
 * The server is non-custodial and never broadcasts, so it cannot know an outcome by having
 * caused it. The only way to learn one is to read the transaction. That is what this does.
 *
 * WHY IT IS DRIVEN BY THE CLIENT AND NOT A CRON
 *
 * `app_user_pending_withdrawals` is scoped to one owner — deliberately, since it is reached
 * through the per-user bridge. Running it as the page loads means the hold clears at exactly
 * the moment it would otherwise be noticed, and the reconciliation is authorized by the same
 * session that owns the funds rather than by a background job holding a blanket credential.
 *
 * Safe to call on every load: `app_user_reconcile_withdrawal` returns `duplicate` for an
 * already-terminal intent and takes `for update` on the row, so overlapping tabs cannot
 * double-settle. It reports only what it observed and never writes a movement for a transfer
 * that did not move money.
 */

const SOL_RPC_FALLBACK = "https://api.mainnet-beta.solana.com";

/**
 * A blockhash is valid for roughly 60-90 seconds. A signature still absent from history well
 * past that can never land, so the hold may be released. Two minutes clears the window with
 * room for clock skew, and `app_user_reconcile_withdrawal` asserts the same bound itself so a
 * mistake here alone cannot free capital early.
 */
const UNLANDED_GRACE_SECONDS = 120;

type Pending = { id: string; txSignature: string | null; amountLamports: string; submittedAt: string };

type Observed =
  | { landed: false }
  | { landed: true; succeeded: boolean; error: string | null }
  | { unknown: true };

/**
 * Reads one signature. `searchTransactionHistory` matters: without it the RPC only consults
 * its recent-status cache, and a transfer older than a couple of minutes — which is every
 * transfer this endpoint is here to rescue — reads as "not found" and would be wrongly
 * declared expired.
 */
async function observe(rpc: string, signature: string): Promise<Observed> {
  try {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }]
      })
    });
    if (!response.ok) return { unknown: true };
    const data = await response.json();
    if (data?.error) return { unknown: true };
    // `value` is a fixed-length array with null for a signature the network does not know.
    const status = data?.result?.value?.[0];
    if (status === undefined) return { unknown: true };
    if (status === null) return { landed: false };
    return {
      landed: true,
      succeeded: status.err == null,
      error: status.err == null ? null : `transaction reverted: ${JSON.stringify(status.err).slice(0, 200)}`
    };
  } catch {
    // A provider timeout is not evidence of anything. Leave the intent submitted and let the
    // next load try again — never guess an outcome that moves money.
    return { unknown: true };
  }
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 30, windowSeconds: 60 });
  if (limited) return limited;

  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const pending = await callPrivyRpc<{ withdrawals?: Pending[] }>("app_user_pending_withdrawals", {
    p_privy_user_id: user.privyUserId,
    // The RPC's own grace period against a transfer broadcast a moment ago. The unlanded
    // decision uses the stricter window below.
    p_older_than_seconds: 20
  });
  if (!pending.ok) {
    return NextResponse.json(
      { error: "Withdrawal status is temporarily unavailable. Try again in a moment.", retryable: true },
      { status: 503 }
    );
  }

  const rows = (pending.data?.withdrawals || []).filter((row) => row.txSignature);
  const rpc = process.env.SOLANA_RPC_URL || process.env.MAINNET_RPC || SOL_RPC_FALLBACK;
  const settled: { id: string; state: string }[] = [];
  let unresolved = 0;

  for (const row of rows) {
    const seen = await observe(rpc, String(row.txSignature));
    if ("unknown" in seen) {
      unresolved += 1;
      continue;
    }

    if (!seen.landed) {
      const age = Date.now() - new Date(row.submittedAt).getTime();
      // Still inside the window where it could land. Leave it alone.
      if (!Number.isFinite(age) || age < UNLANDED_GRACE_SECONDS * 1000) {
        unresolved += 1;
        continue;
      }
    }

    const result = await callPrivyRpc<{ state?: string }>("app_user_reconcile_withdrawal", {
      p_privy_user_id: user.privyUserId,
      p_intent_id: row.id,
      p_landed: seen.landed,
      p_succeeded: seen.landed ? seen.succeeded : false,
      p_error: seen.landed
        ? seen.error
        : "transaction was never confirmed by the network and can no longer land"
    });
    if (result.ok && result.data?.state) settled.push({ id: row.id, state: result.data.state });
    else unresolved += 1;
  }

  return NextResponse.json(
    { ok: true, examined: rows.length, settled, unresolved },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
