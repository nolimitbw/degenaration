/**
 * Discord call execution (server side).
 *
 * Every call recorded from an approved channel is mirrored to that GROUP's subscribers
 * as fast as it lands, respecting each subscriber's size, exits, filters and daily cap.
 * Non-custodial: subscribers' DELEGATED keys sign via signAndSend.
 *
 * There is deliberately NO platform token-safety gate here. Whether a call is worth
 * taking is the calling server's judgement and the subscriber's own filters (min
 * liquidity, max mcap, cooldown, position caps) — all enforced atomically inside
 * claimCallExecution. The platform's job on this path is to execute what the subscriber
 * asked for, immediately.
 *
 * Two paths feed this module and they are safe to run together:
 *   - call-stream.js   — Supabase Realtime, fires the moment the row is inserted.
 *   - startCallWatcher — a poll, the backstop for anything Realtime dropped.
 * claimCallExecution is unique per (call, subscription), so a call seen twice is
 * executed once.
 */
const { buyToken: jupiterBuyToken, SOL_MINT } = require("./jupiter");

// Pure, testable: calls that are executable and not yet handled this run.
// A call is executable if it has a mint + group and has not been executed.
function pickNewCalls(calls, seen) {
  return (calls || []).filter((c) => c && c.id && c.mint && c.group_id && !c.executed_at && !seen.has(c.id));
}


/**
 * Turn a confirmed entry into a durable position.
 *
 * The amount sold at exit must be what the wallet actually received, so it comes from
 * the CONFIRMED transaction rather than the quote — slippage means those differ, and
 * quoting a sell for tokens that are not there fails on-chain.
 *
 * The cost basis is likewise the real one: SOL actually spent, priced in USD, over
 * tokens actually received. That is what the subscriber's 2x is measured against, not
 * the price the Discord message happened to be posted at.
 */
async function openPositionForFill({ call, claim, sig, deps }) {
  const { verifyFill, getPrice, openPosition } = deps;
  if (!openPosition) return { ok: false, error: "position store unavailable" };

  const fill = verifyFill ? await verifyFill({ signature: sig, userPubkey: claim.user_pubkey, mint: call.mint, side: "buy" }) : null;
  if (!fill?.ok || !fill.tokenAmountRaw || !(fill.tokenAmount > 0)) {
    return { ok: false, error: fill?.error || "entry fill could not be confirmed" };
  }

  let entryPriceUsd = null;
  try {
    const solPrice = getPrice ? await getPrice(SOL_MINT) : null;
    if (solPrice > 0 && claim.size_sol > 0) entryPriceUsd = (claim.size_sol * solPrice) / fill.tokenAmount;
  } catch { /* fall through to the call's recorded price */ }
  if (!(entryPriceUsd > 0)) entryPriceUsd = Number(call.called_price_usd) > 0 ? Number(call.called_price_usd) : null;
  if (!(entryPriceUsd > 0)) return { ok: false, error: "no entry price to measure exits against" };

  const result = await openPosition(call.id, claim.subscription_id, call.mint, entryPriceUsd, fill.tokenAmountRaw, sig);
  if (!result?.ok) return { ok: false, error: result?.error || "could not open position" };
  return { ok: true, id: result.id };
}

/**
 * Mirror one call to every subscriber of its group. Returns true when the call is fully
 * settled and can be forgotten; false when executions are still pending and it should be
 * retried on a later tick.
 *
 * deps:
 *  loadGroupSubscribers(groupId) -> [{ id, user_pubkey, wallet_id, size_sol, ... }]
 *  claimCallExecution(callId, subscriptionId) / finishCallExecution(...)
 *  completeCall(callId)
 *  signAndSend(tx, walletId) -> signature
 *  recordCopy(evt) / onEvent(evt)
 */
async function executeCall(call, deps) {
  const { loadGroupSubscribers, claimCallExecution, finishCallExecution, completeCall, signAndSend, recordCopy = async () => {}, onEvent = () => {}, buyToken = jupiterBuyToken } = deps;

  let subs = [];
  try { subs = await loadGroupSubscribers(call.group_id); }
  catch (e) { onEvent({ type: "SUBSCRIBER_LOAD_ERROR", call: call.id, error: e.message }); }

  for (const s of subs) {
    let claim;
    try { claim = await claimCallExecution(call.id, s.id); }
    catch (e) { onEvent({ type: "CLAIM_ERROR", call: call.id, subscription: s.id, error: e.message }); continue; }
    if (!claim?.ok || !claim?.claim_token) {
      onEvent({ type: "CLAIM_SKIPPED", call: call.id, subscription: s.id, error: claim?.error || "execution unavailable" });
      continue;
    }
    let sig = null;
    try {
      const { tx } = await buyToken(call.mint, claim.size_sol, claim.user_pubkey, claim.slippage_bps || 300);
      sig = await signAndSend(tx, claim.wallet_id); // walletId signs the tx built for user_pubkey
      const finished = await finishCallExecution(call.id, s.id, claim.claim_token, "succeeded", sig, null);
      if (!finished?.ok) throw new Error(finished?.error || "could not persist call execution");
      try {
        await recordCopy({ mint: call.mint, user: claim.user_pubkey, privy_user_id: claim.privy_user_id, group_id: call.group_id, size: claim.size_sol, sig, kind: "call" });
      } catch (e) {
        onEvent({ type: "RECORD_ERROR", call: call.id, subscription: s.id, sig, error: e.message });
      }
      onEvent({ type: "CALL_BUY", group: call.group_id, mint: call.mint, user: claim.user_pubkey, sig });

      // Open the position so the exit engine can honour this subscriber's TP/SL. A buy
      // that never becomes a position is a trade with no way out, so a failure here is
      // loud rather than swallowed.
      try {
        const opened = await openPositionForFill({ call, claim, sig, deps });
        if (!opened.ok) onEvent({ type: "POSITION_OPEN_FAILED", call: call.id, subscription: s.id, sig, error: opened.error });
        else onEvent({ type: "POSITION_OPEN", call: call.id, position: opened.id, mint: call.mint });
      } catch (e) {
        onEvent({ type: "POSITION_OPEN_FAILED", call: call.id, subscription: s.id, sig, error: e.message });
      }
    } catch (e) {
      if (!sig) {
        try { await finishCallExecution(call.id, s.id, claim.claim_token, "failed", null, e.message); }
        catch (finishError) { onEvent({ type: "FINISH_ERROR", call: call.id, subscription: s.id, error: finishError.message }); }
      }
      onEvent({ type: sig ? "PERSIST_ERROR" : "EXEC_ERROR", subscription: s.id, mint: call.mint, sig, error: e.message });
    }
  }

  try {
    const completed = await completeCall(call.id);
    if (completed?.ok) return true;
    onEvent({ type: "CALL_PENDING", call: call.id, error: completed?.error || "executions pending" });
  } catch (e) {
    onEvent({ type: "COMPLETE_ERROR", call: call.id, error: e.message });
  }
  return false;
}

/**
 * Polling backstop. Realtime is the primary trigger; this catches calls that arrived
 * while the stream was reconnecting.
 *
 * Extra deps: loadPendingCalls() -> [{ id, group_id, mint, symbol, executed_at }]
 * Pass a shared `seen` Set so the stream and the poll do not re-walk each other's work.
 */
function startCallWatcher(deps, pollMs = 8000) {
  const { loadPendingCalls, onEvent = () => {} } = deps;
  const seen = deps.seen || new Set();

  const runTick = async () => {
    let calls = [];
    try { calls = await loadPendingCalls(); } catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); }

    for (const call of pickNewCalls(calls, seen)) {
      if (await executeCall(call, deps)) seen.add(call.id);
    }
  };
  const tick = async () => {
    try { await runTick(); }
    catch (e) { onEvent({ type: "TICK_ERROR", error: e.message }); }
    finally { setTimeout(tick, pollMs); }
  };
  tick();
}

module.exports = { pickNewCalls, openPositionForFill, executeCall, startCallWatcher };
