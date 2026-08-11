import { NextResponse } from "next/server";
import { configuredPlatformFeeBps, formatBpsPercent } from "@/lib/fee-model";
import { feeAccountReadiness } from "@/lib/server/fee-account";
import { automationReadiness } from "@/lib/server/automation-readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type WorkerHealth = {
  status?: string;
  mode?: string;
  signingEnabled?: boolean;
  copyTradingEnabled?: boolean;
  network?: string;
};

async function workerHealth(): Promise<WorkerHealth | null> {
  const raw = process.env.AUTOMATION_WORKER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL("/health", raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      return response.ok ? response.json() : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export async function GET() {
  const configuredBps = configuredPlatformFeeBps();
  const workerConfigured = Boolean(process.env.AUTOMATION_WORKER_URL?.trim());
  const [worker, readiness, fee] = await Promise.all([workerHealth(), automationReadiness(), feeAccountReadiness()]);

  // The fee this deployment ACTUALLY charges, not the one it is configured to want.
  //
  // `feeWalletConfigured` used to be `configuredPlatformFeeBps() > 0` — a test that the
  // environment variable is non-empty. `/api/quote` and `/api/swap` have always resolved the
  // real destination through `resolveFeeAccount`, and skip the fee when the token account does
  // not exist on chain. In production those two disagreed: this endpoint published
  // `feeLabel: "2.00%"` and every quote returned `platformFeeBps: 0, feeAccountSet: false`.
  //
  // Users were shown a rate nobody was charged. It is the safe direction financially and the
  // wrong direction for trust, and the whole interface reads its fee copy from here. One
  // source now: if no account resolves, the platform charges nothing and says so.
  const feeCharged = fee.ready;
  const platformFeeBps = feeCharged ? configuredBps : 0;
  const automationLive = worker?.status === "ok" && worker.mode === "live"
    && worker.signingEnabled === true && worker.network === "mainnet";
  const copyTradingLive = automationLive && worker?.copyTradingEnabled === true;
  return NextResponse.json(
    {
      platformFeeBps,
      feeWalletConfigured: feeCharged,
      feeLabel: feeCharged ? formatBpsPercent(platformFeeBps) : "None",
      /** What the operator intends to charge once the fee account exists. Admin-facing. */
      configuredPlatformFeeBps: configuredBps,
      feeAccountReady: fee.ready,
      automation: {
        configured: workerConfigured,
        live: readiness.active,
        copyLive: readiness.active && copyTradingLive,
        mode: worker?.mode || (workerConfigured ? "unreachable" : "not-configured"),
        network: worker?.network || null,
        status: readiness.status,
        reason: readiness.reason,
        failedCheck: readiness.failedCheck,
        checks: readiness.checks,
        workerReportedLive: automationLive
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
