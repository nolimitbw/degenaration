/**
 * What the product can and cannot do right now, in the user's words.
 *
 * WHY THE WORDING IS LOAD-BEARING. This copy said the execution worker "is not running yet".
 * That was true when it was written and became FALSE the moment the worker was deployed — a
 * banner that describes a condition which no longer exists is not a safety message, it is a
 * false statement rendered as one.
 *
 * The rule this file follows: the gate stays while the capability is genuinely unavailable, and
 * the SENTENCE tracks the actual state. It may only be removed once automated entries really
 * can be placed — the worker deployed, the signer authorised, the fee account resolving, and
 * reconciliation running. Removing it earlier to make the interface look finished is the exact
 * thing the release specification forbids.
 *
 * CURRENT STATE, verified rather than assumed:
 *   worker      deployed on Railway, /health returns ok, performance scanner measuring calls
 *   signer      DELEGATED_SIGNING=off, so server/worker.js starts no trading watcher at all
 *   fee account configured as a wallet, not an output-mint token account, so it resolves to 0
 *
 * The gate is therefore still real: nothing can place a trade. What changed is that the reason
 * is now the true one.
 */
export const AUTOMATED_MAINNET_RELEASE = Object.freeze({
  enabled: false,
  network: "solana-mainnet" as const,
  label: "Solana Mainnet",
  /** The one-line capability state. No internal blocker codes — those are not the user's. */
  reason:
    "Bots save, edit, pause and version normally, and the execution worker is deployed and " +
    "monitoring calls. Automated entries stay switched off at the signer until trading is " +
    "enabled, so no bot can move funds on its own.",
  /** The button label. Names what is actually missing, not a service that is now running. */
  activationLabel: "Activation needs trading enabled"
});
