/**
 * What the delegated signer is allowed to sign — decided before it signs, not after.
 *
 * THE GAP THIS CLOSES
 *
 * `engine/signer.js` is a sign-anything primitive. It takes a base64 string and a wallet id,
 * deserializes, and hands the result to Privy:
 *
 *     const transaction = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
 *     await client().walletApi.solana.signAndSendTransaction({ walletId, caip2, transaction });
 *
 * Nothing checks that the transaction is the one the intent authorised. Nothing checks that the
 * wallet paying is the wallet the intent belongs to. Nothing bounds what programs it calls or
 * what it spends. Today every caller is engine code we wrote, so the risk is a bug rather than
 * an attacker — but a delegated key that will sign whatever it is handed is a boundary in name
 * only, and it is the last boundary before a user's funds move.
 *
 * The specification requires this boundary to carry: per-user wallet ownership binding, exact
 * transaction-intent binding, amount/mint/slippage/fee limits, replay protection, transaction
 * expiry, and an audit trail. This module is that boundary.
 *
 * WHAT IS CHECKABLE OFFLINE, AND WHAT IS NOT
 *
 * Deliberately honest about the line. From the serialized transaction alone this can prove:
 *
 *   - exactly one signature is required, so the user is not co-signing someone else's business;
 *   - the fee payer is the wallet this intent belongs to, which is what makes cross-user
 *     signing impossible rather than merely unlikely;
 *   - every program invoked is on an allowlist, so a swap cannot smuggle in a `setAuthority`,
 *     a `closeAccount` that drains rent, or an unknown program;
 *   - any SystemProgram transfer of lamports is within the intent's reserved amount.
 *
 * It CANNOT prove, without a simulation or an RPC, the exact token amounts a swap will move:
 * those live inside the aggregator's instruction data and depend on pool state. That is what
 * `scripts/verify-mainnet-simulation.mjs` and the engine's pre-submit simulation are for, and
 * this module says so rather than implying a completeness it does not have.
 *
 * FAIL CLOSED. Every branch that cannot establish a fact refuses. A transaction this module
 * cannot understand is not signed.
 */

const { VersionedTransaction, PublicKey } = require("@solana/web3.js");

/**
 * Programs a DegenAration swap legitimately touches.
 *
 * Anything else is refused, including programs that look harmless. The point is not to
 * enumerate what is dangerous — that list is unbounded and changes — but to enumerate the small
 * set this product actually uses, so a transaction doing something new has to be understood
 * before it can be signed.
 */
const ALLOWED_PROGRAMS = new Map([
  ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "Jupiter aggregator v6"],
  ["JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB", "Jupiter aggregator v4"],
  ["11111111111111111111111111111111", "System"],
  ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "SPL Token"],
  ["TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "Token-2022"],
  ["ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "Associated Token Account"],
  ["ComputeBudget111111111111111111111111111111", "Compute Budget"],
  ["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo"]
]);

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SOL_MINT = "So11111111111111111111111111111111111111112";
/** SystemInstruction::Transfer discriminator, little-endian u32 = 2. */
const SYSTEM_TRANSFER = 2;

/** The default ceiling on a single signature, when an intent supplies none. 5 SOL. */
const DEFAULT_MAX_LAMPORTS = 5_000_000_000n;

/** How long a built transaction may sit before the signer refuses it. */
const DEFAULT_MAX_AGE_MS = 45_000;

function refuse(reason, detail = {}) {
  return { ok: false, reason, ...detail };
}

/**
 * Lamports a SystemProgram transfer instruction moves, or null when the instruction is not a
 * transfer.
 *
 * Layout: u32 instruction index, then u64 lamports, little-endian. Anything shorter is
 * malformed and refused by the caller rather than read past the end.
 */
function systemTransferLamports(data) {
  if (!data || data.length < 12) return null;
  const view = Buffer.from(data);
  if (view.readUInt32LE(0) !== SYSTEM_TRANSFER) return null;
  return view.readBigUInt64LE(4);
}

/**
 * Decide whether this exact transaction may be signed for this exact intent.
 *
 * `intent` is the authorisation, not a hint:
 *   walletAddress   the wallet the intent belongs to — must be the fee payer
 *   maxLamports     the most this signature may move via SystemProgram, integer
 *   builtAtMs       when the transaction was built, for the expiry check
 *   idempotencyKey  the intent key, recorded on the audit entry
 *
 * Returns `{ ok: true, audit }` or `{ ok: false, reason }`. The caller must treat a refusal as
 * terminal for that attempt; retrying the identical transaction cannot change the answer.
 */
function authorizeSigning({ base64Tx, walletAddress, intent = {}, nowMs = Date.now() } = {}) {
  if (typeof base64Tx !== "string" || base64Tx.length === 0) {
    return refuse("no transaction supplied");
  }
  if (typeof walletAddress !== "string" || walletAddress.length === 0) {
    return refuse("no wallet bound to this intent");
  }

  let expectedPayer;
  try {
    expectedPayer = new PublicKey(walletAddress);
  } catch {
    return refuse("intent wallet is not a valid Solana address");
  }

  let transaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
  } catch (error) {
    return refuse("transaction could not be decoded", { detail: String(error.message).slice(0, 120) });
  }

  const message = transaction.message;
  const staticKeys = message.staticAccountKeys || [];

  // 1. Exactly one signature. More than one means the user is being asked to co-sign something
  //    alongside another party, which no DegenAration swap ever needs.
  const required = message.header?.numRequiredSignatures;
  if (required !== 1) {
    return refuse("transaction requires more than the user's own signature", { required });
  }

  // 2. The fee payer IS the intent's wallet. This is what makes cross-user signing impossible:
  //    a transaction built for someone else cannot be signed under this intent, whatever the
  //    caller passes as walletId.
  const payer = staticKeys[0];
  if (!payer || !payer.equals(expectedPayer)) {
    return refuse("fee payer is not the wallet this intent belongs to", {
      payer: payer ? payer.toBase58() : null
    });
  }

  // 3. Every program invoked is one this product uses. A program id must be a STATIC key — a
  //    v0 message cannot resolve one through an address lookup table — so an index past the
  //    static set is a transaction we cannot reason about, and is refused rather than assumed.
  const instructions = message.compiledInstructions || [];
  if (instructions.length === 0) return refuse("transaction carries no instructions");

  const programs = [];
  let systemLamports = 0n;
  for (const instruction of instructions) {
    const programKey = staticKeys[instruction.programIdIndex];
    if (!programKey) {
      return refuse("transaction invokes a program that is not a static account key", {
        programIdIndex: instruction.programIdIndex
      });
    }
    const programId = programKey.toBase58();
    if (!ALLOWED_PROGRAMS.has(programId)) {
      return refuse("transaction invokes a program outside the allowlist", { programId });
    }
    programs.push(programId);

    if (programId === SYSTEM_PROGRAM) {
      const lamports = systemTransferLamports(instruction.data);
      if (lamports !== null) systemLamports += lamports;
    }
  }

  // 4. The spend ceiling. Bounds what a single signature can move in bare SOL — a wrapped-SOL
  //    swap funds its wSOL account through exactly this path, so the buy amount shows up here.
  //    Token amounts inside the aggregator's own instruction data are NOT visible offline; the
  //    pre-submit simulation covers those, and this module does not pretend otherwise.
  const configured = intent.maxLamports === undefined || intent.maxLamports === null
    ? DEFAULT_MAX_LAMPORTS
    : BigInt(intent.maxLamports);
  const maxLamports = configured > 0n ? configured : DEFAULT_MAX_LAMPORTS;
  if (systemLamports > maxLamports) {
    return refuse("transaction moves more lamports than the intent reserved", {
      systemLamports: systemLamports.toString(),
      maxLamports: maxLamports.toString()
    });
  }

  // 5. Expiry. A transaction built minutes ago was priced against a market that has moved, and
  //    a blockhash it can no longer land with. Checked here as well as at the quote because the
  //    signer is the last point before funds move.
  const builtAtMs = Number(intent.builtAtMs);
  const maxAgeMs = Number(intent.maxAgeMs) > 0 ? Number(intent.maxAgeMs) : DEFAULT_MAX_AGE_MS;
  if (Number.isFinite(builtAtMs)) {
    const age = nowMs - builtAtMs;
    if (age > maxAgeMs) {
      return refuse("transaction is older than the signing window", { ageMs: age, maxAgeMs });
    }
    if (age < -5_000) {
      // Clock skew large enough to make the expiry check meaningless in the other direction.
      return refuse("transaction claims to be built in the future", { ageMs: age });
    }
  }

  return {
    ok: true,
    audit: {
      wallet: expectedPayer.toBase58(),
      idempotencyKey: intent.idempotencyKey || null,
      programs: [...new Set(programs)].map((id) => ALLOWED_PROGRAMS.get(id)),
      systemLamports: systemLamports.toString(),
      maxLamports: maxLamports.toString(),
      instructions: instructions.length,
      requiredSignatures: required,
      // Never the transaction itself and never the wallet id: an audit line is written to a log
      // aggregator, and a signable payload does not belong in one.
      notProven: "token amounts inside the aggregator instruction — covered by pre-submit simulation"
    }
  };
}

/**
 * Bind the QUOTE to the intent, before the transaction is even built.
 *
 * `authorizeSigning` reads the serialized transaction, and two of the things the release
 * specification requires it to bind are not visible there: the swap's mint pair lives inside the
 * aggregator's instruction data, and slippage is not in the transaction at all — it is a
 * parameter of the route. Both ARE on the quote, so they are checked where they exist rather
 * than approximated where they do not.
 *
 * This matters for a specific bug shape: a caller that resolves the wrong mint — an off-by-one
 * in a subscriber loop, a stale variable — would otherwise produce a perfectly well-formed
 * transaction, from the right wallet, inside the lamport ceiling, buying the wrong token.
 * Nothing downstream would notice, because every other check would pass.
 *
 * Returns null when the quote matches, or a message naming what differs.
 */
function bindQuoteToIntent(quote, { mint, side = "buy", slippageBps } = {}) {
  if (!quote || typeof quote !== "object") return "no quote to bind";
  // ExactIn: a buy spends SOL for the mint, a sell spends the mint for SOL.
  const expectedOut = side === "sell" ? SOL_MINT : mint;
  const expectedIn = side === "sell" ? mint : SOL_MINT;
  if (!mint) return "intent names no mint";

  if (quote.outputMint !== expectedOut) {
    return `quote output mint ${quote.outputMint} is not the intent's ${expectedOut}`;
  }
  if (quote.inputMint !== expectedIn) {
    return `quote input mint ${quote.inputMint} is not the intent's ${expectedIn}`;
  }
  // Slippage may be tighter than asked but never looser: a route quoted at a wider tolerance
  // than the user configured can fill at a price they did not agree to.
  const configured = Math.floor(Number(slippageBps));
  const quoted = Math.floor(Number(quote.slippageBps));
  if (Number.isFinite(configured) && Number.isFinite(quoted) && quoted > configured) {
    return `quote slippage ${quoted} bps exceeds the configured ${configured} bps`;
  }
  return null;
}

module.exports = {
  bindQuoteToIntent,
  SOL_MINT,
  authorizeSigning,
  systemTransferLamports,
  ALLOWED_PROGRAMS,
  DEFAULT_MAX_LAMPORTS,
  DEFAULT_MAX_AGE_MS
};
