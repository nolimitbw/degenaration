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
  // `readiness.tradable` includes the live in-app Vercel executor. The separate Render worker
  // is optional and currently suspended, so its unreachable /health response cannot veto the
  // scheduled engine that actually runs startCallWatcher.
  const copyTradingLive = readiness.tradable;
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
        /**
         * `tradable`, not `active` — the answer to the question a user is actually asking.
         *
         * `active` requires all eighteen checks including `fee`, which protects revenue and
         * not the user. Once activation stopped gating on it, reporting `active` here meant
         * the product told users "bots save but do not place trades" while accepting
         * activations and trading — saying one thing and doing another, which is worse than
         * either state on its own.
         *
         * The fee position stays visible and separate: feeLabel reads "None" until the
         * account exists and "2.00%" the moment it does.
         */
        live: readiness.tradable,
        copyLive: copyTradingLive,
        mode: worker?.mode || (workerConfigured ? "unreachable" : "not-configured"),
        network: worker?.network || null,
        status: readiness.status,
        // The USER-facing sentence only. This endpoint is public and unauthenticated, and it
        // was publishing `reason` (operator wording, rendered verbatim by AppShell and
        // TradingNotice) plus the entire `checks` array — naming, to anyone who asked, exactly
        // which piece of our infrastructure was down. Nothing in the UI ever read `checks`.
        //
        // The operator detail is not lost: `automationReadiness()` still returns `reason`,
        // `failedCheck` and `checks`, and /api/product/bots/readiness reads them server-side.
        // It is simply no longer served to the public.
        reason: readiness.publicReason,
        workerReportedLive: automationLive
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
