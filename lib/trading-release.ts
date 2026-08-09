/** Network metadata only. Runtime authority lives in automationReadiness(), which reads the
 * current worker lease, signer, scanner, fee account, audited flags and reconciliation state.
 * A compile-time boolean cannot truthfully describe an operational capability. */
export const AUTOMATED_MAINNET_RELEASE = Object.freeze({
  network: "solana-mainnet" as const,
  label: "Solana Mainnet"
});
