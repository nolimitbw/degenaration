import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";
import { validateBotPayload } from "@/lib/server/bot-validation";
import { feeAccountReadiness } from "@/lib/server/fee-account";
import { automationReadiness } from "@/lib/server/automation-readiness";
import { plannedCapital } from "@/lib/planned-capital";
import { spendableLamports } from "@/lib/withdrawal";
// Plain CommonJS modules so the same table is testable in the synchronous server runner.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { evaluateReadiness } = require("@/lib/bot-readiness");

const SOL_RPC_FALLBACK = "https://solana-rpc.publicnode.com";

async function walletBalanceLamports(address: string): Promise<bigint | null> {
  const rpc = process.env.SOLANA_RPC_URL || process.env.MAINNET_RPC || SOL_RPC_FALLBACK;
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
    if (value == null || !Number.isSafeInteger(Number(value))) return null;
    return BigInt(Number(value));
  } catch {
    return null;
  }
}

/**
 * The server-side readiness transaction behind `RUN`.
 *
 * This route ONLY reads. It gathers facts and returns a verdict; activation is a separate POST
 * to /api/product/bots, which re-derives the same verdict rather than trusting this one. A
 * readiness answer is a snapshot, and a client that could carry it to the activation call as
 * proof would be carrying a fact that may have expired between the two requests.
 */
export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const raw = await req.json().catch(() => null);
  const parsed = validateBotPayload(raw);
  const configurationValid = !("error" in parsed);
  const value = configurationValid ? parsed.value : null;

  // Wallet ownership, proven against the signed identity token rather than taken from the body.
  let walletOwned = false;
  if (configurationValid && parsed.walletAddress) {
    const ownership = await requirePrivyWallet(req, user.privyUserId, parsed.walletAddress, parsed.walletId);
    walletOwned = ownership.ok;
  }

  const config = (value?.config || {}) as Record<string, any>;

  // Capital. The same integer formula the builder shows the user, so the number in the reason
  // and the number on the screen cannot disagree — they are one function.
  let requiredLamports: string | undefined;
  try {
    requiredLamports = plannedCapital({
      entryLamports: config.buyAmountLamports,
      dca: config.dca,
      // A switched-off maximum is not a maximum of zero; with the limit off the bot is not
      // bounded by a trade count, so the floor of one position is the honest requirement.
      maxOpenTrades: config.limits?.maxOpenTrades === false ? 1 : config.maxOpenTrades
    }).plannedLamports.toString();
  } catch {
    requiredLamports = undefined;
  }

  const sourceGroupId = typeof (raw as any)?.sourceGroupId === "string" ? (raw as any).sourceGroupId : null;
  const botId = typeof (raw as any)?.id === "string" ? (raw as any).id : null;
  const [state, balance, liveness, runFacts] = await Promise.all([
    callPrivyRpc<{
      spendableLamports?: string;
      lockedLamports?: string;
      pendingWithdrawalLamports?: string;
    }>("app_user_withdrawable_state", {
      p_privy_user_id: user.privyUserId
    }),
    walletOwned && parsed.walletAddress ? walletBalanceLamports(parsed.walletAddress) : Promise.resolve(null),
    callPrivyRpc<{ live?: boolean; reason?: string | null; executionMode?: string | null }>(
      "app_worker_liveness",
      {}
    ),
    value?.kind === "discord" && configurationValid
      ? callPrivyRpc<{
          sourceApproved?: boolean;
          channelRegistered?: boolean;
          duplicateActiveBot?: boolean;
          dailyBudgetAvailable?: boolean;
        }>("app_user_bot_run_facts", {
          p_privy_user_id: user.privyUserId,
          p_bot_id: botId,
          p_source_group_id: sourceGroupId,
          p_channel_id: config.channelId || null,
          p_buy_lamports: config.buyAmountLamports,
          p_daily_cap_lamports: config.dailyLossLimitLamports
        })
      : Promise.resolve({
          ok: true as const,
          data: {} as {
            sourceApproved?: boolean;
            channelRegistered?: boolean;
            duplicateActiveBot?: boolean;
            dailyBudgetAvailable?: boolean;
          }
        })
  ]);

  const [fee, release] = await Promise.all([feeAccountReadiness(), automationReadiness()]);

  let availableLamports: string | undefined;
  if (state.ok && typeof state.data?.spendableLamports === "string") {
    availableLamports = state.data.spendableLamports;
  } else if (state.ok && balance != null) {
    try {
      availableLamports = spendableLamports({
        balanceLamports: balance,
        lockedLamports: BigInt(String(state.data?.lockedLamports ?? "0")),
        pendingWithdrawalLamports: BigInt(String(state.data?.pendingWithdrawalLamports ?? "0"))
      }).toString();
    } catch {
      availableLamports = undefined;
    }
  }

  const verdict = evaluateReadiness({
    authenticated: true,
    configurationValid,
    configurationError: configurationValid ? null : (parsed as { error: string }).error,
    walletOwned,
    // The builder only offers delegation as a precondition of having a wallet at all; the
    // authoritative refusal is the worker's, which cannot sign for an undelegated wallet.
    walletDelegated: walletOwned,
    botKind: value?.kind,
    // Discord facts come from one service-only database snapshot. Unknown is deliberately
    // preserved so the pure readiness table fails closed; KOL marks them not applicable.
    sourceApproved: value?.kind === "discord" && runFacts.ok ? runFacts.data?.sourceApproved : undefined,
    channelRegistered: value?.kind === "discord" && runFacts.ok ? runFacts.data?.channelRegistered : undefined,
    duplicateActiveBot: value?.kind === "discord"
      ? (runFacts.ok ? runFacts.data?.duplicateActiveBot : undefined)
      : false,
    dailyBudgetAvailable: value?.kind === "discord" && runFacts.ok
      ? runFacts.data?.dailyBudgetAvailable
      : true,
    requiredLamports,
    availableLamports,
    killSwitch: config.killSwitch === true,
    platformEntriesPaused: false,
    // Fail closed on an unreadable liveness answer: `live` stays undefined and the check fails.
    workerLive: liveness.ok ? liveness.data?.live === true : undefined,
    workerReason: liveness.ok ? liveness.data?.reason ?? null : "the execution service stopped reporting",
    signerConfigured: release.checks.find((check) => check.id === "signer")?.ok === true,
    feeAccountReady: fee.ready === true,
    mainnetReleased: release.active
  });

  return NextResponse.json(verdict, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
