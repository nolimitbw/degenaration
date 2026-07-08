// Privy's `user.wallet` returns whichever wallet is "primary", which defaults to an
// Ethereum embedded wallet unless the app explicitly requests Solana. This app is
// Solana-only, so always pull the wallet from linkedAccounts filtered by chainType.
function getSolanaWallet(user: any): any {
  return ((user as any)?.linkedAccounts || []).find(
    (a: any) => a.type === "wallet" && a.chainType === "solana"
  );
}
export function getSolanaAddress(user: any): string | undefined {
  return getSolanaWallet(user)?.address;
}
export function getSolanaWalletId(user: any): string | undefined {
  return getSolanaWallet(user)?.id;
}
