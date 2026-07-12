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
  const { loadPendingCalls, loadGroupSubscribers, markCallExecuted, signAndSend, bumpGroupSpent = async () => {}, recordCopy = () => {}, onEvent = () => {} } = deps;
  const seen = new Set();

  // Authoritative per-process daily spend, so the cap throttles even when a group posts
  // several calls in one tick (before any DB roundtrip). Seeded from the persisted
  // daily_spent on first sight; reset on a UTC-day rollover. Mirrors copy.js.
  const spent = new Map(); // subId -> { day, amount }
  const utcDay = () => new Date().toISOString().slice(0, 10);
  function spentSoFar(s) {
    const day = utcDay();
    const rec = spent.get(s.id);
    if (!rec) { spent.set(s.id, { day, amount: s.daily_spent || 0 }); return spent.get(s.id).amount; }
    if (rec.day !== day) { rec.day = day; rec.amount = 0; }
    return rec.amount;
  }

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
        if (spentSoFar(s) + s.size_sol > s.daily_cap_sol) { onEvent({ type: "CAP", user: s.user_pubkey }); continue; }
        try {
          const { tx } = await buyToken(c.mint, s.size_sol, s.user_pubkey, s.slippage_bps || 300);
          const sig = await signAndSend(tx, s.wallet_id); // walletId signs the tx built for user_pubkey
          // Count the spend immediately (in-memory) so same-tick calls respect the cap,
          // then persist the running total for the /tracker cap display.
          const rec = spent.get(s.id); rec.amount += s.size_sol;
          try { await bumpGroupSpent(s.id, rec.amount); } catch { /* non-fatal: in-memory cap still holds */ }
          await recordCopy({ mint: c.mint, user: s.user_pubkey, privy_user_id: s.privy_user_id, group_id: c.group_id, size: s.size_sol, sig, kind: "call" });
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
