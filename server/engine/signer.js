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

// walletId is the Privy embedded-wallet id (getSolanaWalletId on the client — stored with
// the order/subscription so the worker signs for the right wallet). base64Tx is Jupiter's
// unsigned swapTransaction (versioned).
async function signAndSend(base64Tx, walletId, net = "mainnet") {
  if (!walletId) throw new Error("missing walletId for delegated signing");
  const { VersionedTransaction } = require("@solana/web3.js");
  const transaction = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
  const res = await client().walletApi.solana.signAndSendTransaction({
    walletId,
    caip2: CAIP2[net] || CAIP2.mainnet,
    transaction
  });
  return res?.hash || res?.signature || res;
}

module.exports = { signAndSend, CAIP2 };
