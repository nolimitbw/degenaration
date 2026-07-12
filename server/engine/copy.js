/**
 * Copy-trade watcher (server side). Snapshots each tracked wallet's token holdings and
 * mirrors NEW buys to that wallet's subscribers, respecting each subscriber's size and
 * daily cap. Non-custodial: subscribers' DELEGATED keys sign via signAndSend.
 *
 * Detection by holdings diff (robust, no tx parsing): a mint that appears, or whose
 * balance increases, since the last snapshot is treated as a buy signal.
 */
const { rugCheck } = require("./rugcheck");
const { buyToken } = require("./jupiter");

// Pure, testable: mints that are new or increased between two holdings snapshots.
// prev/curr: { [mint]: amount }. Returns array of mints.
function detectBuys(prev, curr) {
  const out = [];
  for (const mint of Object.keys(curr)) {
    const before = prev[mint] || 0;
    if (curr[mint] > before * 1.0000001) out.push(mint); // new or increased
  }
  return out;
}

/**
 * deps:
 *  loadTrackedWallets() -> [{ address }]
 *  loadSubscribers(walletAddress) -> [{ user_pubkey, size_sol, slippage_bps, daily_cap_sol, daily_spent }]
 *  getHoldings(address) -> { [mint]: amount }        (RPC getTokenAccountsByOwner)
 *  signAndSend(tx, userPubkey) -> signature
 *  recordCopy(evt) / onEvent(evt)
 */
function startCopyWatcher(deps, pollMs = 10000) {
  const { loadTrackedWallets, loadSubscribers, getHoldings, signAndSend, bumpDailySpent = async () => {}, recordCopy = () => {}, onEvent = () => {} } = deps;
  const snapshots = new Map(); // walletAddress -> holdings map
  let primed = false;

  // Authoritative per-process daily spend tracking, so the cap actually throttles even
  // within a single 10s tick (before any DB roundtrip). Keyed by subscription id.
  // On first sight we seed from the persisted daily_spent (restart-safe: worst case a user
  // is blocked slightly early, never overspent). On a UTC-day rollover we reset to 0.
  const spent = new Map(); // subId -> { day, amount }
  const utcDay = () => new Date().toISOString().slice(0, 10);
  function spentSoFar(s) {
    const day = utcDay();
    const rec = spent.get(s.id);
    if (!rec) { spent.set(s.id, { day, amount: s.daily_spent || 0 }); return spent.get(s.id).amount; }
    if (rec.day !== day) { rec.day = day; rec.amount = 0; } // new UTC day — reset
    return rec.amount;
  }

  const tick = async () => {
    let wallets = [];
    try { wallets = await loadTrackedWallets(); } catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); }

    for (const w of wallets) {
      let curr = {};
      try { curr = await getHoldings(w.address); } catch { continue; }
      const prev = snapshots.get(w.address);
      snapshots.set(w.address, curr);
      if (!prev || !primed) continue; // first pass just primes baselines, never mirrors

      for (const mint of detectBuys(prev, curr)) {
        // safety gate before mirroring anyone in
        let check; try { check = await rugCheck(mint); } catch { check = { ok: false, reasons: ["check failed"] }; }
        if (!check.ok) { onEvent({ type: "SKIP", wallet: w.address, mint, reasons: check.reasons }); continue; }

        let subs = [];
        try { subs = await loadSubscribers(w.address); } catch { subs = []; }
        for (const s of subs) {
          if (!s.wallet_id) { onEvent({ type: "NO_WALLET", user: s.user_pubkey }); continue; }
          if (spentSoFar(s) + s.size_sol > s.daily_cap_sol) { onEvent({ type: "CAP", user: s.user_pubkey }); continue; }
          try {
            const { tx } = await buyToken(mint, s.size_sol, s.user_pubkey, s.slippage_bps || 300);
            const sig = await signAndSend(tx, s.wallet_id); // walletId signs; user_pubkey built the tx
            // Count the spend immediately (in-memory) so same-tick copies respect the cap,
            // then persist the running total for the UI.
            const rec = spent.get(s.id); rec.amount += s.size_sol;
            try { await bumpDailySpent(s.id, rec.amount); } catch { /* non-fatal: in-memory cap still holds */ }
            await recordCopy({ wallet: w.address, mint, user: s.user_pubkey, privy_user_id: s.privy_user_id, size: s.size_sol, sig, kind: "copy" });
            onEvent({ type: "COPY", wallet: w.address, mint, user: s.user_pubkey, sig });
          } catch (e) {
            onEvent({ type: "EXEC_ERROR", user: s.user_pubkey, mint, error: e.message });
          }
        }
      }
    }
    primed = true;
    setTimeout(tick, pollMs);
  };
  tick();
}

module.exports = { detectBuys, startCopyWatcher };
