export const AUTOMATED_MAINNET_RELEASE = Object.freeze({
  enabled: false,
  network: "solana-mainnet" as const,
  label: "Solana Mainnet",
  // The gate is real: no worker and no signer, so nothing can execute. The wording is scoped
  // to that one capability — the previous copy was reused in a global banner where it read as
  // "the product does not work", including about withdrawals, which do.
  reason: "Bots save, edit, pause and version normally. Placing trades automatically needs the execution worker, which is not running yet, so no bot can move funds on its own."
});
