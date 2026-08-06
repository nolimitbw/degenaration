/**
 * Delegated signing via Privy server SDK. Signs AND sends a Jupiter swap tx using the
 * user's DELEGATED embedded wallet — the user's keys never leave Privy, and the delegation
 * is trade-only, spend-capped, and revocable (granted in the app via components/AutoTrade).
 *
 * PREREQUISITES (all yours to set):
 *   - Enable session signers / delegated actions in the Privy dashboard.
 *   - User grants delegation (AutoTrade toggle on /wallet).
 *   - PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_KEY in server/.env.
 *
 * Verified against @privy-io/server-auth 1.32.x: walletApi.solana.signAndSendTransaction
 * takes a DESERIALIZED VersionedTransaction (the SDK serializes it internally) plus caip2 +
 * walletId, and returns { hash, caip2 }. Jupiter returns versioned txs, so we deserialize the
 * base64 swapTransaction into a VersionedTransaction before handing it off.
 */
const { authorizeSigning } = require("./signer-policy");

const CAIP2 = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
};

let _privy = null;
function client() {
  if (_privy) return _privy;
  const { PrivyClient } = require("@privy-io/server-auth");
  _privy = new PrivyClient(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET, {
    walletApi: { authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_KEY }
  });
  return _privy;
}

function resolveCaip2(net) {
  if (!Object.hasOwn(CAIP2, net)) throw new Error("explicit worker network required for delegated signing");
  return CAIP2[net];
}

// walletId is the Privy embedded-wallet id (getSolanaWalletId on the client — stored with
// the order/subscription so the worker signs for the right wallet). base64Tx is Jupiter's
// unsigned swapTransaction (versioned).
/**
 * `intent` is the authorisation this signature is bound to, and it is REQUIRED.
 *
 * This function used to take a base64 string and sign it. A delegated key that signs whatever
 * it is handed is a boundary in name only, and it is the last one before a user's funds move —
 * so the policy in engine/signer-policy.js runs here rather than in the callers. Putting it in
 * the callers would mean every future caller has to remember, and one that forgets gets the old
 * behaviour silently.
 *
 * A refusal throws. It is terminal for that attempt: the same transaction cannot become
 * authorised by being retried.
 */
async function signAndSend(base64Tx, walletId, net, intent = {}) {
  if (!walletId) throw new Error("missing walletId for delegated signing");
  const caip2 = resolveCaip2(net);

  const verdict = authorizeSigning({
    base64Tx,
    walletAddress: intent.walletAddress,
    intent
  });
  if (!verdict.ok) {
    throw new Error(`signing refused: ${verdict.reason}`);
  }
  // The audit line, before the signature exists. Recording it afterwards would lose exactly the
  // case worth having: a signature that was authorised and then failed to send.
  console.log("[signer] authorized", JSON.stringify(verdict.audit));

  const { VersionedTransaction } = require("@solana/web3.js");
  const transaction = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
  const res = await client().walletApi.solana.signAndSendTransaction({
    walletId,
    caip2,
    transaction
  });
  return res?.hash || res?.signature || res;
}

module.exports = { signAndSend, resolveCaip2, CAIP2, authorizeSigning };
