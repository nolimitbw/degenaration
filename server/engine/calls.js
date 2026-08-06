/**
 * Discord call watcher (server side). Polls the `calls` table for new, un-executed calls
 * that came from an approved channel and mirrors each one to that GROUP's subscribers,
 * respecting each subscriber's size and daily cap. Non-custodial: subscribers' DELEGATED
 * keys sign via signAndSend. Analogous to copy.js but keyed on group calls, not wallets.
 */
/**
 * How many times an entry attempt may be rebuilt, and when it may not.
 *
 * `autoRetryCount` is a builder control that has been persisted and versioned since the builder
 * shipped and read by nothing — the engine made exactly one attempt per call and gave up.
 *
 * THE INVARIANT THAT MATTERS MORE THAN THE COUNT. A retry is only ever safe BEFORE a signature
 * exists. Once `signAndSend` has returned, the transaction may be on its way to the chain even
 * if the call that followed it threw, and re-submitting would double-spend the reservation.
 * `retryable` therefore takes the signature, not just the attempt number, and refuses outright
 * once one exists — the bound is the second line of defence, not the first.
 *
 * Absent means one attempt, matching what the engine did before this had a reader. Clamped so a
 * configuration cannot ask the worker to loop indefinitely against a failing route.
 */
const MAX_ENTRY_ATTEMPTS = 5;

function entryAttempts(autoRetryCount) {
  const configured = Math.floor(Number(autoRetryCount));
  if (!Number.isFinite(configured) || configured <= 0) return 1;
  return Math.min(1 + configured, MAX_ENTRY_ATTEMPTS);
}

function retryable({ signature, attempt, attempts }) {
  if (signature) return false;
  return attempt + 1 < attempts;
}

const { rugCheck } = require("./rugcheck");
const { evaluateSafety } = require("./safety");
const { buyToken, quoteExpired } = require("./jupiter");
const { guardWithSimulation } = require("./simulate");
const { bindQuoteToIntent } = require("./signer-policy");

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
        const attempts = entryAttempts(execution?.autoRetryCount);
        let attempt = 0;
        let lastError = null;
        // Bounded rebuild. Each attempt takes a FRESH quote — retrying a stale one would submit
        // a price the market has left — and the loop cannot run once a signature exists.
        while (attempt < attempts && !sig) {
        try {
          const { tx, quote, quotedAtMs } = await buyToken(
            c.mint, claim.size_sol, claim.user_pubkey, claim.slippage_bps || 300, execution
          );
          // The mint and slippage the signer policy cannot see in the serialized transaction.
          // A caller that resolved the wrong mint would otherwise build a perfectly valid swap,
          // from the right wallet, inside the lamport ceiling, for the wrong token.
          const mismatch = bindQuoteToIntent(quote, {
            mint: c.mint, side: "buy", slippageBps: claim.slippage_bps || 300
          });
          if (mismatch) throw new Error(`quote does not match the intent: ${mismatch}`);
          // The configured freshness window, enforced between building and submitting. Without
          // this the control saved, validated and reloaded while the engine applied its own
          // window to every bot. Refusing here is the safe direction: a stale quote submitted
          // is a fill at a price the user never agreed to.
          if (quoteExpired({ quotedAtMs, nowMs: Date.now(), quoteExpirationSeconds: execution?.quoteExpirationSeconds })) {
            throw new Error("quote expired before submission");
          }
          // PRE-SUBMIT SIMULATION. A quote says a route exists at a price; a simulation runs the
          // instructions against current cluster state and reports the error the real submission
          // would hit — a missing token account, a transfer-fee extension the route ignored, a
          // pool past the slippage bound. Nothing is signed or sent: sigVerify is false and the
          // transaction is still unsigned here.
          const simulation = await guardWithSimulation(tx, { required: execution?.simulationRequired });
          if (!simulation.ok) {
            onEvent({ type: "SIMULATION_REJECTED", call: c.id, subscription: s.id, mint: c.mint, reason: simulation.reason });
            throw new Error(simulation.reason);
          }
          // Bound to the authorisation, not merely submitted. engine/signer-policy.js refuses a
          // transaction whose fee payer is not this wallet, that invokes a program outside the
          // allowlist, that moves more lamports than the claim reserved, or that is stale.
          sig = await signAndSend(tx, claim.wallet_id, {
            walletAddress: claim.user_pubkey,
            maxLamports: claim.size_lamports ?? undefined,
            builtAtMs: quotedAtMs,
            maxAgeMs: execution?.quoteExpirationSeconds ? execution.quoteExpirationSeconds * 1000 : undefined,
            idempotencyKey: `call:${c.id}:${s.id}`
          });
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
          lastError = e;
          if (retryable({ signature: sig, attempt, attempts })) {
            attempt += 1;
            onEvent({ type: "ENTRY_RETRY", call: c.id, subscription: s.id, mint: c.mint, attempt, of: attempts, error: e.message });
            continue;
          }
          if (!sig) {
            try { await finishCallExecution(c.id, s.id, claim.claim_token, "failed", null, e.message); }
            catch (finishError) { onEvent({ type: "FINISH_ERROR", call: c.id, subscription: s.id, error: finishError.message }); }
          }
          onEvent({
            type: sig ? "PERSIST_ERROR" : "EXEC_ERROR",
            subscription: s.id, mint: c.mint, sig, error: e.message,
            attempts: attempt + 1
          });
          break;
        }
        }
        void lastError;
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

module.exports = { pickNewCalls, startCallWatcher, entryAttempts, retryable, MAX_ENTRY_ATTEMPTS };
