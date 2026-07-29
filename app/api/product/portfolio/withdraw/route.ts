import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";
import { sanitizeError } from "@/lib/server/guard";
import {
  REQUIRED_RESERVE_LAMPORTS,
  isSolanaAddress,
  spendableLamports,
  validateWithdrawal,
  withdrawalIdempotencyKey
} from "@/lib/withdrawal";

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

const SOL_RPC_FALLBACK = "https://solana-rpc.publicnode.com";

async function walletBalanceLamports(address: string): Promise<bigint | null> {
  const rpc = process.env.SOLANA_RPC_URL || SOL_RPC_FALLBACK;
  try {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] })
    });
    if (!response.ok) return null;
    const data = await response.json();
    const value = data?.result?.value;
    if (value == null || !Number.isFinite(Number(value))) return null;
    return BigInt(Math.floor(Number(value)));
  } catch {
    return null;
  }
}

/** Authoritative locked capital. Never trust a client-supplied figure (§12.5). */
async function lockedLamports(privyUserId: string): Promise<{ ok: true; locked: bigint } | { ok: false }> {
  const result = await callPrivyRpc<{ lockedLamports?: string; inFlightIntents?: number }>(
    "app_user_withdrawable_state",
    { p_privy_user_id: privyUserId }
  );
  if (!result.ok) return { ok: false };
  try {
    return { ok: true, locked: BigInt(String(result.data?.lockedLamports ?? "0")) };
  } catch {
    return { ok: false };
  }
}

async function resolveState(req: NextRequest, address: string, privyUserId: string) {
  const [balance, locked] = await Promise.all([
    walletBalanceLamports(address),
    lockedLamports(privyUserId)
  ]);

  // Fail closed on an unverifiable financial state, but as a TEMPORARY operational
  // error with retry — never as a permission or feature-disabled message (§12.4).
  if (balance == null || !locked.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Balance is temporarily unavailable. Try again in a moment.", retryable: true },
        { status: 503 }
      )
    };
  }
  return { ok: true as const, balance, locked: locked.locked };
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

  const spendable = spendableLamports({ balanceLamports: state.balance, lockedLamports: state.locked });
  return NextResponse.json(
    {
      balanceLamports: state.balance.toString(),
      lockedLamports: state.locked.toString(),
      spendableLamports: spendable.toString(),
      reserveLamports: REQUIRED_RESERVE_LAMPORTS.toString()
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 10, windowSeconds: 60 });
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
    lockedLamports: state.locked
  });
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: validation.message,
        code: validation.code,
        lockedLamports: validation.lockedLamports?.toString(),
        spendableLamports: spendableLamports({
          balanceLamports: state.balance,
          lockedLamports: state.locked
        }).toString()
      },
      { status: 400 }
    );
  }

  try {
    const web3 = await import("@solana/web3.js");
    const connection = new web3.Connection(process.env.SOLANA_RPC_URL || SOL_RPC_FALLBACK);
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
      idempotencyKey: withdrawalIdempotencyKey({
        owner: from,
        destination: to,
        amountLamports: validation.amountLamports.toString(),
        requestId: body?.requestId
      })
    });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e), retryable: true }, { status: 502 });
  }
}
