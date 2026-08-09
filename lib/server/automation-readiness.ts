import { callPrivyRpc } from "@/lib/server/privy";
import { feeAccountReadiness } from "@/lib/server/fee-account";
import { fetchWithTimeout } from "@/lib/server/guard";

type RuntimeFacts = {
  mainnetEnabled?: boolean;
  discordEntriesEnabled?: boolean;
  automatedExitsEnabled?: boolean;
  workerLive?: boolean;
  workerMode?: string | null;
  signerReady?: boolean;
  reconciliationWarnings?: number;
};

type WorkerHealth = {
  status?: string;
  network?: string;
  signingEnabled?: boolean;
  feeEnabled?: boolean;
  capabilities?: Record<string, boolean>;
};

const REQUIRED_CAPABILITIES = [
  "durableIntents", "quote", "simulation", "submission", "confirmation",
  "positionCapture", "takeProfitStopLoss", "dailyRisk", "reconciliation"
] as const;

async function workerHealth(): Promise<WorkerHealth | null> {
  const raw = process.env.AUTOMATION_WORKER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL("/health", raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    const response = await fetchWithTimeout(url.toString(), { cache: "no-store" }, 3_000);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function scannerHealth() {
  const raw = process.env.DEGENCALLS_HEALTH_URL || "https://degencalls.onrender.com/health?format=json";
  try {
    const response = await fetchWithTimeout(raw, { cache: "no-store" }, 5_000);
    const value = await response.json().catch(() => null);
    return {
      online: response.ok && value?.discord?.ready === true,
      approvedRefresh: Boolean(value?.source_bridge?.approvedRefresh?.lastSuccessAt)
        && !value?.source_bridge?.approvedRefresh?.lastError
    };
  } catch {
    return { online: false, approvedRefresh: false };
  }
}

export async function automationReadiness() {
  const [factsResult, worker, scanner, fee] = await Promise.all([
    callPrivyRpc<RuntimeFacts>("app_automation_runtime_facts", {}),
    workerHealth(),
    scannerHealth(),
    feeAccountReadiness()
  ]);
  const facts = factsResult.ok ? factsResult.data || {} : {};
  const capabilities = worker?.capabilities || {};
  const checks = [
    { id: "mainnetPolicy", ok: facts.mainnetEnabled === true, reason: "Mainnet automation is disabled by the audited release gate." },
    { id: "discordEntries", ok: facts.discordEntriesEnabled === true, reason: "Discord automated entries are disabled by the release gate." },
    { id: "workerLease", ok: facts.workerLive === true && facts.workerMode === "solana-mainnet", reason: "The execution worker is not heartbeating on Solana mainnet." },
    { id: "workerHealth", ok: worker?.status === "ok" && worker?.network === "mainnet", reason: "The execution worker health endpoint is unavailable or on the wrong network." },
    { id: "signer", ok: facts.signerReady === true && worker?.signingEnabled === true, reason: "Automated signing is not enabled on the execution worker." },
    { id: "scanner", ok: scanner.online && scanner.approvedRefresh, reason: "The Discord scanner is not online with a current approved-channel map." },
    ...REQUIRED_CAPABILITIES.map((id) => ({ id, ok: capabilities[id] === true, reason: `The deployed worker has not reported its ${id} capability.` })),
    { id: "exits", ok: facts.automatedExitsEnabled === true, reason: "Automated take-profit and stop-loss exits are disabled by the release gate." },
    { id: "fee", ok: fee.ready === true && worker?.feeEnabled === true, reason: "The platform fee account is not ready on both the app and worker." },
    { id: "reconciliationState", ok: Number(facts.reconciliationWarnings ?? -1) === 0, reason: "Confirmed executions are awaiting reconciliation." }
  ];
  const failed = checks.find((check) => !check.ok) || null;
  return {
    active: !failed,
    status: failed ? "Pending" : "Active",
    reason: failed?.reason || "Bots can place and manage trades automatically.",
    failedCheck: failed?.id || null,
    checks
  };
}
