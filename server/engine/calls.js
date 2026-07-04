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
 *  markCallExecuted(id)
 *  signAndSend(tx, walletId) -> signature
 *  recordCopy(evt) / onEvent(evt)
 */
function startCallWatcher(deps, pollMs = 8000) {
  const { loadPendingCalls, loadGroupSubscribers, markCallExecuted, signAndSend, recordCopy = () => {}, onEvent = () => {} } = deps;
  const seen = new Set();

  const tick = async () => {
    let calls = [];
    try { calls = await loadPendingCalls(); } catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); }

    for (const c of pickNewCalls(calls, seen)) {
      seen.add(c.id);

      // safety gate before mirroring anyone in
      let check; try { check = await rugCheck(c.mint); } catch { check = { ok: false, reasons: ["check failed"] }; }
      if (!check.ok) {
        onEvent({ type: "SKIP", mint: c.mint, reasons: check.reasons });
        try { await markCallExecuted(c.id); } catch { /* retry next run */ }
        continue;
      }

      let subs = [];
      try { subs = await loadGroupSubscribers(c.group_id); } catch { subs = []; }
      for (const s of subs) {
        if (!s.wallet_id) { onEvent({ type: "NO_WALLET", user: s.user_pubkey }); continue; }
        if ((s.daily_spent || 0) + s.size_sol > s.daily_cap_sol) { onEvent({ type: "CAP", user: s.user_pubkey }); continue; }
        try {
          const { tx } = await buyToken(c.mint, s.size_sol, s.user_pubkey, s.slippage_bps || 300);
          const sig = await signAndSend(tx, s.wallet_id); // walletId signs the tx built for user_pubkey
          await recordCopy({ mint: c.mint, user: s.user_pubkey, size: s.size_sol, sig });
          onEvent({ type: "CALL_BUY", group: c.group_id, mint: c.mint, user: s.user_pubkey, sig });
        } catch (e) {
          onEvent({ type: "EXEC_ERROR", user: s.user_pubkey, mint: c.mint, error: e.message });
        }
      }
      try { await markCallExecuted(c.id); } catch { /* retry next run */ }
    }
    setTimeout(tick, pollMs);
  };
  tick();
}

module.exports = { pickNewCalls, startCallWatcher };
