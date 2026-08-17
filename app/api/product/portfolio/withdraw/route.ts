import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";
import { sanitizeError } from "@/lib/server/guard";
import {
  REQUIRED_RESERVE_LAMPORTS,
  isSolanaAddress,
  spendableLamports,
  validateWithdrawal
} from "@/lib/withdrawal";
import { walletBalanceLamports } from "@/lib/server/wallet-balance";

/**
 * POST /api/product/portfolio/withdraw
 * body: { from, walletId, to, amountLamports, requestId? }
 *
 * Self-service user principal withdrawal (spec §12). DegenAration is non-custodial:
 * this builds an UNSIGNED transfer from the user's OWN wallet, which the user then
 * signs. There is no routine admin approval and no per-user unlock flag.
 *
 * Authorization: the caller must present a Privy access token AND a Privy identity
 * token proving they own `from`. A user can therefore only ever build a transfer that
 * spends their own funds.
 *
 * GET returns the same balance/locked figures so the UI can render availability without
 * requesting a transaction.
 */

// One balance reader, shared with the bot readiness route. This file used to carry its own
// single-provider copy; the readiness route had no copy at all and read a key off an RPC that
// never returns one, so the two money surfaces disagreed on the same screen. Sharing the
// reader is what makes that impossible rather than merely fixed once.
// It also gains provider failover here, which the local copy did not have.

/** Authoritative committed capital. Never trust a client-supplied figure (§12.5). */
async function committedLamports(
  privyUserId: string
): Promise<{ ok: true; locked: bigint; pending: bigint } | { ok: false }> {
  const result = await callPrivyRpc<{
    lockedLamports?: string;
    inFlightIntents?: number;
    pendingWithdrawalLamports?: string;
  }>("app_user_withdrawable_state", { p_privy_user_id: privyUserId });
  if (!result.ok) return { ok: false };
  try {
    return {
      ok: true,
      locked: BigInt(String(result.data?.lockedLamports ?? "0")),
      // A withdrawal the user already asked for that has not settled. Deducting it is what
      // stops a second request being approved against lamports the first is about to spend.
      pending: BigInt(String(result.data?.pendingWithdrawalLamports ?? "0"))
    };
  } catch {
    return { ok: false };
  }
}

async function resolveState(req: NextRequest, address: string, privyUserId: string) {
  const [balance, committed] = await Promise.all([
    walletBalanceLamports(address),
    committedLamports(privyUserId)
  ]);

  // Fail closed on an unverifiable financial state, but as a TEMPORARY operational
  // error with retry — never as a permission or feature-disabled message (§12.4).
  if (balance == null || !committed.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Balance is temporarily unavailable. Try again in a moment.", retryable: true },
        { status: 503 }
      )
    };
  }
  return { ok: true as const, balance, locked: committed.locked, pending: committed.pending };
}

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const address = req.nextUrl.searchParams.get("wallet") || "";
  if (!isSolanaAddress(address)) {
    return NextResponse.json({ error: "invalid wallet address" }, { status: 400 });
  }

  const state = await resolveState(req, address, user.privyUserId);
  if (!state.ok) return state.response;

  const spendable = spendableLamports({
    balanceLamports: state.balance,
    lockedLamports: state.locked,
    pendingWithdrawalLamports: state.pending
  });
  return NextResponse.json(
    {
      balanceLamports: state.balance.toString(),
      lockedLamports: state.locked.toString(),
      pendingWithdrawalLamports: state.pending.toString(),
      spendableLamports: spendable.toString(),
      reserveLamports: REQUIRED_RESERVE_LAMPORTS.toString()
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(req: NextRequest) {
  // failClosed, like every other mutating money route (bots, kol-subscriptions, payouts,
  // both referral routes). This one was the only one without it, which read as an oversight
  // rather than a decision: when the bridge is unavailable the limiter silently fell back to
  // the in-memory limiter, which is PER INSTANCE and therefore no real bound across a
  // serverless fleet.
  //
  // It costs nothing in availability. resolveState below already returns 503 when the
  // bridge cannot verify the balance, so a request that gets past a failed-open limiter was
  // going to fail a few lines later anyway. This just fails closed at the first gate.
  const limited = await distributedRateLimit(req, { limit: 10, windowSeconds: 60, failClosed: true });
  if (limited) return limited;

  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const from = String(body?.from || "").trim();
  const to = String(body?.to || "").trim();
  const walletId = String(body?.walletId || "").trim();
  if (!isSolanaAddress(from)) return NextResponse.json({ error: "invalid wallet address" }, { status: 400 });

  // Proves the authenticated user owns `from`. Without this a caller could build a
  // transfer draining a wallet they do not control.
  const owned = await requirePrivyWallet(req, user.privyUserId, from, walletId);
  if (!owned.ok) return owned.response;

  const state = await resolveState(req, from, user.privyUserId);
  if (!state.ok) return state.response;

  const validation = validateWithdrawal({
    owner: from,
    destination: to,
    amountLamports: body?.amountLamports,
    balanceLamports: state.balance,
    lockedLamports: state.locked,
    pendingWithdrawalLamports: state.pending
  });
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: validation.message,
        code: validation.code,
        lockedLamports: validation.lockedLamports?.toString(),
        spendableLamports: spendableLamports({
          balanceLamports: state.balance,
          lockedLamports: state.locked,
          pendingWithdrawalLamports: state.pending
        }).toString()
      },
      { status: 400 }
    );
  }

  // Durable intent BEFORE a transaction is built. A retried fetch, a second tab, or a
  // duplicated request collides on the server-derived idempotency key and is told about the
  // withdrawal already in flight instead of being handed a second one to sign. The server is
  // non-custodial and cannot broadcast anything itself, so refusing to BUILD is the only
  // duplicate protection it can offer — and until now it offered none: the idempotency key
  // was generated and discarded.
  const intent = await callPrivyRpc<{
    id: string; idempotencyKey: string; replay: boolean; state: string; txSignature: string | null;
  }>("app_user_open_withdrawal_intent", {
    p_privy_user_id: user.privyUserId,
    p_wallet_address: from,
    p_destination_address: to,
    p_amount_lamports: validation.amountLamports.toString()
  });
  if (!intent.ok) {
    return NextResponse.json(
      { error: "Withdrawal is temporarily unavailable. Try again in a moment.", retryable: true },
      { status: 503 }
    );
  }
  if (intent.data.replay) {
    return NextResponse.json(
      {
        error: intent.data.txSignature
          ? "This withdrawal has already been sent and is confirming."
          : "This withdrawal is already in progress.",
        code: "WITHDRAWAL_IN_PROGRESS",
        withdrawalId: intent.data.id,
        state: intent.data.state,
        txSignature: intent.data.txSignature
      },
      { status: 409 }
    );
  }

  try {
    const web3 = await import("@solana/web3.js");
    const connection = new web3.Connection(
      process.env.SOLANA_RPC_URL || process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com"
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const transaction = new web3.Transaction({
      feePayer: new web3.PublicKey(from),
      recentBlockhash: blockhash
    }).add(
      web3.SystemProgram.transfer({
        fromPubkey: new web3.PublicKey(from),
        toPubkey: new web3.PublicKey(to),
        lamports: validation.amountLamports
      })
    );

    return NextResponse.json({
      // Unsigned. The user signs this with their own wallet; the server holds no keys.
      transaction: transaction.serialize({ requireAllSignatures: false }).toString("base64"),
      amountLamports: validation.amountLamports.toString(),
      destination: to,
      lastValidBlockHeight,
      withdrawalId: intent.data.id,
      idempotencyKey: intent.data.idempotencyKey
    });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e), retryable: true }, { status: 502 });
  }
}
