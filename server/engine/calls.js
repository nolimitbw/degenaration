/**
 * Discord call watcher (server side). Polls the `calls` table for new, un-executed calls
 * that came from an approved channel and mirrors each one to that GROUP's subscribers,
 * respecting each subscriber's size and daily cap. Non-custodial: subscribers' DELEGATED
 * keys sign via signAndSend. Analogous to copy.js but keyed on group calls, not wallets.
 */
const { rugCheck } = require("./rugcheck");
const { evaluateSafety } = require("./safety");
const { buyToken, quoteExpired } = require("./jupiter");

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
 *  submitCallExecution(callId, subscriptionId, claimToken, sig) -> records the signature
 *  completeCall(callId) / markCallExecuted(id)
 *  signAndSend(tx, walletId) -> signature
 *  onEvent(evt)
 *
 * The trade ledger row and the position are written by engine/settlement.js once the
 * signature is confirmed, not here — see the submission comment below.
 */
function startCallWatcher(deps, pollMs = 8000) {
  const { loadPendingCalls, loadGroupSubscribers, claimCallExecution, finishCallExecution, submitCallExecution, completeCall, markCallExecuted, signAndSend, onEvent = () => {},
    // Resolves a subscriber's own safety filters. Defaults to "no builder config", which
    // keeps legacy rows on the platform baseline rather than failing them closed.
    subscriberSafety = () => ({ ok: true, safety: null, fromBuilder: false }),
    // The subscriber's own priority-fee policy and quote freshness window. Defaults to "not
    // configured", which the engine reads as the platform default rather than as zero.
    subscriberExecution = () => null } = deps;
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
        // Each subscriber's own filters, evaluated against the evidence rugCheck already
        // gathered — no extra network round trip per subscriber.
        const resolved = subscriberSafety(s);
        if (!resolved.ok) {
          // A bot created in the builder whose filters cannot be read must NOT execute.
          // Running it unfiltered would ignore the risk settings the user chose.
          onEvent({ type: "SAFETY_UNAVAILABLE", call: c.id, subscription: s.id, reason: resolved.reason });
          continue;
        }
        if (resolved.safety) {
          const verdict = evaluateSafety({
            pair: check.evidence?.pair || null,
            mintInfo: check.evidence?.mintInfo || null,
            safety: resolved.safety,
            // nowMs is REQUIRED for tokenAgeMinutes — safety.js derives age from
            // (nowMs - pair.pairCreatedAt) and yields null evidence without it. Omitting it
            // made an enabled Token age filter fail closed on EVERY call, so a subscriber
            // who turned that filter on had a bot that never traded, for a reason that had
            // nothing to do with their configuration or the token. A week-old token
            // comfortably past a 60-minute minimum was rejected as "evidence unavailable".
            nowMs: Date.now()
          });
          if (!verdict.ok) {
            onEvent({ type: "SAFETY_REJECTED", call: c.id, subscription: s.id, mint: c.mint, reasons: verdict.reasons });
            continue;
          }
        }

        let claim;
        try { claim = await claimCallExecution(c.id, s.id); }
        catch (e) { onEvent({ type: "CLAIM_ERROR", call: c.id, subscription: s.id, error: e.message }); continue; }
        if (!claim?.ok || !claim?.claim_token) {
          onEvent({ type: "CLAIM_SKIPPED", call: c.id, subscription: s.id, error: claim?.error || "execution unavailable" });
          continue;
        }
        let sig = null;
        // The bot's own execution policy. Read once per subscriber, from the same immutable
        // snapshot its safety filters came from, so a trade cannot be priced under one
        // configuration and filtered under another.
        const execution = subscriberExecution(s);
        try {
          const { tx, quotedAtMs } = await buyToken(
            c.mint, claim.size_sol, claim.user_pubkey, claim.slippage_bps || 300, execution
          );
          // The configured freshness window, enforced between building and submitting. Without
          // this the control saved, validated and reloaded while the engine applied its own
          // window to every bot. Refusing here is the safe direction: a stale quote submitted
          // is a fill at a price the user never agreed to.
          if (quoteExpired({ quotedAtMs, nowMs: Date.now(), quoteExpirationSeconds: execution?.quoteExpirationSeconds })) {
            throw new Error("quote expired before submission");
          }
          sig = await signAndSend(tx, claim.wallet_id); // walletId signs the tx built for user_pubkey
          // SUBMITTED, not succeeded. signAndSend returns as soon as Privy sends the
          // transaction, and a swap can still fail on chain for slippage or an expired
          // blockhash. engine/settlement.js resolves this signature against the chain and
          // only then records the trade and opens the position the TP/SL monitor watches.
          //
          // Confirmation is not awaited here on purpose: it can take up to two minutes to
          // reach a terminal verdict, and this loop runs once per subscriber.
          const submitted = await submitCallExecution(c.id, s.id, claim.claim_token, sig);
          if (!submitted?.ok) throw new Error(submitted?.error || "could not persist call execution");
          onEvent({ type: "CALL_BUY_SUBMITTED", group: c.group_id, mint: c.mint, user: claim.user_pubkey, sig });
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
