/**
 * Delegated signing via Privy server SDK. Signs AND sends a base64 transaction using the
 * user's DELEGATED embedded wallet — the user's keys never leave Privy, and the delegation
 * is trade-only, spend-capped, and revocable (granted in the app via components/AutoTrade).
 *
 * PREREQUISITES (all yours to set):
 *   - Enable session signers / delegated actions in the Privy dashboard.
 *   - User grants delegation (AutoTrade toggle on /wallet).
 *   - PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_KEY in server/.env.
 *
 * NOT runtime-verified in this repo (no delegated wallet available here). The exact
 * walletApi shape can vary by @privy-io/server-auth version — verify against your installed
 * version + https://docs.privy.io/guide/delegated-actions/usage/solana and TEST ON DEVNET
 * with tiny amounts before enabling on mainnet.
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

// walletId is the Privy embedded-wallet id (user.wallet.id on the client — store it with
// the order/subscription so the worker can sign for the right wallet).
async function signAndSend(base64Tx, walletId, net = "mainnet") {
  if (!walletId) throw new Error("missing walletId for delegated signing");
  const res = await client().walletApi.solana.signAndSendTransaction({
    walletId,
    caip2: CAIP2[net] || CAIP2.mainnet,
    transaction: base64Tx,
    encoding: "base64"
  });
  return res?.hash || res?.signature || res;
}

module.exports = { signAndSend, CAIP2 };
