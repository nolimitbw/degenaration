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

/**
 * Whether THIS deployment can execute, independently of any hosted worker.
 *
 * `app/api/worker/tick` runs the engine inside this Next application, driven by pg_cron, because
 * the worker had no host when it was written. Every readiness check below was modelled on a
 * separate worker process and asks its /health endpoint — so with the engine in-app, `signer`
 * and `submission` could never pass and the product told users automated trading was
 * unavailable while it was, in fact, executing.
 *
 * Read from `process.env` rather than over HTTP because the tick route is the same process: this
 * is the same source it gates itself on (`readiness()` in that route), not a second opinion that
 * could disagree with it. Requiring the full credential set, not just the switch, keeps it
 * honest — a deployment with DELEGATED_SIGNING=on and no Privy key cannot sign anything.
 */
function inAppEngine() {
  const credentials = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_AUTHORIZATION_KEY"]
    .every((name) => Boolean(process.env[name]?.trim()));
  const network = String(process.env.WORKER_NET || "").trim().toLowerCase();
  return {
    signing: credentials && process.env.DELEGATED_SIGNING === "on" && network === "mainnet"
  };
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
  const engine = inAppEngine();
  const checks = [
    { id: "mainnetPolicy", ok: facts.mainnetEnabled === true, reason: "Mainnet automation is disabled by the audited release gate." },
    { id: "discordEntries", ok: facts.discordEntriesEnabled === true, reason: "Discord automated entries are disabled by the release gate." },
    { id: "workerLease", ok: facts.workerLive === true && facts.workerMode === "solana-mainnet", reason: "The execution worker is not heartbeating on Solana mainnet." },
    { id: "workerHealth", ok: worker?.status === "ok" && worker?.network === "mainnet", reason: "The execution worker health endpoint is unavailable or on the wrong network." },
    // Either executor proves signing for ITSELF, and neither can vouch for the other.
    //
    // `facts.signerReady` is derived in the database from the hosted worker's heartbeat, so it
    // describes that worker and nothing else. ANDing it with the in-app engine meant a
    // watch-only worker vetoed a deployment that genuinely could sign — which is what the
    // Render worker (signingEnabled: false) was doing while the Vercel engine executed.
    //
    // The hosted branch still requires BOTH its lease fact and its live health, so a worker
    // cannot claim signing on a stale heartbeat alone.
    {
      id: "signer",
      ok: (facts.signerReady === true && worker?.signingEnabled === true) || engine.signing,
      reason: "Automated signing is not enabled on the execution worker or on this deployment."
    },
    { id: "scanner", ok: scanner.online && scanner.approvedRefresh, reason: "The Discord scanner is not online with a current approved-channel map." },
        // `submission` is the one capability that depends on SIGNING rather than on code being
    // present. A watch-only worker reports it false by design, so with the engine in-app it
    // has to consider this deployment too, exactly like the `signer` check above.
    ...REQUIRED_CAPABILITIES.map((id) => ({
      id,
      ok: capabilities[id] === true || (id === "submission" && engine.signing),
      reason: `The deployed worker has not reported its ${id} capability.`
    })),
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
