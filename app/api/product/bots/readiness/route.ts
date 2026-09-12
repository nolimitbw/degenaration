import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";
import { validateBotPayload } from "@/lib/server/bot-validation";
import { feeAccountReadiness } from "@/lib/server/fee-account";
import { automationReadiness } from "@/lib/server/automation-readiness";
import { plannedCapital } from "@/lib/planned-capital";
import { spendableFor } from "@/lib/server/wallet-balance";
// Plain CommonJS modules so the same table is testable in the synchronous server runner.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { evaluateReadiness } = require("@/lib/bot-readiness");

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
  let walletDelegated = false;
  if (configurationValid && parsed.walletAddress) {
    const ownership = await requirePrivyWallet(req, user.privyUserId, parsed.walletAddress, parsed.walletId);
    walletOwned = ownership.ok;
    walletDelegated = ownership.ok && ownership.delegated;
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
  const [state, liveness, runFacts] = await Promise.all([
    // The real shape. It returns HOLDS, not a balance — see lib/server/wallet-balance.ts.
    callPrivyRpc<{ lockedLamports?: string; pendingWithdrawalLamports?: string }>("app_user_withdrawable_state", {
      p_privy_user_id: user.privyUserId
    }),
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

  /**
   * Spendable balance.
   *
   * This used to read `state.data?.spendableLamports` — a key `app_user_withdrawable_state`
   * has never returned and cannot: it is a Postgres function, and the balance is on Solana.
   * It returns the HOLDS (locked, pending) only. So the value was always undefined, the
   * capital check always answered "Your available balance could not be read", and RUN was
   * blocked for every user at every balance — while the builder displayed a real wallet
   * balance on the same screen, because the builder reads the chain.
   *
   * Spendable is now derived the same way the withdraw screen derives it, through one shared
   * reader, so the two money surfaces cannot drift apart again. Still undefined when the
   * chain genuinely cannot be read, which is the one case the message was written for.
   */
  const [fee, release, availableLamports, stored] = await Promise.all([
    feeAccountReadiness(),
    automationReadiness(),
    parsed && "walletAddress" in parsed && parsed.walletAddress
      ? spendableFor(parsed.walletAddress, state)
      : Promise.resolve(undefined),
    // The STORED lifecycle state, which the submitted payload cannot report: it carries the
    // status the user is trying to reach, not the one the row is in. Only fetched when
    // editing an existing bot; a new bot has no stored state to conflict with.
    botId
      ? callPrivyRpc<{ bot?: { status?: string } | null; status?: string }>("app_user_get_bot", {
          p_privy_user_id: user.privyUserId,
          p_bot_id: botId
        })
      : Promise.resolve({ ok: true as const, data: null })
  ]);

  // Unreadable stays undefined rather than defaulting to a state — the check only fails on a
  // bot known to be archived, so an unavailable read cannot invent a blocker.
  const storedStatus = stored.ok
    ? (stored.data?.bot?.status ?? stored.data?.status ?? undefined)
    : undefined;

  const verdict = evaluateReadiness({
    authenticated: true,
    configurationValid,
    configurationError: configurationValid ? null : (parsed as { error: string }).error,
    walletOwned,
    // From Privy's signed identity token. Ownership is not delegation: conflating them let an
    // undelegated bot activate and consume calls before the signer inevitably refused it.
    walletDelegated,
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
    storedStatus,
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
