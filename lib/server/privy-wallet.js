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

function ownsPrivyWallet(payload, privyUserId, walletAddress, walletId) {
  if (String(payload?.sub || "") !== privyUserId) return false;
  const wallet = linkedAccounts(payload).find((account) => {
    const chain = account.chain_type ?? account.chainType;
    return account.type === "wallet" && chain === "solana" && account.address === walletAddress;
  });
  if (!wallet) return false;
  const linkedId = wallet.id ?? wallet.wallet_id ?? wallet.walletId;
  return !linkedId || linkedId === walletId;
}

module.exports = { linkedAccounts, ownsPrivyWallet };
