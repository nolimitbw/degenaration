/**
 * Transaction confirmation for the automation worker.
 *
 * Privy's `signAndSendTransaction` returns a signature the moment the transaction is
 * SUBMITTED. Submission is not settlement: a swap can be submitted successfully and then
 * fail on chain for slippage, an expired blockhash, or an insufficient balance. Every
 * caller that treats the returned hash as "done" records a trade that never happened.
 *
 * This module resolves a submitted signature to a terminal verdict, and is deliberately
 * split into a pure classifier plus a thin async shell so the decision logic is testable
 * without a network or a validator.
 */
const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

/**
 * How long a submitted transaction can still be waiting before it is provably dead.
 *
 * A Solana transaction is only includable while its blockhash is within the last 150 slots
 * (~60-80s at mainnet cadence). Past that window the transaction can NEVER land, so a
 * signature that is still unknown to an RPC searching full transaction history is safe to
 * treat as failed and retry.
 *
 * 120s rather than 80s because the cost asymmetry is severe and one-directional: declaring
 * "expired" too early re-fires a sell that may still land, which sells a user's position
 * twice. Waiting an extra 40s costs one more poll. The margin is the safety.
 */
const EXPIRY_MS = 120_000;
const POLL_TIMEOUT_MS = 8_000;

/**
 * Pure: turn one `getSignatureStatuses` entry into a terminal-or-not verdict.
 *
 * `status` is the RPC's value for the signature: null when the network has never seen it,
 * otherwise `{ err, confirmationStatus }`.
 *
 * Returns one of:
 *   confirmed - landed, no error. The effect happened; apply it.
 *   failed    - landed with an error. The effect did NOT happen; safe to retry.
 *   expired   - never seen, and past the blockhash window. Can never land; safe to retry.
 *   pending   - not yet resolved. MUST NOT be retried, and MUST NOT be treated as done.
 *
 * `pending` is the important one: it is the state that blocks re-firing. Collapsing it into
 * either terminal verdict is precisely the double-sell / unenforced-stop-loss bug.
 */
function classifySignatureStatus({ status, elapsedMs, expiryMs = EXPIRY_MS }) {
  if (status && status.err) return "failed";
  if (status) {
    const level = status.confirmationStatus;
    if (level === "confirmed" || level === "finalized") return "confirmed";
    return "pending"; // "processed" is not durable — a processed tx can still be dropped.
  }
  // Never seen by an RPC that searched transaction history.
  return Number(elapsedMs) > Number(expiryMs) ? "expired" : "pending";
}

async function rpcCall(rpc, method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`rpc ${method} failed (${res.status})`);
  const body = await res.json();
  if (body.error) throw new Error(`rpc ${method} failed: ${body.error.message || "unknown"}`);
  return body.result;
}

/**
 * Resolve one submitted signature. `submittedAtMs` is when the transaction was sent, which
 * is what makes the expiry judgement possible — it cannot be derived from the chain.
 *
 * `searchTransactionHistory: true` is REQUIRED. Without it an RPC only checks its recent
 * status cache, so a confirmed-but-older signature reads as never-seen, and this function
 * would report `expired` for a sell that actually landed.
 */
async function confirmSignature(signature, { rpc = process.env.MAINNET_RPC || DEFAULT_RPC, submittedAtMs, nowMs = Date.now(), expiryMs = EXPIRY_MS } = {}) {
  const result = await rpcCall(rpc, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
  const status = result?.value?.[0] ?? null;
  const verdict = classifySignatureStatus({
    status,
    elapsedMs: nowMs - Number(submittedAtMs || nowMs),
    expiryMs
  });
  return { verdict, err: status?.err ?? null, slot: status?.slot ?? null };
}

/**
 * Pure: the raw token amount an owner actually received in a confirmed transaction.
 *
 * The quote's `outAmount` is an ESTIMATE — the realised fill differs by up to the slippage
 * tolerance. Persisting the estimate as the position size means every later sell is sized
 * against a number the wallet does not hold, and a sell of more than the balance fails.
 * The balance delta in the transaction metadata is what actually arrived.
 */
function tokenDeltaFromMeta(meta, owner, mint) {
  const pre = (meta?.preTokenBalances || []).filter((b) => b.owner === owner && b.mint === mint);
  const post = (meta?.postTokenBalances || []).filter((b) => b.owner === owner && b.mint === mint);
  const sum = (rows) => rows.reduce((total, b) => total + BigInt(b.uiTokenAmount?.amount || "0"), BigInt(0));
  const delta = sum(post) - sum(pre);
  return delta > BigInt(0) ? delta : BigInt(0);
}

/** Fetch a confirmed transaction and report what the owner actually received of `mint`. */
async function fetchReceivedAmount(signature, owner, mint, { rpc = process.env.MAINNET_RPC || DEFAULT_RPC } = {}) {
  const tx = await rpcCall(rpc, "getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }
  ]);
  if (!tx) return null;
  return tokenDeltaFromMeta(tx.meta, owner, mint);
}

module.exports = { classifySignatureStatus, confirmSignature, tokenDeltaFromMeta, fetchReceivedAmount, EXPIRY_MS };
