import { optionalEnv } from "../env.ts";

/**
 * Fee arithmetic.
 *
 * Xzy takes a cut of each trade and passes part of it to the channel that made the call.
 * That share is the whole reason a channel lists itself, so it is computed explicitly and
 * recorded per trade rather than reconciled later from aggregates.
 *
 * Pure, and in basis points throughout: 100 bps = 1%. Money splits done in floating
 * percentages are where rounding quietly invents or destroys value.
 */

export const DEFAULT_PLATFORM_FEE_BPS = 100; // 1% of each trade
export const DEFAULT_CHANNEL_SHARE_BPS = 3_000; // 30% of that fee goes to the channel

/** Nobody's trade should ever be taxed more than this, whatever the config says. */
export const MAX_PLATFORM_FEE_BPS = 500; // 5%

export type FeeSplit = {
  /** Total taken from the trade. */
  totalFeeSol: number;
  /** The channel's share of that fee. */
  channelSol: number;
  /** What the platform keeps. */
  platformSol: number;
  /** What reaches the user after the fee. */
  netSol: number;
};

function clampBps(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), max);
}

export function platformFeeBps(): number {
  const configured = Number(optionalEnv("PLATFORM_FEE_BPS") ?? DEFAULT_PLATFORM_FEE_BPS);
  return clampBps(configured, MAX_PLATFORM_FEE_BPS);
}

export function channelShareBps(): number {
  const configured = Number(optionalEnv("CHANNEL_FEE_SHARE_BPS") ?? DEFAULT_CHANNEL_SHARE_BPS);
  return clampBps(configured, 10_000);
}

/**
 * Split a trade amount into fee and net.
 *
 * `hasChannel` is false for a manual trade — there is no caller to reward, so the whole
 * fee stays with the platform rather than being paid to nobody.
 */
export function splitFee(input: {
  amountSol: number;
  feeBps?: number;
  channelShareBps?: number;
  hasChannel: boolean;
}): FeeSplit {
  const amount = Number.isFinite(input.amountSol) && input.amountSol > 0 ? input.amountSol : 0;
  const feeBps = clampBps(input.feeBps ?? platformFeeBps(), MAX_PLATFORM_FEE_BPS);
  const shareBps = clampBps(input.channelShareBps ?? channelShareBps(), 10_000);

  const totalFeeSol = (amount * feeBps) / 10_000;
  const channelSol = input.hasChannel ? (totalFeeSol * shareBps) / 10_000 : 0;

  return {
    totalFeeSol,
    channelSol,
    // Subtraction rather than a second percentage, so the two halves always sum to the
    // total exactly and no dust is created by rounding each independently.
    platformSol: totalFeeSol - channelSol,
    netSol: amount - totalFeeSol
  };
}

/** True once a real destination account is configured; until then fees only accrue. */
export function feesArePayable(): boolean {
  return Boolean(optionalEnv("PLATFORM_FEE_ACCOUNT"));
}
