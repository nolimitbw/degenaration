function linkedAccounts(payload) {
  const raw = payload?.linked_accounts;
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

/**
 * WHAT THIS GUARANTEES, exactly.
 *
 * The binding that authorizes anything is ADDRESS -> USER: the identity token must be for
 * the same subject as the access token, and that subject must have the Solana wallet
 * `walletAddress` among its linked accounts. Both are enforced below and neither can be
 * bypassed. Every caller builds its action against that verified address.
 *
 * `walletId` is a SECONDARY identifier and is only checked when Privy actually supplies one
 * in the token. When the linked account carries no id there is nothing to compare against,
 * and the last line accepts whatever the client claimed:
 *
 *   linked account has an id, client claims a different one -> rejected
 *   linked account has NO id, client claims anything         -> accepted
 *
 * That is safe TODAY only because no caller derives authority from `walletId` — it is
 * passed alongside the verified address, never instead of it, and the server holds no keys
 * so it cannot move funds regardless. It stops being safe the moment something treats
 * `walletId` as authoritative (choosing a signing wallet, keying a balance lookup). If you
 * are about to do that, make the id mandatory here first.
 */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * EXTRACT the caller's Solana wallet from a verified identity token, instead of verifying an
 * address the caller supplied.
 *
 * ownsPrivyWallet() below answers "does this user own the address you named?", which is the
 * right question when the caller must name a wallet (a withdrawal names the wallet it spends
 * from). It is the WRONG question for registration: there the server is recording who owns
 * what, so taking the address from the request at all -- even a verified one -- means the
 * body chooses which of several linked wallets gets written. This takes the address only
 * from the token.
 *
 * Returns null when the subject does not match, when no Solana wallet is linked, or when the
 * linked address is not a plausible Solana address. A caller that gets null must refuse; it
 * must not fall back to anything the request supplied.
 */
function solanaWalletFromPayload(payload, privyUserId) {
  if (String(payload?.sub || "") !== privyUserId) return null;
  const wallet = linkedAccounts(payload).find((account) => {
    const chain = account.chain_type ?? account.chainType;
    return account.type === "wallet" && chain === "solana";
  });
  if (!wallet) return null;
  const address = String(wallet.address || "").trim();
  if (!SOLANA_ADDRESS.test(address)) return null;
  const id = wallet.id ?? wallet.wallet_id ?? wallet.walletId;
  return {
    address,
    walletId: id ? String(id) : null,
    delegated: Boolean(wallet.delegated)
  };
}

function ownsPrivyWallet(payload, privyUserId, walletAddress, walletId) {
  return Boolean(privyWalletFromPayload(payload, privyUserId, walletAddress, walletId));
}

/**
 * Return the verified wallet facts that execution callers need.
 *
 * Ownership and delegation are different facts. Treating an owned wallet as delegated lets
 * an automation row become active, claim a real signal, reserve the user's daily limits and
 * only then discover that Privy cannot sign for it. The signed identity token already carries
 * the delegation state, so preserve it at the same boundary that proves ownership.
 */
function privyWalletFromPayload(payload, privyUserId, walletAddress, walletId) {
  if (String(payload?.sub || "") !== privyUserId) return null;
  const wallet = linkedAccounts(payload).find((account) => {
    const chain = account.chain_type ?? account.chainType;
    return account.type === "wallet" && chain === "solana" && account.address === walletAddress;
  });
  if (!wallet) return null;
  const linkedId = wallet.id ?? wallet.wallet_id ?? wallet.walletId;
  if (linkedId && linkedId !== walletId) return null;
  return {
    address: String(wallet.address),
    walletId: linkedId ? String(linkedId) : null,
    delegated: wallet.delegated === true
  };
}

module.exports = { linkedAccounts, ownsPrivyWallet, privyWalletFromPayload, solanaWalletFromPayload };
