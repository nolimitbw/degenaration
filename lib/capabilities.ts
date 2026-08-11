/**
 * What this deployment can actually do, per capability, from the server.
 *
 * WHY. Every page carried a banner reading "Automated trading and payouts are not yet
 * available". Half of that is false: withdrawals and affiliate payouts are implemented,
 * deployed and verified — `app_user_open_withdrawal_intent`, `app_user_settle_withdrawal` and
 * the `cash_movements` writer are all live, and the Portfolio's Withdraw flow uses them. The
 * banner told every visitor they could not take their money out, which is both untrue and the
 * single most alarming thing a trading product can say about itself.
 *
 * The other half is true: no worker and no signer, so nothing trades on its own.
 *
 * One global sentence cannot express that, so this reports each capability separately and the
 * UI states only what is actually restricted. `automation.live` comes from the server rather
 * than a compiled-in constant, so the message stops being wrong the moment a worker is
 * running, with no redeploy.
 */

export type CapabilityState = {
  /** Bots executing entries and exits on their own. Needs a worker and a signer. */
  automation: { available: boolean; detail: string };
  /** Wallet-signed swaps the user confirms themselves. */
  manualTrading: { available: boolean; detail: string };
  /** Principal withdrawals and affiliate payouts. */
  withdrawals: { available: boolean; detail: string };
  /** Building, saving, editing, pausing and versioning bots. */
  botConfiguration: { available: boolean; detail: string };
};

const DEFAULTS: CapabilityState = {
  automation: {
    available: false,
    detail: "Bots do not place trades on their own yet. Everything else about them works."
  },
  manualTrading: {
    available: true,
    detail: "You confirm every transaction in your own wallet."
  },
  withdrawals: {
    available: true,
    detail: "Principal withdrawals and affiliate payouts are self-service."
  },
  botConfiguration: {
    available: true,
    detail: "Build, save, edit, pause and version bots."
  }
};

/** Shape of the subset of `/api/platform/config` this reads. */
type PlatformConfig = {
  automation?: { live?: boolean; configured?: boolean; mode?: string | null };
};

export function capabilitiesFrom(config: PlatformConfig | null | undefined): CapabilityState {
  const live = Boolean(config?.automation?.live);
  return {
    ...DEFAULTS,
    automation: live
      ? { available: true, detail: "Bots place entries and exits automatically." }
      : DEFAULTS.automation
  };
}

/**
 * The one line worth interrupting someone with, or null.
 *
 * Returns null when nothing is restricted — a banner that is always on is furniture, and
 * people stop reading furniture. It never mentions a capability that works, which is why the
 * old wording was harmful: naming payouts alongside a real restriction made a working feature
 * look broken.
 */
export function restrictionNotice(state: CapabilityState): string | null {
  if (state.automation.available) return null;
  return "Automatic execution is waiting for the live worker connection.";
}
