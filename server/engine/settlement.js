/**
 * Buy settlement — resolves submitted swaps against the chain and opens positions.
 *
 * This is the producer the take-profit / stop-loss monitor never had. Until it existed,
 * `startMonitor` took its positions as a parameter with nothing anywhere to supply them, so
 * a user's configured stop-loss could never fire on anything the worker bought.
 *
 * It also closes the "submission is settlement" gap on the BUY side. `calls.js` now records
 * a signature and stops; this module decides whether that signature actually landed. Only a
 * confirmed transaction produces a position and a ledger row.
 *
 * The position's size comes from the transaction's own token balance delta, not from the
 * quote. A quote's `outAmount` is an estimate that the realised fill misses by up to the
 * slippage tolerance, and a position sized from an estimate produces sells the wallet
 * cannot cover.
 */
const POLL_MS = 15_000;

/**
 * Pure: what to do with one submitted execution given its confirmation verdict.
 *
 * `pending` returns null — the row stays submitted and is retried on a later tick. It must
 * not be settled either way, which is the same invariant the exit path holds.
 */
function decideSettlement({ verdict }) {
  if (verdict === "confirmed") return { status: "succeeded", openPosition: true };
  if (verdict === "failed" || verdict === "expired") {
    return { status: "failed", openPosition: false, error: `buy ${verdict} on chain` };
  }
  return null;
}

/**
 * Pure: the position to open from a confirmed buy, or null when it cannot be sized.
 *
 * Returning null rather than a zero/estimated position is deliberate. A position recorded
 * with a size the wallet does not hold generates sells that always fail, and one recorded
 * without an entry price makes every trigger comparison meaningless.
 */
function buildPosition({ execution, receivedRaw, entryPriceUsd }) {
  const amount = BigInt(receivedRaw ?? 0);
  if (amount <= BigInt(0)) return null;
  if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) return null;
  return {
    userId: execution.user_id || null,
    privyUserId: execution.privy_user_id || null,
    userPubkey: execution.user_pubkey,
    walletId: execution.wallet_id || null,
    groupId: execution.group_id || null,
    mint: execution.mint,
    entryPriceUsd,
    amountRaw: amount.toString(),
    entrySig: execution.tx_signature,
    slippageBps: execution.slippage_bps ?? 300,
    tp1: execution.tp1 ?? null,
    tp1Sell: execution.tp1_sell ?? 0,
    tp2: execution.tp2 ?? null,
    tp2Sell: execution.tp2_sell ?? 0,
    stopLoss: execution.stop_loss ?? null,
    // The configuration snapshot stamped on THIS execution, not the subscription's current
    // one. It is what binds the position's take-profit levels, trailing and stop for its
    // whole life, so editing the bot afterwards cannot change how an open position exits.
    // The flat columns above stay as the fallback for an execution stamped before the
    // versioning migration.
    entryConfig: execution.subscriber_config_snapshot || {}
  };
}

/**
 * deps:
 *   loadSubmitted()                                  -> submitted executions
 *   confirmSignature(sig, { submittedAtMs })         -> { verdict }
 *   fetchReceivedAmount(sig, owner, mint)            -> raw tokens received
 *   getPrice(mint)                                   -> current USD price
 *   openPosition(position)                           -> idempotent on entry signature
 *   settleExecution(execution, status, error)   dispatches on execution.source
 *   recordTrade(evt)
 */
function startSettlementWatcher(deps, pollMs = POLL_MS) {
  const {
    loadSubmitted, confirmSignature, fetchReceivedAmount, getPrice,
    openPosition, settleExecution, recordTrade = async () => {}, onEvent = () => {}
  } = deps;

  const settleOne = async (execution) => {
    const sig = execution.tx_signature;
    let verdict;
    try {
      const res = await confirmSignature(sig, { submittedAtMs: execution.submitted_at ? Date.parse(execution.submitted_at) : null });
      verdict = res.verdict;
    } catch (e) {
      // An RPC failure is not evidence of anything. Leave the row submitted.
      onEvent({ type: "CONFIRM_ERROR", sig, error: e.message });
      return;
    }
    const decision = decideSettlement({ verdict });
    if (!decision) return; // still pending

    if (!decision.openPosition) {
      try {
        await settleExecution(execution, "failed", decision.error);
        onEvent({ type: "BUY_FAILED", sig, mint: execution.mint, verdict });
      } catch (e) {
        onEvent({ type: "SETTLE_ERROR", sig, error: e.message });
      }
      return;
    }

    // Confirmed. Size the position from what actually arrived.
    let receivedRaw = null;
    let entryPriceUsd = null;
    try {
      receivedRaw = await fetchReceivedAmount(sig, execution.user_pubkey, execution.mint);
      // Entry price is read from the SAME source the monitor compares against. Deriving it
      // from the swap quote instead would mix price sources, and a systematic 2% gap
      // between them is enough to fire a stop-loss the instant a position opens.
      entryPriceUsd = await getPrice(execution.mint);
    } catch (e) {
      onEvent({ type: "SIZING_ERROR", sig, mint: execution.mint, error: e.message });
      return; // stay submitted and retry; the trade did land, so do not settle it away
    }

    const position = buildPosition({ execution, receivedRaw, entryPriceUsd: Number(entryPriceUsd) });
    if (!position) {
      // The buy confirmed but cannot be turned into a monitorable position. Settling it
      // `succeeded` would leave an untracked holding with no stop-loss, so say so loudly.
      onEvent({ type: "POSITION_UNSIZABLE", sig, mint: execution.mint, receivedRaw: String(receivedRaw), entryPriceUsd });
      return;
    }

    try {
      // Opened BEFORE the execution is settled. If the process dies between the two, the
      // row stays `submitted` and is retried, and `worker_open_position` is idempotent on
      // the entry signature — so the retry cannot open a second position. The reverse order
      // would leave a confirmed buy with no position and nothing to retry it.
      const opened = await openPosition(position);
      if (!opened?.ok) throw new Error(opened?.error || "could not open position");
      await settleExecution(execution, "succeeded", null);
    } catch (e) {
      onEvent({ type: "SETTLE_ERROR", sig, mint: execution.mint, error: e.message });
      return;
    }

    try {
      await recordTrade({
        privy_user_id: execution.privy_user_id, user_pubkey: execution.user_pubkey,
        group_id: execution.group_id, mint: execution.mint, side: "buy",
        size: execution.amount_sol, sig, kind: execution.source === "copy" ? "copy" : "call"
      });
    } catch (e) {
      onEvent({ type: "RECORD_ERROR", sig, error: e.message });
    }
    onEvent({ type: "BUY_CONFIRMED", sig, mint: execution.mint, user: execution.user_pubkey, amountRaw: position.amountRaw });
  };

  const runTick = async () => {
    let rows = [];
    try { rows = await loadSubmitted(); }
    catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); return; }
    for (const execution of rows || []) {
      try { await settleOne(execution); }
      catch (e) { onEvent({ type: "ERROR", sig: execution?.tx_signature, error: e.message }); }
    }
  };

  // A pollMs of 0 means "give me one pass and do not schedule anything".
  //
  // The worker calls this with a real interval and keeps its self-rescheduling loop, unchanged.
  // A serverless invocation cannot own a setTimeout that outlives its response — it would be
  // torn down mid-flight, or resume on a warm container with stale closure state — so it drives
  // the same runTick itself, once per iteration, from `app/api/worker/tick`.
  //
  // Returning runTick rather than exporting it separately keeps the dependency wiring in one
  // place. A second construction path could be handed different deps, and the two would drift
  // exactly the way a reader and a writer drift when nothing checks them against each other.
  if (!pollMs) return runTick;

  const tick = async () => {
    try { await runTick(); }
    catch (e) { onEvent({ type: "TICK_ERROR", error: e.message }); }
    finally { setTimeout(tick, pollMs); }
  };
  tick();
}

module.exports = { startSettlementWatcher, decideSettlement, buildPosition };
