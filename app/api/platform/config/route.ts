import { NextResponse } from "next/server";
import { configuredPlatformFeeBps, formatBpsPercent } from "@/lib/fee-model";

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
  const platformFeeBps = configuredPlatformFeeBps();
  const feeWalletConfigured = platformFeeBps > 0;
  const workerConfigured = Boolean(process.env.AUTOMATION_WORKER_URL?.trim());
  const worker = await workerHealth();
  const automationLive = worker?.status === "ok" && worker.mode === "live"
    && worker.signingEnabled === true && worker.network === "mainnet";
  const copyTradingLive = automationLive && worker?.copyTradingEnabled === true;
  return NextResponse.json(
    {
      platformFeeBps,
      feeWalletConfigured,
      feeLabel: feeWalletConfigured ? formatBpsPercent(platformFeeBps) : "Off",
      automation: {
        configured: workerConfigured,
        live: automationLive,
        copyLive: copyTradingLive,
        mode: worker?.mode || (workerConfigured ? "unreachable" : "not-configured"),
        network: worker?.network || null
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
