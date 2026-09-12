// Single source of truth for DegenAration fee and revenue allocation.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §13.
//
// All arithmetic is exact integer arithmetic on BigInt lamports. Never use
// floating-point math for anything that reaches a ledger, a receipt, or a payout.
// BigInt is constructed via BigInt(...) rather than `n` literals because the
// TypeScript target is es2017.

const BPS_DENOMINATOR = 10000;
const LAMPORTS_PER_SOL = 1000000000;

// User-facing platform execution fee: 2.00% of confirmed executed notional per swap leg.
const PLATFORM_FEE_BPS = 200;

// Creator commissions are funded FROM the platform fee, never added on top of it.
const DISCORD_CREATOR_BPS = 70;
const KOL_CREATOR_BPS = 20;

// Referral reward is a share of the COLLECTED PLATFORM FEE, not of trade volume.
const REFERRAL_SHARE_BPS_OF_PLATFORM_FEE = 1000; // 10% of the collected fee

const ZERO = BigInt(0);

/**
 * Coerce to a non-negative integer BigInt lamport amount.
 * Rejects floats, negatives, NaN, and non-integral input rather than silently rounding.
 */
function toLamports(value) {
  if (typeof value === "bigint") {
    if (value < ZERO) throw new RangeError("lamports must be non-negative");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("lamports must be finite");
    if (!Number.isInteger(value)) throw new RangeError("lamports must be an integer; received a fractional value");
    if (value < 0) throw new RangeError("lamports must be non-negative");
    if (!Number.isSafeInteger(value)) throw new RangeError("lamports exceeds safe integer range; pass a BigInt or string");
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!/^\d+$/.test(value.trim())) throw new RangeError("lamports string must be a non-negative integer");
    return BigInt(value.trim());
  }
  throw new TypeError("lamports must be a bigint, integer number, or integer string");
}

function assertBps(bps, label) {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new RangeError((label || "bps") + " must be an integer between 0 and " + BPS_DENOMINATOR);
  }
}

/**
 * floor(amount * bps / 10000) in exact integer arithmetic.
 * Flooring is the defined rounding policy; the remainder is retained by the platform
 * so that every allocation set sums back to the collected fee exactly.
 */
function bpsOf(amountLamports, bps) {
  assertBps(bps);
  const amount = toLamports(amountLamports);
  return (amount * BigInt(bps)) / BigInt(BPS_DENOMINATOR);
}

/**
 * The fee actually charged given server configuration.
 * Fees stay off until the owner supplies PLATFORM_FEE_ACCOUNT (see OPEN_BLOCKERS B-1).
 */
function configuredPlatformFeeBps(env) {
  const source = env || (typeof process !== "undefined" ? process.env : {}) || {};
  return source.PLATFORM_FEE_ACCOUNT ? PLATFORM_FEE_BPS : 0;
}

/** Creator allocation rate, in bps of executed notional, funded from the platform fee. */
function creatorBpsFor(sourceKind) {
  if (sourceKind === "discord") return DISCORD_CREATOR_BPS;
  if (sourceKind === "kol") return KOL_CREATOR_BPS;
  return 0;
}

/**
 * Split one confirmed swap leg's platform fee into its ledger components.
 *
 * Invariant (spec §13.3): creator + referral + retained === platformFee, exactly.
 * Any flooring remainder is absorbed by the retained amount, so the ledger balances.
 *
 * @returns {{platformFeeLamports: bigint, creatorLamports: bigint,
 *            referralLamports: bigint, retainedLamports: bigint,
 *            platformFeeBps: number, creatorBps: number, referralShareBps: number}}
 */
function allocatePlatformFee(options) {
  const opts = options || {};
  const notional = toLamports(opts.notionalLamports);
  const feeBps = opts.feeBps == null ? PLATFORM_FEE_BPS : opts.feeBps;
  assertBps(feeBps, "feeBps");

  const platformFeeLamports = bpsOf(notional, feeBps);

  // No fee collected means nothing to allocate. Never pay a creator or referrer out of
  // revenue that was not charged.
  if (platformFeeLamports === ZERO) {
    return {
      platformFeeLamports: ZERO,
      creatorLamports: ZERO,
      referralLamports: ZERO,
      retainedLamports: ZERO,
      platformFeeBps: feeBps,
      creatorBps: 0,
      referralShareBps: 0
    };
  }

  const creatorBps = creatorBpsFor(opts.sourceKind);
  let creatorLamports = bpsOf(notional, creatorBps);

  // A creator can never be allocated more than the fee that was actually collected.
  if (creatorLamports > platformFeeLamports) creatorLamports = platformFeeLamports;

  const referralShareBps = opts.referralEligible ? REFERRAL_SHARE_BPS_OF_PLATFORM_FEE : 0;
  let referralLamports = bpsOf(platformFeeLamports, referralShareBps);

  // Referral is funded from the DegenAration-retained share, never from the creator's.
  const availableForReferral = platformFeeLamports - creatorLamports;
  if (referralLamports > availableForReferral) referralLamports = availableForReferral;

  const retainedLamports = platformFeeLamports - creatorLamports - referralLamports;

  return {
    platformFeeLamports,
    creatorLamports,
    referralLamports,
    retainedLamports,
    platformFeeBps: feeBps,
    creatorBps,
    referralShareBps
  };
}

/** True when an allocation sums exactly back to the collected fee. */
function isBalancedAllocation(allocation) {
  if (!allocation) return false;
  const sum = allocation.creatorLamports + allocation.referralLamports + allocation.retainedLamports;
  return sum === allocation.platformFeeLamports;
}

/** Display helper. Never feed this back into ledger math. */
function lamportsToSolString(lamports, decimals) {
  const value = toLamports(lamports);
  const places = decimals == null ? 9 : decimals;
  const whole = value / BigInt(LAMPORTS_PER_SOL);
  const frac = value % BigInt(LAMPORTS_PER_SOL);
  const fracText = frac.toString().padStart(9, "0").slice(0, places);
  return places > 0 ? whole.toString() + "." + fracText : whole.toString();
}

/** `2.00%` style label for a bps rate. */
function formatBpsPercent(bps) {
  assertBps(bps);
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return whole + "." + String(frac).padStart(2, "0") + "%";
}

module.exports = {
  BPS_DENOMINATOR,
  LAMPORTS_PER_SOL,
  PLATFORM_FEE_BPS,
  DISCORD_CREATOR_BPS,
  KOL_CREATOR_BPS,
  REFERRAL_SHARE_BPS_OF_PLATFORM_FEE,
  toLamports,
  bpsOf,
  configuredPlatformFeeBps,
  creatorBpsFor,
  allocatePlatformFee,
  isBalancedAllocation,
  lamportsToSolString,
  formatBpsPercent
};
