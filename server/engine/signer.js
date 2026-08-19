/**
 * Delegated signing via Privy server SDK. Signs AND sends a Jupiter swap tx using the
 * user's DELEGATED embedded wallet — the user's keys never leave Privy, and the delegation
 * is trade-only, spend-capped, and revocable (granted in the app via components/AutoTrade).
 *
 * PREREQUISITES (all yours to set):
 *   - Enable session signers / delegated actions in the Privy dashboard.
 *   - User grants delegation (AutoTrade toggle on /wallet).
 *   - PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_KEY in the worker's environment.
 *
 * Verified against @privy-io/server-auth 1.32.x: walletApi.solana.signAndSendTransaction
 * takes a DESERIALIZED VersionedTransaction (the SDK serializes it internally) plus caip2 +
 * walletId, and returns { hash, caip2 }. Jupiter returns versioned txs, so we deserialize the
 * base64 swapTransaction into a VersionedTransaction before handing it off.
 *
 * ON THE AUTHORIZATION KEY: Privy rejects a wallet-API request whose authorization signature
 * it cannot verify, with "No valid authorization signatures were provided". Seen in
 * production. The SDK produces no signature at all when authorizationPrivateKey is empty, and
 * an unverifiable one when the value is subtly wrong — a dashboard paste that lost the
 * `wallet-auth:` prefix, kept surrounding quotes, or picked up a trailing newline. Both look
 * identical from the outside: signing reports healthy and every trade fails. So the key is
 * normalized here, and anything unusable is refused at startup rather than per trade.
 */
const AUTH_KEY_PREFIX = "wallet-auth:";

/**
 * Accept the key in the shapes people actually paste, and reject what cannot work.
 * Returns the canonical `wallet-auth:...` string, or null when there is nothing usable.
 */
function normalizeAuthorizationKey(raw) {
  if (typeof raw !== "string") return null;

  // Shell exports and dashboard fields both leak surrounding quotes and stray newlines.
  let key = raw.trim().replace(/^['"]|['"]$/g, "").trim();
  // A key pasted through a .env file often arrives with the newline escaped rather than real.
  key = key.replace(/\\n/g, "").replace(/\s+/g, "");
  if (!key) return null;

  if (key.startsWith(AUTH_KEY_PREFIX)) {
    const body = key.slice(AUTH_KEY_PREFIX.length);
    return body ? AUTH_KEY_PREFIX + body : null;
  }

  // A bare PKCS#8 key: DER-encoded EC private keys base64 to something starting MIG/MII.
  // The prefix is what Privy's SDK expects, so restore it rather than failing the operator
  // for a detail the dashboard does not make obvious.
  if (/^MI[A-Za-z0-9+/=]+$/.test(key)) return AUTH_KEY_PREFIX + key;

  return null;
}

const CAIP2 = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
};

/**
 * What the worker needs before it can sign anything. Called at startup so a misconfigured
 * key is a boot failure with a named cause, not a silent stream of failed trades.
 * Returns the list of problems; empty means ready.
 */
function signingConfigProblems(env = process.env) {
  const problems = [];
  if (!String(env.PRIVY_APP_ID || "").trim()) problems.push("PRIVY_APP_ID is not set");
  if (!String(env.PRIVY_APP_SECRET || "").trim()) problems.push("PRIVY_APP_SECRET is not set");

  const raw = env.PRIVY_AUTHORIZATION_KEY;
  if (!String(raw || "").trim()) {
    problems.push("PRIVY_AUTHORIZATION_KEY is not set — Privy will reject every trade with 'No valid authorization signatures were provided'");
  } else if (!normalizeAuthorizationKey(raw)) {
    problems.push("PRIVY_AUTHORIZATION_KEY is not a usable key — it must be the value Privy shows, starting with 'wallet-auth:'");
  }
  return problems;
}

let _privy = null;
function client() {
  if (_privy) return _privy;
  const problems = signingConfigProblems();
  if (problems.length) throw new Error(`delegated signing is misconfigured: ${problems.join("; ")}`);

  const { PrivyClient } = require("@privy-io/server-auth");
  _privy = new PrivyClient(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET, {
    walletApi: { authorizationPrivateKey: normalizeAuthorizationKey(process.env.PRIVY_AUTHORIZATION_KEY) }
  });
  return _privy;
}

function resolveCaip2(net) {
  if (!Object.hasOwn(CAIP2, net)) throw new Error("explicit worker network required for delegated signing");
  return CAIP2[net];
}

/**
 * Privy's own wording for a rejected signature does not say which of the several possible
 * causes applies, and it is the message an operator sees first. Name the causes so the fix
 * is a dashboard check rather than a guess.
 */
function describeSigningError(error) {
  const message = String(error?.message || error || "");
  if (!/authorization signature/i.test(message)) return error;
  return new Error(
    `${message} | Privy rejected the worker's authorization signature. Check, in order: ` +
    `PRIVY_AUTHORIZATION_KEY is the private key Privy shows (starts with 'wallet-auth:'); ` +
    `PRIVY_APP_ID is the app that owns these wallets; ` +
    `the key is still listed under the app's authorization keys; ` +
    `the wallet's signer quorum includes it.`
  );
}

// walletId is the Privy embedded-wallet id (getSolanaWalletId on the client — stored with
// the order/subscription so the worker signs for the right wallet). base64Tx is Jupiter's
// unsigned swapTransaction (versioned).
async function signAndSend(base64Tx, walletId, net) {
  if (!walletId) throw new Error("missing walletId for delegated signing");
  const caip2 = resolveCaip2(net);
  const { VersionedTransaction } = require("@solana/web3.js");
  const transaction = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
  let res;
  try {
    res = await client().walletApi.solana.signAndSendTransaction({ walletId, caip2, transaction });
  } catch (e) {
    throw describeSigningError(e);
  }
  return res?.hash || res?.signature || res;
}

module.exports = {
  signAndSend, resolveCaip2, CAIP2,
  normalizeAuthorizationKey, signingConfigProblems, describeSigningError
};
