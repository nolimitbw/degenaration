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
const { buyToken, sellToken, quoteExpired } = require("./jupiter");
const { guardWithSimulation } = require("./simulate");
const { dcaPlan, decideDca } = require("./dca");
const { bindQuoteToIntent } = require("./signer-policy");

const POLL_MS = 5_000;
/**
 * A sell that keeps failing must not spin forever, but it must also not be abandoned
 * quietly — an unfilled stop-loss is a user's risk limit going unenforced. After this many
 * terminal failures the position is parked in `error` and surfaced loudly for operator
 * attention rather than retried indefinitely.
 */
const MAX_EXIT_ATTEMPTS = 5;

/**
 * The hard ceiling on emergency slippage. 15%.
 *
 * `stopLoss.emergencyExit` promises "the best bounded route when the normal exit fails", and
 * BOUNDED is the load-bearing word: a position that cannot sell at 3% is stuck holding through
 * its own stop, but an unbounded retry would sell it at any price at all, which is a worse
 * outcome than the one it is fixing. This cap is what makes the difference.
 */
const EMERGENCY_SLIPPAGE_CAP_BPS = 1500;

/**
 * The slippage this exit attempt should use.
 *
 * Escalates ONLY when the user switched emergency exit on, and only after the ordinary attempts
 * have actually failed — the first two attempts always use exactly what the user configured, so
 * a transient RPC error never costs them a worse fill. From the third attempt the tolerance
 * doubles per attempt, capped.
 *
 * Pure, so the whole ladder is testable without a network.
 */
function exitSlippageBps({ configuredBps, attempts = 0, emergencyExit = false }) {
  const base = Number(configuredBps) > 0 ? Math.floor(Number(configuredBps)) : 300;
  if (!emergencyExit) return base;
  // attempts is how many have already failed. 0 and 1 use the configured value.
  const escalations = Math.max(0, Math.floor(Number(attempts) || 0) - 1);
  if (escalations === 0) return base;
  const widened = base * 2 ** escalations;
  // Never below what the user asked for, never above the cap, and never widened past the cap
  // even if their own configured value is already higher — a user who chose 20% keeps 20%.
  return Math.max(base, Math.min(widened, Math.max(base, EMERGENCY_SLIPPAGE_CAP_BPS)));
}

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

/**
 * The exit plan a position was opened under, in one unambiguous shape.
 *
 * Two sources, in priority order:
 *
 *   entry_config   what BotBuilder collected — a LIST of take-profit levels each with its
 *                  own trailing retracement, and a stop that may itself trail. Units are
 *                  basis points of GAIN for a target (10000 = +100% = 2x) and basis points
 *                  of the original position for a sell (5000 = 50%), which is what the
 *                  builder's own defaults mean: targetBps 10000 / 40000 correspond exactly
 *                  to the legacy tp1 = 2 and tp2 = 5.
 *   the flat tp1/tp2/stop_loss columns, for a position opened before entry_config existed.
 *
 * Everything downstream reads `plan` and never the raw columns, so there is one place
 * where a unit is interpreted.
 *
 * UNITS OF THE LEGACY COLUMNS. They do not share one, and conflating them fired every
 * take-profit on the first tick:
 *
 *   tp1 / tp2   a MULTIPLE of entry. app/api/user/subscriptions/route.ts validates
 *               1.01–1000 and rejects tp2 < tp1; the SQL default is 2, meaning 2x.
 *   stop_loss   a PERCENTAGE drop from entry. Validated 1–100; default 40 = -40%.
 */
function exitPlan(row) {
  const config = row.entry_config && typeof row.entry_config === "object" ? row.entry_config : {};
  const configured = Array.isArray(config.takeProfit?.levels) ? config.takeProfit.levels : null;

  // TAKE PROFIT OFF IS NOT THE SAME AS NO CONFIG.
  //
  // This used to branch on `configured.length`, so a bot whose owner switched take profit off
  // — which persists `levels: []` — fell through to the legacy tp1/tp2 columns below. Those
  // are populated by app_user_save_bot, which coalesces a missing level to 10000 bps. The
  // position would then take profit at 2x for a user who had explicitly turned selling off,
  // and nothing would report it: the toggle saved, reloaded and showed Off the whole time.
  //
  // The presence of the takeProfit object is what distinguishes the two. A position opened
  // from the builder always has one; only a position predating entry_config does not.
  // THE TRAILING MASTER GATES THE PER-LEVEL DISTANCE.
  //
  // `takeProfit.trailing` had no reader: each level's own `trailingBps` was applied whether the
  // master was on or off, so a user who switched trailing off still had levels that armed at
  // the target and waited for a retracement instead of selling. The switch's own description —
  // "Apply the per-level trailing distance after activation" — is exactly this gate, and it was
  // the one thing it did not do.
  //
  // Gating rather than inventing a default distance: a master with no per-level value would
  // otherwise need a retracement nobody chose, and a fabricated exit distance is worse than an
  // unread switch.
  const trailingEnabled = config.takeProfit?.trailing !== false;
  const level = (item, index) => ({
    index,
    target: 1 + Number(item?.targetBps ?? 0) / 10000,
    sellPercent: Number(item?.sellBps ?? 0) / 100,
    trailingBps: trailingEnabled ? Number(item?.trailingBps ?? 0) : 0
  });

  // AUTOMATIC EXITS OFF MEANS NO AUTOMATED EXIT AT ALL.
  //
  // Absent is ON: a position opened before this switch existed was being exited automatically,
  // and reading a missing key as "off" would strand every one of them holding.
  const autoExit = config.autoExit !== false;

  if (config.takeProfit && typeof config.takeProfit === "object") {
    const levels = configured || [];
    return {
      autoExit,
      levels: levels
        .map(level)
        .filter((item) => isProfitTarget(item.target))
        .sort((a, b) => a.target - b.target),
      stop: {
        dropFraction: Number(config.stopLoss?.stopBps ?? 0) / 10000,
        trailing: Boolean(config.stopLoss?.trailing),
        delaySeconds: Math.max(0, Number(config.stopLoss?.delaySeconds ?? 0))
      }
    };
  }

  if (configured && configured.length) {
    return {
      autoExit,
      levels: configured
        .map(level)
        .filter((item) => isProfitTarget(item.target))
        .sort((a, b) => a.target - b.target),
      stop: {
        dropFraction: Number(config.stopLoss?.stopBps ?? 0) / 10000,
        trailing: Boolean(config.stopLoss?.trailing),
        delaySeconds: Math.max(0, Number(config.stopLoss?.delaySeconds ?? 0))
      }
    };
  }

  const legacy = [
    { index: 0, target: row.tp1 == null ? null : Number(row.tp1), sellPercent: Number(row.tp1_sell ?? 0), trailingBps: 0 },
    { index: 1, target: row.tp2 == null ? null : Number(row.tp2), sellPercent: Number(row.tp2_sell ?? 0), trailingBps: 0 }
  ].filter((level) => isProfitTarget(level.target));
  return {
    // A position with no builder configuration at all predates the switch and was being
    // exited automatically. It keeps being.
    autoExit: true,
    levels: legacy.sort((a, b) => a.target - b.target),
    stop: {
      dropFraction: row.stop_loss == null ? 0 : Number(row.stop_loss) / 100,
      trailing: false,
      // A position with no builder configuration predates the control and fires immediately,
      // which is what it did before.
      delaySeconds: 0
    }
  };
}

/**
 * The priority-fee policy and quote window this position exits under.
 *
 * Same shape store.subscriberExecution returns for the entry side, read here from the
 * position's own immutable entry_config rather than from the bot, so an exit is priced under
 * the configuration the trade was opened with.
 */
function executionPolicy(entryConfig) {
  const config = entryConfig && typeof entryConfig === "object" ? entryConfig : null;
  if (!config) return null;
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  // Same switch layer as the entry side reads, from this position's own frozen configuration.
  const limits = config.limits && typeof config.limits === "object" ? config.limits : {};
  const priorityFeeMaxLamports = limits.priorityFee === false ? null : number(config.priorityFeeMaxLamports);
  const quoteExpirationSeconds = number(config.quoteExpirationSeconds);
  const simulationRequired = config.simulationRequired !== false;
  if (priorityFeeMaxLamports === null && quoteExpirationSeconds === null && simulationRequired) return null;
  return {
    priorityFeeMaxLamports,
    priorityFeeStrategy: typeof config.priorityFeeStrategy === "string" ? config.priorityFeeStrategy : "auto",
    quoteExpirationSeconds,
    simulationRequired
  };
}

/** Normalise a persisted row into the shape the decision logic reads. */
function normalizePosition(row) {
  const amount = BigInt(row.amount_raw ?? 0);
  const entry = Number(row.entry_price_usd);
  const peakPrice = Number(row.peak_price_usd ?? row.entry_price_usd);
  const legacyFilled = new Set();
  if (row.filled_tp1) legacyFilled.add(0);
  if (row.filled_tp2) legacyFilled.add(1);
  const recorded = Array.isArray(row.filled_levels) ? row.filled_levels.map(Number) : [];
  return {
    plan: exitPlan(row),
    // Floor at 1: a position's peak is at worst its own entry, so a trailing stop starts
    // exactly where a fixed stop would and only ever tightens.
    peakMultiple: Number.isFinite(peakPrice) && Number.isFinite(entry) && entry > 0
      ? Math.max(1, peakPrice / entry)
      : 1,
    filledLevels: new Set([...legacyFilled, ...recorded.filter(Number.isFinite)]),
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
    // Targets and stops live in `plan`, which is the single place a unit is interpreted.
    // The raw columns are deliberately not carried through: they are ambiguous on their
    // own, and reading one directly is how the 100x take-profit error happened.
    stopBreachedAtMs: row.stop_breached_at ? Date.parse(row.stop_breached_at) : null,
    // Dollar-cost averaging. Read from the SAME immutable entry_config the exit plan comes
    // from, so editing the bot cannot change the ladder of a position already open under it.
    dca: dcaPlan(row.entry_config),
    filledDcaLevels: new Set(
      (Array.isArray(row.filled_dca_levels) ? row.filled_dca_levels : []).map(Number).filter(Number.isFinite)
    ),
    // The expiry window is anchored to when the position BEGAN, not to the last fill —
    // anchored to the last fill it would extend itself every time it fired.
    //
    // `created_at`, not `opened_at`. An earlier draft read `opened_at`, which exists only in
    // degenaration-product-ledgers-operations.sql and is NOT on public.positions in
    // production: PostgREST answers an unknown column with 400, so the worker would have
    // failed on its first read of every tick. check:worker-schema-contract caught it, which is
    // the third time that gate has fired on a real defect.
    openedAtMs: row.created_at ? Date.parse(row.created_at) : NaN,
    // A DCA fill is an ENTRY, so it obeys the entry switches rather than the exit ones. A user
    // who turned automatic entries off did not exempt the buys attached to a position they
    // already hold. Absent is ON, matching how the claim reads the same keys.
    autoEntry: (row.entry_config && typeof row.entry_config === "object")
      ? row.entry_config.autoEntry !== false : true,
    killSwitch: (row.entry_config && typeof row.entry_config === "object")
      ? row.entry_config.killSwitch === true : false,
    settings: {
      slippageBps: Number(row.slippage_bps ?? 300),
      // The exit is priced under the SAME configuration snapshot the position was opened
      // under — entry_config, which positions_entry_config_guard makes immutable — so editing
      // the bot cannot change how an already-open position pays to get out.
      execution: executionPolicy(row.entry_config),
      // `stopLoss.emergencyExit`. Absent is OFF: widening a user's slippage is a decision that
      // costs them money, and it must be one they made rather than one a missing key made for
      // them. Read from the position's own immutable entry_config, like every other exit term.
      emergencyExit: (row.entry_config && typeof row.entry_config === "object")
        ? row.entry_config.stopLoss?.emergencyExit === true : false
    },
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
function decideExit({ position, price, nowMs = Date.now() }) {
  // THE BLOCKING INVARIANT. An unresolved submitted exit means we do not yet know whether
  // those tokens are still held. Deciding anything here would be deciding on stale balance.
  if (position.pending) return null;
  if (position.status !== "open") return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(position.entryPriceUsd) || position.entryPriceUsd <= 0) return null;
  if (position.amountRaw <= BigInt(0)) return null;

  const mult = price / position.entryPriceUsd;
  const { plan } = position;
  // The master. Off means the owner exits by hand — including the stop, which is why the
  // builder says so plainly rather than burying it. Checked before the stop so there is
  // exactly one place automated exits can be refused.
  if (plan.autoExit === false) return null;
  // The peak includes this tick: a price that has just made a new high must be usable for
  // trailing immediately, not only after the write that persists it lands.
  const peak = Math.max(position.peakMultiple, mult);

  // Stop-loss first: it is the risk control, and it exits the whole remaining position.
  //
  // A trailing stop rides the high-water mark; a fixed one is measured from entry. Because
  // the peak is floored at 1, a trailing stop can only ever be tighter than the fixed one
  // it replaces, never looser.
  if (plan.stop.dropFraction > 0) {
    const reference = plan.stop.trailing ? peak : 1;
    if (mult <= reference * (1 - plan.stop.dropFraction)) {
      // THE DELAY. A single noisy print must not liquidate a position that recovers on the next
      // tick, which is the entire meaning of the control and was enforced by nothing: the stop
      // fired on the FIRST tick past the threshold.
      //
      // The clock is durable (positions.stop_breached_at) rather than in process memory,
      // because a worker restart during a volatile minute is exactly when losing it would make
      // the setting a lie.
      const delayMs = (plan.stop.delaySeconds || 0) * 1000;
      if (delayMs > 0) {
        // First observation of this breach: arm the clock and hold. The monitor persists it.
        if (!position.stopBreachedAtMs) return { kind: null, stopBreach: "start", mult };
        if (nowMs - position.stopBreachedAtMs < delayMs) return { kind: null, stopBreach: "hold", mult };
      }
      return { kind: "SL", amountRaw: position.amountRaw, mult };
    }
    // Recovered above the threshold. Clearing is what makes the next breach start a fresh
    // clock rather than inheriting a stale one from minutes ago.
    if (position.stopBreachedAtMs) return { kind: null, stopBreach: "clear", mult };
  }

  const share = (percent) => takeProfitShare(position.originalAmountRaw, position.amountRaw, percent);
  for (const level of plan.levels) {
    if (position.filledLevels.has(level.index)) continue;
    if (peak < level.target) continue;

    // A trailing level does not sell when the target is reached — it arms there and sells
    // once the price gives back `trailingBps` from the high. Arming needs no stored flag:
    // the persisted peak already records that the target was met, so an armed level stays
    // armed across a worker restart.
    if (level.trailingBps > 0 && mult > peak * (1 - level.trailingBps / 10000)) continue;

    const amountRaw = share(level.sellPercent);
    if (amountRaw <= BigInt(0)) continue;
    return { kind: levelKind(level.index), amountRaw, mult, levelIndex: level.index };
  }
  return null;
}

/**
 * TP1 and TP2 are persisted as-is because filled_tp1 / filled_tp2 are real columns and
 * settlement still writes them. Beyond the second level the kind is positional.
 */
function levelKind(index) {
  return index === 0 ? "TP1" : index === 1 ? "TP2" : `TP${index + 1}`;
}

function levelIndexOf(kind) {
  const match = /^TP(\d+)$/.exec(String(kind || ""));
  return match ? Number(match[1]) - 1 : null;
}

/**
 * The fill state to persist, optionally after taking `kind`.
 *
 * Returns the generalised list AND the two legacy booleans, because filled_tp1 and
 * filled_tp2 are real columns that settlement still writes. Deriving both from one set
 * keeps a third level from silently un-marking the first two.
 */
function fillState(position, kind) {
  const filled = new Set(position.filledLevels);
  const index = levelIndexOf(kind);
  if (index !== null) filled.add(index);
  return {
    filledLevels: [...filled].sort((a, b) => a - b),
    filledTp1: filled.has(0),
    filledTp2: filled.has(1)
  };
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
      ...fillState(position, pending.kind),
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
    ...fillState(position, null),
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
 *   recordPeak(id, priceUsd)                     -> raise the high-water mark (monotonic)
 *   recordStopBreach(id, breached)               -> arm or clear the durable stop-delay clock
 *   signAndSend(tx, walletId)                    -> submits, returns a signature
 *   confirmSignature(sig, { submittedAtMs })     -> { verdict }
 *   recordTrade(evt)                             -> ledger row for the realised sell
 */
function startMonitor(deps, pollMs = POLL_MS) {
  const {
    loadOpenPositions, getPrice, claimExit, settleExit, recordPendingExit,
    signAndSend, confirmSignature, recordTrade = async () => {},
    // Optional so an older caller keeps working: without it the peak simply is not
    // persisted, and trailing degrades to measuring from this process's own high.
    recordPeak = async () => {},
    // Durable stop-breach clock. Defaults to a no-op so a caller that has not wired it yet
    // simply never persists a breach — which, combined with decideExit arming on the first
    // observation, means the stop holds rather than fires. Holding is the safe default here.
    recordStopBreach = async () => {},
    // Dollar-cost averaging. Defaults to a no-op so a caller that has not wired it simply
    // never places a level — the state this control has been in since the builder shipped,
    // and the safe direction: not spending is recoverable, spending is not.
    recordDcaFill = null,
    onEvent = () => {}
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

  /**
   * Buy one DCA level into an open position.
   *
   * Deliberately the SAME guarded path an entry takes in engine/calls.js — quote, bind the
   * quote to the intent, check freshness, simulate, then sign under the policy. A second buy
   * path with weaker checks would be a hole in exactly the boundary the signer policy exists
   * to hold, and this one moves money into a position the user is already exposed on.
   */
  const placeDca = async (position, fill, price) => {
    const execution = position.settings.execution;
    const slippageBps = position.settings.slippageBps || 300;
    const { tx, quote, quotedAtMs } = await buyToken(
      position.mint, fill.buyAmountSol, position.userPubkey, slippageBps, execution
    );

    // The mint and slippage the signer policy cannot see in the serialized transaction.
    const mismatch = bindQuoteToIntent(quote, { mint: position.mint, side: "buy", slippageBps });
    if (mismatch) throw new Error(`quote does not match the position: ${mismatch}`);

    if (quoteExpired({ quotedAtMs, nowMs: Date.now(), quoteExpirationSeconds: execution?.quoteExpirationSeconds })) {
      throw new Error("quote expired before submission");
    }

    const simulation = await guardWithSimulation(tx, { required: execution?.simulationRequired });
    if (!simulation.ok) throw new Error(simulation.reason);

    const lamports = Math.round(fill.buyAmountSol * 1e9);
    const sig = await signAndSend(tx, position.walletId, {
      walletAddress: position.userPubkey,
      // Bounded by THIS LEVEL's allocation, not by the position's whole plan. A bug that
      // resolved the wrong level must not be able to spend a deeper level's budget.
      maxLamports: lamports,
      builtAtMs: quotedAtMs,
      maxAgeMs: execution?.quoteExpirationSeconds ? execution.quoteExpirationSeconds * 1000 : undefined,
      // Stable per position and level, so a retry after a lost response cannot buy twice.
      idempotencyKey: `dca:${position.id}:${fill.index}`
    });

    // The quote's own output amount is what the swap is routed to deliver. Using it rather
    // than re-reading the wallet balance keeps the recorded amount tied to the transaction
    // this signature belongs to, instead of to whatever the balance happens to be when the
    // next tick looks.
    const amountRaw = String(quote?.outAmount ?? "0");
    if (!/^[1-9][0-9]*$/.test(amountRaw)) throw new Error("quote returned no output amount");

    const recorded = await recordDcaFill(position.id, fill.index, amountRaw, price, sig);
    if (!recorded?.ok) throw new Error(recorded?.error || "could not record the DCA fill");

    if (recorded.duplicate) {
      onEvent({ type: "DCA_DUPLICATE", position: position.id, level: fill.index, sig });
      return;
    }
    try {
      await recordTrade({
        privy_user_id: position.privyUserId, user_pubkey: position.userPubkey,
        group_id: position.groupId, mint: position.mint, side: "buy", sig, kind: "dca"
      });
    } catch (e) {
      onEvent({ type: "RECORD_ERROR", position: position.id, sig, error: e.message });
    }
    onEvent({
      type: "DCA_FILLED", position: position.id, mint: position.mint,
      level: fill.index, dropFraction: fill.dropFraction, sol: fill.buyAmountSol, sig
    });
  };

  /** Evaluate triggers and submit at most one exit. Only ever called with no pending exit. */
  const evaluate = async (position) => {
    const price = await getPrice(position.mint);
    if (!price) return;

    // Persist a new high BEFORE deciding. Trailing measures from this mark, and holding it
    // only in process memory would re-arm from a lower peak after any restart — selling
    // later than the user asked, which is the direction that costs them. The write is
    // monotonic in SQL and only happens on an actual new high, so a flat or falling market
    // costs nothing.
    if (price > position.peakMultiple * position.entryPriceUsd) {
      try {
        await recordPeak(position.id, price);
      } catch (e) {
        // A failed write is not a reason to skip the tick: `decideExit` floors the peak at
        // the current price anyway, so trailing still behaves correctly for this decision.
        onEvent({ type: "PEAK_ERROR", position: position.id, error: e.message });
      }
    }

    // DOLLAR-COST AVERAGING, decided before the exit.
    //
    // Order matters and this is the safe one. A DCA fill raises the average entry, so
    // evaluating it first means the exit decision that follows on the NEXT tick is measured
    // against the price the position actually averages. Deciding the exit first and then
    // buying would let a stop fire against an entry the fill was about to correct — selling
    // at a loss the user's own configuration was in the middle of preventing.
    //
    // At most one per tick, like exits: each needs its own confirmation round trip, and two
    // concurrent buys against the same daily cap is how a limit gets overspent.
    if (recordDcaFill) {
      const fill = decideDca({ position, price });
      if (fill) {
        try {
          await placeDca(position, fill, price);
        } catch (e) {
          // A failed DCA is not a reason to skip the exit evaluation below. The position is
          // still open, its stop still matters, and refusing to look at it because an
          // optional buy failed would be the more dangerous failure of the two.
          onEvent({ type: "DCA_ERROR", position: position.id, mint: position.mint, level: fill.index, error: e.message });
        }
        // Return either way. The fill changed amount_raw and entry_price_usd underneath this
        // in-memory row, so every exit threshold computed from it is now stale — and a stale
        // threshold is exactly what the volume-weighting exists to prevent. The next tick
        // reloads and decides against the real numbers.
        return;
      }
    }

    const decision = decideExit({ position, price });
    if (!decision) return;

    // A breach observation, not an exit. The clock lives on the row so it survives a restart;
    // recording it here rather than inside decideExit keeps that function pure and testable.
    if (decision.kind === null) {
      if (decision.stopBreach === "start" || decision.stopBreach === "clear") {
        try {
          await recordStopBreach(position.id, decision.stopBreach === "start");
          onEvent({ type: `STOP_BREACH_${decision.stopBreach.toUpperCase()}`, position: position.id, mult: decision.mult });
        } catch (e) {
          // A clock we could not write means the next tick re-observes the breach and tries
          // again. Failing to persist must not exit the position early.
          onEvent({ type: "STOP_BREACH_WRITE_ERROR", position: position.id, error: e.message });
        }
      }
      return;
    }

    // A level whose allocation rounds to zero tokens still has to be marked filled, or it
    // re-triggers every tick forever. Settle it as a no-op rather than sending a swap.
    if (decision.amountRaw <= BigInt(0)) {
      const claim = await claimExit(position.id, decision.kind, "0");
      if (!claim?.ok) return;
      await settleExit(position.id, claim.claim_token, {
        outcome: "confirmed", kind: decision.kind, amountRaw: position.amountRaw.toString(),
        status: "open", ...fillState(position, decision.kind), attempts: 0, error: null
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
      // Emergency exit, bounded. After two failed attempts a position that cannot sell at its
      // configured tolerance is stuck holding through its own stop loss — the exact outcome
      // the stop exists to prevent. Widening is opt-in, gradual, and capped.
      const attemptSlippageBps = exitSlippageBps({
        configuredBps: position.settings.slippageBps,
        attempts: position.attempts,
        emergencyExit: position.settings.emergencyExit
      });
      if (attemptSlippageBps !== position.settings.slippageBps) {
        onEvent({
          type: "EMERGENCY_EXIT_WIDENED", position: position.id, mint: position.mint,
          attempts: position.attempts, fromBps: position.settings.slippageBps, toBps: attemptSlippageBps
        });
      }
      const { tx, quotedAtMs } = await sellToken(
        position.mint, decision.amountRaw.toString(), position.userPubkey,
        attemptSlippageBps, position.settings.execution
      );
      if (quoteExpired({
        quotedAtMs, nowMs: Date.now(),
        quoteExpirationSeconds: position.settings.execution?.quoteExpirationSeconds
      })) {
        throw new Error("quote expired before submission");
      }
      // Simulated before signing, same as the entry. An exit that fails on chain costs the
      // priority fee and leaves the position open past its stop, which is the worst moment to
      // discover a route problem.
      const exitSimulation = await guardWithSimulation(tx, {
        required: position.settings.execution?.simulationRequired
      });
      if (!exitSimulation.ok) throw new Error(exitSimulation.reason);
      sig = await signAndSend(tx, position.walletId, {
        walletAddress: position.userPubkey,
        // An exit SELLS a token; it moves no bare SOL beyond wrapped-SOL account rent, so the
        // lamport ceiling stays at the policy default rather than being derived from a buy
        // amount that does not apply here.
        builtAtMs: quotedAtMs,
        maxAgeMs: position.settings.execution?.quoteExpirationSeconds
          ? position.settings.execution.quoteExpirationSeconds * 1000
          : undefined,
        idempotencyKey: `exit:${position.id}:${decision.kind}`
      });
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
          ...fillState(position, null),
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

module.exports = {
  startMonitor, takeProfitShare, decideExit, resolveExit, normalizePosition, executionPolicy,
  dcaPlan, decideDca,
  isProfitTarget, exitPlan, fillState, MAX_EXIT_ATTEMPTS,
  exitSlippageBps, EMERGENCY_SLIPPAGE_CAP_BPS
};
