/**
 * Dollar-cost averaging: which level, if any, this position should buy right now.
 *
 * THE CONTROL THIS CLOSES, AND WHY IT WAS THE WORST OF THE UNENFORCED ONES
 *
 * `dca.enabled`, `dca.levels`, `dca.expirationMinutes` and `dca.maximumEntries` have been
 * persisted, validated, versioned and reloaded since the builder shipped, and nothing has ever
 * placed one. Unlike the other pending controls, this one already RESERVES THE USER'S MONEY:
 * `lib/planned-capital.js` adds every enabled level into the minimum planned capital the
 * builder tells them to fund. A bot with a 0.05 entry and two 0.25 levels asks for 0.55 SOL per
 * position and spends 0.05.
 *
 * Pure and synchronous, like `decideExit` beside it, so the whole decision table is testable in
 * the plain-node runner. The monitor owns the I/O.
 *
 * THE UNIT, STATED ONCE
 *
 * A level's `dropBps` is an ADDITIONAL drop below the position's average entry, not below the
 * previous level. 3000 bps means "30% under entry", so with two levels at 3000 and 5000 the
 * second fires at −50% from entry rather than at −30% of the already-dropped price. That is
 * what the builder's "Additional drop" label and its running capital total both mean, and
 * reading it the other way would place the second buy at −65% — a level the user never chose.
 *
 * This is the same class of error as the take-profit unit defect (a multiple read as a
 * percentage, liquidating at entry), so it is asserted rather than assumed.
 */

/** At most one DCA fill per position per tick. Each needs its own confirmation round trip. */
const MAX_PER_TICK = 1;

/**
 * The levels this position's configuration actually authorises.
 *
 * `BotBuilder.buildConfig()` persists a disabled level as ABSENT, so anything present here was
 * enabled at save time. The `enabled !== false` filter is belt-and-braces for a snapshot
 * written before that rule, and costs nothing.
 */
function dcaPlan(entryConfig) {
  const config = entryConfig && typeof entryConfig === "object" ? entryConfig : {};
  const dca = config.dca && typeof config.dca === "object" ? config.dca : null;

  // Absent is OFF here, unlike autoExit. A position opened before DCA existed was never having
  // levels placed, and reading a missing key as "on" would start spending money on a bot whose
  // owner never configured it — the one direction that is never recoverable.
  if (!dca || dca.enabled !== true) return { enabled: false, levels: [], expirationMinutes: 0, maximumEntries: 0 };

  const levels = (Array.isArray(dca.levels) ? dca.levels : [])
    .map((level, index) => ({
      index,
      dropFraction: Number(level?.dropBps ?? 0) / 10000,
      buyAmountSol: Number(level?.buyAmountSol ?? 0),
      enabled: level?.enabled !== false
    }))
    .filter((level) => level.enabled && level.dropFraction > 0 && level.buyAmountSol > 0)
    // Shallowest first. A price that has fallen past two levels at once fills the nearer one,
    // and the next tick considers the deeper — rather than skipping straight to the bottom and
    // leaving a level the user configured permanently unplaced.
    .sort((a, b) => a.dropFraction - b.dropFraction);

  const configuredMax = Math.floor(Number(dca.maximumEntries));
  return {
    enabled: true,
    levels,
    expirationMinutes: Math.max(0, Number(dca.expirationMinutes) || 0),
    // Absent means "as many as are configured", not zero. A zero cap would refuse every fill on
    // a bot whose owner never touched that field, which is the "absent is not zero" rule this
    // codebase has already been bitten by in the entry limits.
    maximumEntries: Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : levels.length
  };
}

/**
 * Decide the next DCA fill.
 *
 * Returns `{ index, dropFraction, buyAmountSol }` or null. `position` is the normalized shape
 * `monitor.normalizePosition` produces, plus `dca` (the plan), `filledDcaLevels` (a Set) and
 * `openedAtMs`.
 */
function decideDca({ position, price, nowMs = Date.now() }) {
  // THE BLOCKING INVARIANT, same as decideExit. An unresolved submitted exit means we do not
  // know what this position holds; buying into it would size the next exit off a stale balance.
  if (!position || position.pending) return null;
  if (position.status !== "open") return null;

  // Automatic entries off means no automated buying of any kind. A DCA fill is an entry, and a
  // user who switched entries off did not exempt the ones attached to a position they already
  // hold. Absent is ON, matching the claim's own reading of the same key.
  if (position.autoEntry === false) return null;
  if (position.killSwitch === true) return null;

  const plan = position.dca;
  if (!plan || !plan.enabled || plan.levels.length === 0) return null;

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(position.entryPriceUsd) || position.entryPriceUsd <= 0) return null;

  const filled = position.filledDcaLevels instanceof Set
    ? position.filledDcaLevels
    : new Set(Array.isArray(position.filledDcaLevels) ? position.filledDcaLevels.map(Number) : []);

  if (filled.size >= plan.maximumEntries) return null;

  // The window is anchored to the position OPENING, not to the last fill. Anchored to the last
  // fill it would extend itself every time it fired, and a bot in a long slow decline would
  // average down for ever — the opposite of what an expiry is for.
  if (plan.expirationMinutes > 0) {
    const openedAtMs = Number(position.openedAtMs);
    // An unknown opening time must not be treated as "just now": that would make an expired
    // window look fresh and keep buying. Refusing is the safe direction — the user loses a
    // fill they might have wanted, rather than getting one they had ruled out.
    if (!Number.isFinite(openedAtMs)) return null;
    if (nowMs - openedAtMs > plan.expirationMinutes * 60_000) return null;
  }

  // `dropFraction` is measured from the position's CURRENT average entry, which every earlier
  // fill has already raised. That is deliberate and it is self-limiting: each fill lifts the
  // average, so the next level's threshold moves up with it and the ladder cannot run away.
  const drop = 1 - price / position.entryPriceUsd;
  if (!(drop > 0)) return null;

  for (const level of plan.levels) {
    if (filled.has(level.index)) continue;
    if (drop >= level.dropFraction) {
      return { index: level.index, dropFraction: level.dropFraction, buyAmountSol: level.buyAmountSol };
    }
    // Levels are shallowest first, so the first unfilled level the price has not reached ends
    // the search: nothing deeper can be reachable.
    break;
  }
  return null;
}

module.exports = { dcaPlan, decideDca, MAX_PER_TICK };
