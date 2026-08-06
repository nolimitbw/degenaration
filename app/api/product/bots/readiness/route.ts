import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";
import { validateBotPayload } from "@/lib/server/bot-validation";
import { feeAccountReadiness } from "@/lib/server/fee-account";
import { AUTOMATED_MAINNET_RELEASE } from "@/lib/trading-release";
import { plannedCapital } from "@/lib/planned-capital";
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

  const [state, liveness] = await Promise.all([
    callPrivyRpc<{ spendableLamports?: string }>("app_user_withdrawable_state", {
      p_privy_user_id: user.privyUserId
    }),
    callPrivyRpc<{ live?: boolean; reason?: string | null; executionMode?: string | null }>(
      "app_worker_liveness",
      {}
    )
  ]);

  const fee = await feeAccountReadiness();

  const verdict = evaluateReadiness({
    authenticated: true,
    configurationValid,
    configurationError: configurationValid ? null : (parsed as { error: string }).error,
    walletOwned,
    // The builder only offers delegation as a precondition of having a wallet at all; the
    // authoritative refusal is the worker's, which cannot sign for an undelegated wallet.
    walletDelegated: walletOwned,
    // Undefined rather than true when unknown: `sourceApproved !== false` passes on undefined
    // for a KOL bot, which genuinely has no Discord source, and the claim re-checks the
    // registered channel on every call regardless.
    sourceApproved: value?.kind === "discord"
      ? Boolean((raw as Record<string, unknown> | null)?.sourceId)
      : undefined,
    channelRegistered: undefined,
    duplicateActiveBot: undefined,
    requiredLamports,
    availableLamports: state.ok ? state.data?.spendableLamports : undefined,
    killSwitch: config.killSwitch === true,
    platformEntriesPaused: false,
    // Fail closed on an unreadable liveness answer: `live` stays undefined and the check fails.
    workerLive: liveness.ok ? liveness.data?.live === true : undefined,
    workerReason: liveness.ok ? liveness.data?.reason ?? null : "the execution service stopped reporting",
    signerConfigured: liveness.ok ? liveness.data?.live === true : undefined,
    feeAccountReady: fee.ready === true,
    mainnetReleased: AUTOMATED_MAINNET_RELEASE.enabled
  });

  return NextResponse.json(verdict, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
