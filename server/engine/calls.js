/**
 * Discord call watcher (server side). Polls the `calls` table for new, un-executed calls
 * that came from an approved channel and mirrors each one to that GROUP's subscribers,
 * respecting each subscriber's size and daily cap. Non-custodial: subscribers' DELEGATED
 * keys sign via signAndSend. Analogous to copy.js but keyed on group calls, not wallets.
 */
const { rugCheck } = require("./rugcheck");
const { buyToken } = require("./jupiter");

// Pure, testable: calls that are executable and not yet handled this run.
// A call is executable if it has a mint + group and has not been executed.
function pickNewCalls(calls, seen) {
  return (calls || []).filter((c) => c && c.id && c.mint && c.group_id && !c.executed_at && !seen.has(c.id));
}

/**
 * deps:
 *  loadPendingCalls() -> [{ id, group_id, mint, symbol, executed_at }]
 *  loadGroupSubscribers(groupId) -> [{ user_pubkey, wallet_id, size_sol, slippage_bps, daily_cap_sol, daily_spent }]
 *  claimCallExecution(callId, subscriptionId) / finishCallExecution(...)
 *  completeCall(callId) / markCallExecuted(id)
 *  signAndSend(tx, walletId) -> signature
 *  recordCopy(evt) / onEvent(evt)
 */
function startCallWatcher(deps, pollMs = 8000) {
  const { loadPendingCalls, loadGroupSubscribers, claimCallExecution, finishCallExecution, completeCall, markCallExecuted, signAndSend, recordCopy = async () => {}, onEvent = () => {} } = deps;
  const seen = new Set();

  const runTick = async () => {
    let calls = [];
    try { calls = await loadPendingCalls(); } catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); }

    for (const c of pickNewCalls(calls, seen)) {
      // safety gate before mirroring anyone in
      let check; try { check = await rugCheck(c.mint); } catch { check = { ok: false, reasons: ["check failed"] }; }
      if (!check.ok) {
        onEvent({ type: "SKIP", mint: c.mint, reasons: check.reasons });
        try { await markCallExecuted(c.id); seen.add(c.id); } catch { /* retry next tick */ }
        continue;
      }

      let subs = [];
      try { subs = await loadGroupSubscribers(c.group_id); }
      catch (e) { onEvent({ type: "SUBSCRIBER_LOAD_ERROR", call: c.id, error: e.message }); }
      for (const s of subs) {
        let claim;
        try { claim = await claimCallExecution(c.id, s.id); }
        catch (e) { onEvent({ type: "CLAIM_ERROR", call: c.id, subscription: s.id, error: e.message }); continue; }
        if (!claim?.ok || !claim?.claim_token) {
          onEvent({ type: "CLAIM_SKIPPED", call: c.id, subscription: s.id, error: claim?.error || "execution unavailable" });
          continue;
        }
        let sig = null;
        try {
          const { tx } = await buyToken(c.mint, claim.size_sol, claim.user_pubkey, claim.slippage_bps || 300);
          sig = await signAndSend(tx, claim.wallet_id); // walletId signs the tx built for user_pubkey
          const finished = await finishCallExecution(c.id, s.id, claim.claim_token, "succeeded", sig, null);
          if (!finished?.ok) throw new Error(finished?.error || "could not persist call execution");
          try {
            await recordCopy({ mint: c.mint, user: claim.user_pubkey, privy_user_id: claim.privy_user_id, group_id: c.group_id, size: claim.size_sol, sig, kind: "call" });
          } catch (e) {
            onEvent({ type: "RECORD_ERROR", call: c.id, subscription: s.id, sig, error: e.message });
          }
          onEvent({ type: "CALL_BUY", group: c.group_id, mint: c.mint, user: claim.user_pubkey, sig });
        } catch (e) {
          if (!sig) {
            try { await finishCallExecution(c.id, s.id, claim.claim_token, "failed", null, e.message); }
            catch (finishError) { onEvent({ type: "FINISH_ERROR", call: c.id, subscription: s.id, error: finishError.message }); }
          }
          onEvent({ type: sig ? "PERSIST_ERROR" : "EXEC_ERROR", subscription: s.id, mint: c.mint, sig, error: e.message });
        }
      }
      try {
        const completed = await completeCall(c.id);
        if (completed?.ok) seen.add(c.id);
        else onEvent({ type: "CALL_PENDING", call: c.id, error: completed?.error || "executions pending" });
      } catch (e) {
        onEvent({ type: "COMPLETE_ERROR", call: c.id, error: e.message });
      }
    }
  };
  const tick = async () => {
    try { await runTick(); }
    catch (e) { onEvent({ type: "TICK_ERROR", error: e.message }); }
    finally { setTimeout(tick, pollMs); }
  };
  tick();
}

module.exports = { pickNewCalls, startCallWatcher };
