/**
 * Position monitor — watches open positions and fires TP/SL sells according to each user's
 * per-position settings.
 *
 * THE INVARIANT THIS MODULE EXISTS TO HOLD: a position with an unresolved submitted exit
 * never fires another one.
 *
 * The previous implementation treated submission as settlement. `submitSigned` resolves as
 * soon as Privy SUBMITS, so a sell that failed on chain — slippage exceeded, blockhash
 * expired, insufficient balance — was recorded as an exit that happened. The position kept
 * falling with its stop-loss believed spent, and nothing retried. A stop-loss that silently
 * does not fire is the worst failure shape in unattended trading.
 *
 * Both naive repairs are wrong on their own, which is why the fix is a state machine and
 * not a patch:
 *
 *   - Retry when unconfirmed  -> a sell that DID land but confirmed slowly is sold twice.
 *   - Leave state untouched   -> the next 5s tick re-fires the same sell, same result.
 *
 * So an exit moves open -> exiting(signature pending) -> confirmed | failed/expired, the
 * pending state blocks re-firing, and the position is persisted so a restart resumes rather
 * than abandoning or duplicating it. Token amounts are BigInt throughout: raw amounts for
 * high-supply tokens exceed 2^53 and float arithmetic would silently mis-size a sell.
 */
const { sellToken } = require("./jupiter");

const POLL_MS = 5_000;
/**
 * A sell that keeps failing must not spin forever, but it must also not be abandoned
 * quietly — an unfilled stop-loss is a user's risk limit going unenforced. After this many
 * terminal failures the position is parked in `error` and surfaced loudly for operator
 * attention rather than retried indefinitely.
 */
const MAX_EXIT_ATTEMPTS = 5;

/**
 * Tokens to sell for one take-profit level.
 *
 * `percent` is a share of the ORIGINAL position, never of what an earlier level left. The
 * API rejects tp1_sell + tp2_sell > 100 and the builder labels it "% allocated"; both are
 * meaningless unless the shares come out of the same whole. Capped at `remaining` so the
 * position can never go negative.
 */
function takeProfitShare(original, remaining, percent) {
  const orig = BigInt(original);
  const rem = BigInt(remaining);
  const pct = BigInt(Math.max(0, Math.floor(Number(percent) || 0)));
  const wanted = (orig * pct) / BigInt(100);
  if (wanted <= BigInt(0)) return BigInt(0);
  return wanted < rem ? wanted : rem;
}

/** Normalise a persisted row into the shape the decision logic reads. */
function normalizePosition(row) {
  const amount = BigInt(row.amount_raw ?? 0);
  return {
    id: row.id,
    userPubkey: row.user_pubkey,
    walletId: row.wallet_id,
    privyUserId: row.privy_user_id ?? null,
    groupId: row.group_id ?? null,
    mint: row.mint,
    entryPriceUsd: Number(row.entry_price_usd),
    amountRaw: amount,
    // Pre-existing rows may predate the column; the current amount is the best available
    // whole, and it is correct for any position that has not yet taken profit.
    originalAmountRaw: BigInt(row.original_amount_raw ?? row.amount_raw ?? 0),
    settings: {
      // UNITS. These two columns do not use the same one, and conflating them fires every
      // take-profit on the first tick.
      //
      //   tp1 / tp2   a MULTIPLE of entry. app/api/user/subscriptions/route.ts validates
      //               1.01–1000 and rejects tp2 < tp1; the SQL default is 2, meaning 2x.
      //   stop_loss   a PERCENTAGE drop from entry. Validated 1–100; default 40 = -40%.
      //
      // This code previously read `mult >= tp1 / 100`, which is right for a percentage and
      // wrong by a factor of 100 for a multiple. With the default tp1 = 2 it triggered at
      // 2% of entry price — so TP1 and TP2 both fired on the first tick and 75% of every
      // position was sold immediately at whatever the market was. The unit tests did not
      // catch it because their fixture used 200 and 500, the percentage convention, which
      // no write path in the product produces.
      tp1: row.tp1 == null ? null : Number(row.tp1),
      tp1sell: Number(row.tp1_sell ?? 0),
      tp2: row.tp2 == null ? null : Number(row.tp2),
      tp2sell: Number(row.tp2_sell ?? 0),
      sl: row.stop_loss == null ? null : Number(row.stop_loss),
      slippageBps: Number(row.slippage_bps ?? 300)
    },
    filled: { tp1: Boolean(row.filled_tp1), tp2: Boolean(row.filled_tp2) },
    status: row.status || "open",
    pending: row.pending_exit_sig
      ? {
          kind: row.pending_exit_kind,
          sig: row.pending_exit_sig,
          amountRaw: BigInt(row.pending_exit_amount_raw ?? 0),
          submittedAtMs: row.pending_exit_at ? Date.parse(row.pending_exit_at) : null,
          claimToken: row.pending_exit_claim_token ?? null
        }
      : null,
    attempts: Number(row.exit_attempts ?? 0)
  };
}

/**
 * Pure: what exit, if any, this position should fire right now.
 *
 * Returns `{ kind, amountRaw }` or null. At most ONE exit per position per tick — each one
 * needs a claim and a confirmation round trip, and firing two concurrently against the same
 * balance is how a position oversells itself.
 */
function decideExit({ position, price }) {
  // THE BLOCKING INVARIANT. An unresolved submitted exit means we do not yet know whether
  // those tokens are still held. Deciding anything here would be deciding on stale balance.
  if (position.pending) return null;
  if (position.status !== "open") return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(position.entryPriceUsd) || position.entryPriceUsd <= 0) return null;
  if (position.amountRaw <= BigInt(0)) return null;

  const mult = price / position.entryPriceUsd;
  const { settings, filled } = position;

  // Stop-loss first: it is the risk control, and it exits the whole remaining position.
  if (settings.sl != null && mult <= 1 - settings.sl / 100) {
    return { kind: "SL", amountRaw: position.amountRaw, mult };
  }
  const share = (percent) => takeProfitShare(position.originalAmountRaw, position.amountRaw, percent);
  if (!filled.tp1 && isProfitTarget(settings.tp1) && mult >= settings.tp1) {
    return { kind: "TP1", amountRaw: share(settings.tp1sell), mult };
  }
  if (!filled.tp2 && isProfitTarget(settings.tp2) && mult >= settings.tp2) {
    return { kind: "TP2", amountRaw: share(settings.tp2sell), mult };
  }
  return null;
}

/**
 * A take-profit target must be above entry. This is the fail-safe, not a formality: any
 * target at or below 1x fires the instant the position opens, which is never what a
 * take-profit means. A unit error, a zero default or a bad write all land here, and the
 * position is left alone instead of being sold at entry.
 */
function isProfitTarget(target) {
  return Number.isFinite(target) && target > 1;
}

/**
 * Pure: the settlement to persist once a pending exit's signature resolves.
 *
 * Returns null while the verdict is `pending` — the caller must leave the row untouched so
 * the exit stays blocked. Anything else is a terminal transition.
 */
function resolveExit({ position, verdict }) {
  const pending = position.pending;
  if (!pending) return null;
  if (verdict === "pending") return null;

  if (verdict === "confirmed") {
    const remaining = position.amountRaw - pending.amountRaw;
    const left = remaining > BigInt(0) ? remaining : BigInt(0);
    return {
      outcome: "confirmed",
      kind: pending.kind,
      amountRaw: left.toString(),
      // A stop-loss exits the whole position; a take-profit closes it only if it happened
      // to take the last token.
      status: pending.kind === "SL" || left === BigInt(0) ? "closed" : "open",
      filledTp1: position.filled.tp1 || pending.kind === "TP1",
      filledTp2: position.filled.tp2 || pending.kind === "TP2",
      attempts: 0,
      error: null
    };
  }

  // failed | expired — the tokens were NOT sold. Release the block so the trigger can be
  // re-evaluated against a fresh price, and do NOT mark the level filled.
  const attempts = position.attempts + 1;
  const exhausted = attempts >= MAX_EXIT_ATTEMPTS;
  return {
    outcome: verdict,
    kind: pending.kind,
    amountRaw: position.amountRaw.toString(),
    status: exhausted ? "error" : "open",
    filledTp1: position.filled.tp1,
    filledTp2: position.filled.tp2,
    attempts,
    error: `${pending.kind} exit ${verdict}${exhausted ? " — attempts exhausted, needs attention" : ""}`
  };
}

/**
 * deps:
 *   loadOpenPositions()                          -> persisted rows (open + exiting)
 *   getPrice(mint)                               -> current USD price
 *   claimExit(id, kind, amountRaw)               -> { ok, claim_token } atomic, one winner
 *   settleExit(id, claimToken, settlement)       -> persist a terminal transition
 *   recordPendingExit(id, claimToken, sig)       -> store the signature before confirming
 *   signAndSend(tx, walletId)                    -> submits, returns a signature
 *   confirmSignature(sig, { submittedAtMs })     -> { verdict }
 *   recordTrade(evt)                             -> ledger row for the realised sell
 */
function startMonitor(deps, pollMs = POLL_MS) {
  const {
    loadOpenPositions, getPrice, claimExit, settleExit, recordPendingExit,
    signAndSend, confirmSignature, recordTrade = async () => {}, onEvent = () => {}
  } = deps;

  /** Resolve an already-submitted exit. Never fires a transaction. */
  const reconcile = async (position) => {
    const pending = position.pending;
    let verdict;
    try {
      const res = await confirmSignature(pending.sig, { submittedAtMs: pending.submittedAtMs });
      verdict = res.verdict;
    } catch (e) {
      // An RPC failure is NOT evidence the transaction failed. Stay pending, stay blocked.
      onEvent({ type: "CONFIRM_ERROR", position: position.id, sig: pending.sig, error: e.message });
      return;
    }
    const settlement = resolveExit({ position, verdict });
    if (!settlement) return; // still pending — remains blocked, by design

    try {
      await settleExit(position.id, pending.claimToken, settlement);
    } catch (e) {
      onEvent({ type: "SETTLE_ERROR", position: position.id, sig: pending.sig, error: e.message });
      return;
    }

    if (settlement.outcome === "confirmed") {
      try {
        await recordTrade({
          privy_user_id: position.privyUserId, user_pubkey: position.userPubkey,
          group_id: position.groupId, mint: position.mint, side: "sell",
          sig: pending.sig, kind: pending.kind.toLowerCase()
        });
      } catch (e) {
        onEvent({ type: "RECORD_ERROR", position: position.id, sig: pending.sig, error: e.message });
      }
      onEvent({ type: `${pending.kind}_CONFIRMED`, position: position.id, mint: position.mint, sig: pending.sig });
    } else {
      onEvent({
        type: settlement.status === "error" ? "EXIT_ABANDONED" : "EXIT_RETRYABLE",
        position: position.id, mint: position.mint, sig: pending.sig,
        verdict: settlement.outcome, attempts: settlement.attempts
      });
    }
  };

  /** Evaluate triggers and submit at most one exit. Only ever called with no pending exit. */
  const evaluate = async (position) => {
    const price = await getPrice(position.mint);
    if (!price) return;
    const decision = decideExit({ position, price });
    if (!decision) return;

    // A level whose allocation rounds to zero tokens still has to be marked filled, or it
    // re-triggers every tick forever. Settle it as a no-op rather than sending a swap.
    if (decision.amountRaw <= BigInt(0)) {
      const claim = await claimExit(position.id, decision.kind, "0");
      if (!claim?.ok) return;
      await settleExit(position.id, claim.claim_token, {
        outcome: "confirmed", kind: decision.kind, amountRaw: position.amountRaw.toString(),
        status: "open", filledTp1: position.filled.tp1 || decision.kind === "TP1",
        filledTp2: position.filled.tp2 || decision.kind === "TP2", attempts: 0, error: null
      });
      onEvent({ type: "EXIT_EMPTY", position: position.id, kind: decision.kind });
      return;
    }

    // Claim BEFORE building or sending. The claim is the atomic gate that makes a second
    // worker instance — or the next tick arriving while this one is still in flight —
    // lose rather than send a duplicate sell.
    let claim;
    try {
      claim = await claimExit(position.id, decision.kind, decision.amountRaw.toString());
    } catch (e) {
      onEvent({ type: "CLAIM_ERROR", position: position.id, error: e.message });
      return;
    }
    if (!claim?.ok || !claim?.claim_token) {
      onEvent({ type: "CLAIM_SKIPPED", position: position.id, reason: claim?.error || "exit unavailable" });
      return;
    }

    let sig = null;
    try {
      const { tx } = await sellToken(position.mint, decision.amountRaw.toString(), position.userPubkey, position.settings.slippageBps);
      sig = await signAndSend(tx, position.walletId);
      if (!sig) throw new Error("signer returned no signature");
      // Persist the signature IMMEDIATELY. If the process dies between submission and this
      // write, the position is left claimed with no signature and the sell is invisible —
      // so this write is what makes a restart able to find and resolve it.
      await recordPendingExit(position.id, claim.claim_token, sig);
      onEvent({ type: `${decision.kind}_SUBMITTED`, position: position.id, mint: position.mint, sig, mult: decision.mult });
    } catch (e) {
      if (sig) {
        // Submitted but not recorded. Releasing the claim here would let the next tick fire
        // a SECOND sell for a transaction that may well land. Leave it claimed and shout.
        onEvent({ type: "EXIT_ORPHANED", position: position.id, sig, error: e.message });
        return;
      }
      try {
        await settleExit(position.id, claim.claim_token, {
          outcome: "failed", kind: decision.kind, amountRaw: position.amountRaw.toString(),
          status: position.attempts + 1 >= MAX_EXIT_ATTEMPTS ? "error" : "open",
          filledTp1: position.filled.tp1, filledTp2: position.filled.tp2,
          attempts: position.attempts + 1, error: e.message
        });
      } catch (releaseError) {
        onEvent({ type: "RELEASE_ERROR", position: position.id, error: releaseError.message });
      }
      onEvent({ type: "EXIT_ERROR", position: position.id, mint: position.mint, error: e.message });
    }
  };

  const runTick = async () => {
    let rows = [];
    try { rows = await loadOpenPositions(); }
    catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); return; }

    for (const row of rows || []) {
      let position;
      try { position = normalizePosition(row); }
      catch (e) { onEvent({ type: "POSITION_ERROR", position: row?.id, error: e.message }); continue; }
      try {
        // Reconciliation runs FIRST and unconditionally: resolving yesterday's submitted
        // exit is what allows today's trigger to be evaluated at all.
        if (position.pending) await reconcile(position);
        else await evaluate(position);
      } catch (e) {
        onEvent({ type: "ERROR", position: position.id, error: e.message });
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

module.exports = { startMonitor, takeProfitShare, decideExit, resolveExit, normalizePosition, isProfitTarget, MAX_EXIT_ATTEMPTS };
