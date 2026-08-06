/**
 * Copy-trade watcher (server side). Snapshots each tracked wallet's token holdings and
 * mirrors NEW buys to that wallet's subscribers, respecting each subscriber's size and
 * daily cap. Non-custodial: subscribers' DELEGATED keys sign via signAndSend.
 *
 * Detection by holdings diff (robust, no tx parsing): a mint that appears, or whose
 * balance increases, since the last snapshot is treated as a buy signal.
 */
const { rugCheck } = require("./rugcheck");
const { evaluateSafety } = require("./safety");
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
 * Pure: a key identifying one detected buy, stable ACROSS worker instances.
 *
 * Derived from the leader's post-buy balance, which every instance reads from the same
 * chain state. A timestamp or per-process counter would differ between instances and the
 * unique index built on this key would stop deduplicating anything.
 */
function dedupeKey(leaderWallet, mint, leaderBalance) {
  return `${leaderWallet}:${mint}:${String(leaderBalance)}`;
}

/**
 * deps:
 *  loadTrackedWallets() -> [{ address }]
 *  loadSubscribers(walletAddress) -> [{ user_pubkey, size_sol, slippage_bps, daily_cap_sol, daily_spent }]
 *  getHoldings(address) -> { [mint]: amount }        (RPC getTokenAccountsByOwner)
 *  signAndSend(tx, userPubkey) -> signature
 *  claimCopyExecution(subId, leaderWallet, mint, dedupeKey) -> atomic claim + cap reservation
 *  submitCopyExecution(subId, dedupeKey, claimToken, sig)   -> records the signature
 *  subscriberSafety(row) -> { ok, safety } — the subscriber's OWN filters
 *  onEvent(evt)
 *
 * The trade ledger row and the position are written by engine/settlement.js once the
 * signature is confirmed, not here.
 */
function startCopyWatcher(deps, pollMs = 10000) {
  const {
    loadTrackedWallets, loadSubscribers, getHoldings, signAndSend,
    claimCopyExecution, submitCopyExecution, onEvent = () => {},
    // Resolves a subscriber's own safety filters. Defaults to "no builder config", which
    // keeps legacy rows on the platform baseline rather than failing them closed.
    subscriberSafety = () => ({ ok: true, safety: null, fromBuilder: false })
  } = deps;
  const snapshots = new Map(); // walletAddress -> holdings map
  let primed = false;

  const runTick = async () => {
    let wallets = [];
    try { wallets = await loadTrackedWallets(); } catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); }

    for (const w of wallets) {
      let curr = {};
      try { curr = await getHoldings(w.address); } catch { continue; }
      const prev = snapshots.get(w.address);
      snapshots.set(w.address, curr);
      if (!prev || !primed) continue; // first pass just primes baselines, never mirrors

      for (const mint of detectBuys(prev, curr)) {
        // Baseline platform gate, and the evidence each subscriber's own filters are then
        // evaluated against — so the per-subscriber check costs no extra round trip.
        let check; try { check = await rugCheck(mint); } catch { check = { ok: false, reasons: ["check failed"] }; }
        if (!check.ok) { onEvent({ type: "SKIP", wallet: w.address, mint, reasons: check.reasons }); continue; }

        const key = dedupeKey(w.address, mint, curr[mint]);
        let subs = [];
        try { subs = await loadSubscribers(w.address); } catch { subs = []; }
        for (const s of subs) {
          if (!s.wallet_id) { onEvent({ type: "NO_WALLET", user: s.user_pubkey }); continue; }

          // PER-SUBSCRIBER SAFETY. This used to run only as the single shared rugCheck
          // above, so every filter a user configured in the builder was ignored on this
          // path. One verdict cannot express different subscribers' bounds, so the
          // evaluation belongs here, inside the loop — the shape calls.js already uses.
          const resolved = subscriberSafety(s);
          if (!resolved.ok) {
            // Filters exist but cannot be read. Running the bot unfiltered would ignore the
            // risk settings the user chose, so it does not execute.
            onEvent({ type: "SAFETY_UNAVAILABLE", wallet: w.address, subscription: s.id, reason: resolved.reason });
            continue;
          }
          if (resolved.safety) {
            const verdict = evaluateSafety({
              pair: check.evidence?.pair || null,
              mintInfo: check.evidence?.mintInfo || null,
              safety: resolved.safety,
              // Required for tokenAgeMinutes: safety.js derives age from
              // (nowMs - pair.pairCreatedAt) and yields null evidence without it, which
              // would fail an enabled age filter closed on every single call.
              nowMs: Date.now()
            });
            if (!verdict.ok) {
              onEvent({ type: "SAFETY_REJECTED", wallet: w.address, subscription: s.id, mint, reasons: verdict.reasons });
              continue;
            }
          }

          // Claim BEFORE building the swap. The claim reserves the daily-cap spend inside
          // its own transaction and is unique per (subscription, detected buy), so a second
          // worker instance loses the race instead of mirroring the same buy and spending
          // the cap twice. This replaced a per-process Map that two instances could not
          // share and an absolute-total write that they clobbered.
          let claim;
          try { claim = await claimCopyExecution(s.id, w.address, mint, key); }
          catch (e) { onEvent({ type: "CLAIM_ERROR", subscription: s.id, mint, error: e.message }); continue; }
          if (!claim?.ok || !claim?.claim_token) {
            onEvent({ type: "CLAIM_SKIPPED", subscription: s.id, mint, reason: claim?.error || "execution unavailable" });
            continue;
          }

          let sig = null;
          try {
            const { tx, quotedAtMs } = await buyToken(mint, claim.size_sol, claim.user_pubkey, claim.slippage_bps || 300);
            sig = await signAndSend(tx, claim.wallet_id, {
              walletAddress: claim.user_pubkey,
              maxLamports: claim.size_lamports ?? undefined,
              builtAtMs: quotedAtMs,
              idempotencyKey: key
            });
            // SUBMITTED, not succeeded. engine/settlement.js confirms this signature against
            // the chain, records the trade only if it landed, and opens the position that
            // gives this copy trade a working stop-loss.
            const submitted = await submitCopyExecution(s.id, key, claim.claim_token, sig);
            if (!submitted?.ok) throw new Error(submitted?.error || "could not persist copy execution");
            onEvent({ type: "COPY_SUBMITTED", wallet: w.address, mint, user: claim.user_pubkey, sig });
          } catch (e) {
            onEvent({ type: sig ? "PERSIST_ERROR" : "EXEC_ERROR", subscription: s.id, mint, sig, error: e.message });
          }
        }
      }
    }
    primed = true;
  };
  const tick = async () => {
    try { await runTick(); }
    catch (e) { onEvent({ type: "TICK_ERROR", error: e.message }); }
    finally { setTimeout(tick, pollMs); }
  };
  tick();
}

module.exports = { detectBuys, dedupeKey, startCopyWatcher };
