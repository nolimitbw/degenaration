// User principal withdrawal rules.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §12.
//
// DegenAration is non-custodial: funds sit in user-owned wallets (Privy embedded or an
// external connected wallet), never in a platform account. A withdrawal is therefore an
// ordinary transfer that the USER signs. There is no custodial queue, no routine admin
// approval, and no per-user unlock flag — those would misrepresent the wallet model.
//
// Everything here is pure integer arithmetic on BigInt lamports so it can be tested
// without a chain or a database.

const LAMPORTS_PER_SOL = 1000000000;

// A SOL account must retain the rent-exempt minimum or the transfer fails on-chain.
const RENT_EXEMPT_RESERVE_LAMPORTS = BigInt(890880);

// Base signature fee (5000) plus headroom for a priority fee.
const NETWORK_FEE_RESERVE_LAMPORTS = BigInt(15000);

const REQUIRED_RESERVE_LAMPORTS = RENT_EXEMPT_RESERVE_LAMPORTS + NETWORK_FEE_RESERVE_LAMPORTS;

const ZERO = BigInt(0);

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Solana addresses are base58 and exclude 0, O, I, and l. */
function isSolanaAddress(value) {
  return typeof value === "string" && BASE58.test(value.trim());
}

function toLamports(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isFinite(value)) throw new RangeError("lamports must be an integer");
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new TypeError("lamports must be a bigint, integer number, or integer string");
}

/**
 * How much the user may actually move right now.
 * Locked capital is SOL committed to open positions; it is not spendable but it is also
 * not confiscated — it becomes spendable when the position closes.
 */
function spendableLamports(input) {
  const balance = toLamports((input && input.balanceLamports) || 0);
  // Floor the deductions at zero. A negative `locked` or `pending` would SUBTRACT A
  // NEGATIVE and inflate the spendable figure — verified: balance 1 SOL with locked
  // -1 SOL reported ~2 SOL spendable, and validateWithdrawal then approved a 1.5 SOL
  // withdrawal against a 1 SOL balance. The chain would reject that transfer, but this
  // module exists precisely to bound what can move, so it must not approve it.
  //
  // These values come from the database, so this guards an accounting bug or a reversal
  // race rather than a hostile caller — which is exactly when a silent over-approval is
  // hardest to notice.
  const locked = atLeastZero(toLamports((input && input.lockedLamports) || 0));
  const pending = atLeastZero(toLamports((input && input.pendingWithdrawalLamports) || 0));
  const free = balance - locked - pending - REQUIRED_RESERVE_LAMPORTS;
  if (free <= ZERO) return ZERO;
  // Never spendable beyond what the account actually holds, whatever the inputs claim.
  const ceiling = balance - REQUIRED_RESERVE_LAMPORTS;
  if (ceiling <= ZERO) return ZERO;
  return free < ceiling ? free : ceiling;
}

function atLeastZero(value) {
  return value > ZERO ? value : ZERO;
}

/** Amount for a 25 / 50 / 75 / 100 percent selector, floored to whole lamports. */
function percentOfSpendable(spendable, percent) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError("percent must be an integer between 0 and 100");
  }
  const value = toLamports(spendable);
  return (value * BigInt(percent)) / BigInt(100);
}

/**
 * Validate a requested withdrawal.
 *
 * Balances MUST come from an authoritative server-side source. Never pass a
 * client-supplied balance into this function (§12.5).
 *
 * @returns {{ok: true, amountLamports: bigint, spendableLamports: bigint}
 *          | {ok: false, code: string, message: string, lockedLamports?: bigint}}
 */
function validateWithdrawal(input) {
  const req = input || {};

  if (!isSolanaAddress(req.destination)) {
    return { ok: false, code: "invalid-destination", message: "Enter a valid Solana address." };
  }
  if (!isSolanaAddress(req.owner)) {
    return { ok: false, code: "invalid-owner", message: "Connect a wallet to withdraw." };
  }
  if (req.destination.trim() === req.owner.trim()) {
    return { ok: false, code: "same-address", message: "Choose a destination other than this wallet." };
  }

  let amount;
  try {
    amount = toLamports(req.amountLamports);
  } catch {
    return { ok: false, code: "invalid-amount", message: "Enter a valid amount." };
  }
  if (amount <= ZERO) {
    return { ok: false, code: "invalid-amount", message: "Enter an amount greater than zero." };
  }

  const balance = toLamports(req.balanceLamports || 0);
  const locked = toLamports(req.lockedLamports || 0);
  const spendable = spendableLamports(req);

  // A zero balance is a validation state, never a disabled feature (§12.4).
  if (balance <= ZERO) {
    return { ok: false, code: "zero-balance", message: "This wallet has no SOL to withdraw." };
  }
  if (spendable <= ZERO && locked > ZERO) {
    return {
      ok: false,
      code: "locked-capital",
      lockedLamports: locked,
      message: `${lamportsToSol(locked)} SOL is committed to open positions. It becomes available when those positions close.`
    };
  }
  if (spendable <= ZERO) {
    return {
      ok: false,
      code: "below-reserve",
      message: `A balance of ${lamportsToSol(REQUIRED_RESERVE_LAMPORTS)} SOL must stay in the account for rent and network fees.`
    };
  }
  if (amount > spendable) {
    return {
      ok: false,
      code: "exceeds-spendable",
      lockedLamports: locked,
      message: locked > ZERO
        ? `Available to withdraw is ${lamportsToSol(spendable)} SOL. ${lamportsToSol(locked)} SOL is committed to open positions.`
        : `Available to withdraw is ${lamportsToSol(spendable)} SOL after the rent and network fee reserve.`
    };
  }

  return { ok: true, amountLamports: amount, spendableLamports: spendable };
}

/** Display helper. Never feed the result back into ledger or validation math. */
function lamportsToSol(lamports, decimals) {
  const value = toLamports(lamports);
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  const places = decimals == null ? 4 : decimals;
  const whole = abs / BigInt(LAMPORTS_PER_SOL);
  const frac = abs % BigInt(LAMPORTS_PER_SOL);
  const fracText = frac.toString().padStart(9, "0").slice(0, places);
  const text = places > 0 ? `${whole}.${fracText}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/**
 * Stable key for a withdrawal attempt.
 *
 * NOT ENFORCED ANYWHERE YET. The route returns this in its response and nothing consumes
 * it — there is no server-side store of used keys, so it currently prevents nothing. The
 * comment here previously claimed it stopped a retry creating a second transfer; it does
 * not, and a claim that reads as protection is worse than no claim.
 *
 * What actually prevents a double withdrawal today: the modal disables its submit button
 * while a request is in flight, and the user must approve every transaction in their own
 * wallet — the server holds no keys and can move nothing on its own.
 *
 * To make this real, a used-key table would be needed, plus a per-attempt `requestId` from
 * the client (absent today, so two deliberate identical withdrawals would otherwise collide
 * on the same key and the second would be refused).
 */
function withdrawalIdempotencyKey(input) {
  const req = input || {};
  return [
    "withdraw",
    String(req.owner || "").trim(),
    String(req.destination || "").trim(),
    String(req.amountLamports || "0"),
    String(req.requestId || "").trim()
  ].join(":");
}

module.exports = {
  LAMPORTS_PER_SOL,
  RENT_EXEMPT_RESERVE_LAMPORTS,
  NETWORK_FEE_RESERVE_LAMPORTS,
  REQUIRED_RESERVE_LAMPORTS,
  isSolanaAddress,
  toLamports,
  spendableLamports,
  percentOfSpendable,
  validateWithdrawal,
  lamportsToSol,
  withdrawalIdempotencyKey
};
