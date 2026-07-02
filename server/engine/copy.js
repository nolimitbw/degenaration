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
  const { loadTrackedWallets, loadSubscribers, getHoldings, signAndSend, recordCopy = () => {}, onEvent = () => {} } = deps;
  const snapshots = new Map(); // walletAddress -> holdings map
  let primed = false;

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
          if ((s.daily_spent || 0) + s.size_sol > s.daily_cap_sol) { onEvent({ type: "CAP", user: s.user_pubkey }); continue; }
          try {
            const { tx } = await buyToken(mint, s.size_sol, s.user_pubkey, s.slippage_bps || 300);
            const sig = await signAndSend(tx, s.wallet_id); // walletId signs; user_pubkey built the tx
            await recordCopy({ wallet: w.address, mint, user: s.user_pubkey, size: s.size_sol, sig });
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
