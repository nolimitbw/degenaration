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
  // A recent database lease proves the scheduled route is actually being invoked. Environment
  // flags alone do not prove a scheduler exists; the lease alone does not prove signing. Both
  // together identify a live in-app executor when the separate Render service is suspended.
  const inAppLive = engine.signing && facts.workerLive === true && facts.workerMode === "solana-mainnet";
  const checks = [
    { id: "mainnetPolicy", ok: facts.mainnetEnabled === true, reason: "Mainnet automation is disabled by the audited release gate." },
    { id: "discordEntries", ok: facts.discordEntriesEnabled === true, reason: "Discord automated entries are disabled by the release gate." },
    { id: "workerLease", ok: facts.workerLive === true && facts.workerMode === "solana-mainnet", reason: "The execution worker is not heartbeating on Solana mainnet." },
    { id: "workerHealth", ok: (worker?.status === "ok" && worker?.network === "mainnet") || inAppLive, reason: "No execution runtime is live on Solana mainnet." },
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
      ok: (facts.signerReady === true && worker?.signingEnabled === true) || inAppLive,
      reason: "Automated signing is not enabled on the execution worker or on this deployment."
    },
    { id: "scanner", ok: scanner.online && scanner.approvedRefresh, reason: "The Discord scanner is not online with a current approved-channel map." },
        // `submission` is the one capability that depends on SIGNING rather than on code being
    // present. A watch-only worker reports it false by design, so with the engine in-app it
    // has to consider this deployment too, exactly like the `signer` check above.
    ...REQUIRED_CAPABILITIES.map((id) => ({
      id,
      ok: capabilities[id] === true || inAppLive,
      reason: `The deployed worker has not reported its ${id} capability.`
    })),
    { id: "exits", ok: facts.automatedExitsEnabled === true, reason: "Automated take-profit and stop-loss exits are disabled by the release gate." },
    { id: "fee", ok: fee.ready === true && worker?.feeEnabled === true, reason: "The platform fee account is not ready on both the app and worker." },
    { id: "reconciliationState", ok: Number(facts.reconciliationWarnings ?? -1) === 0, reason: "Confirmed executions are awaiting reconciliation." }
  ];
  const failed = checks.find((check) => !check.ok) || null;
  const blocking = checks.find((check) => !check.ok && !ADVISORY.has(check.id)) || null;
  return {
    /** Every check passing, fee included. The operator's bar. */
    active: !failed,
    /** True when nothing that protects a USER is failing. See ADVISORY. The product's bar. */
    tradable: !blocking,
    /**
     * The two PUBLIC fields answer the user's question — can my bot trade? — so they follow
     * `tradable`. Reporting `active` here left the product saying "bots save but do not place
     * trades" while it accepted activations and traded: one thing said, another done, which is
     * worse than either state alone.
     *
     * The operator fields below still follow `active`, so `reason`, `failedCheck` and `checks`
     * keep naming the fee account until it exists. Nothing is hidden; the two audiences are
     * simply asked different questions.
     */
    status: blocking ? "Pending" : "Active",
    publicReason: blocking ? PUBLIC_PENDING_REASON : PUBLIC_ACTIVE_REASON,
    reason: failed?.reason || "Bots can place and manage trades automatically.",
    failedCheck: failed?.id || null,
    blockingCheck: blocking?.id || null,
    checks
  };
}

/**
 * Checks that are reported but do NOT stop a bot from running.
 *
 * Only `fee`, and only because it protects REVENUE rather than a user. Every other check
 * guards something a user could be harmed by — a missing signer, an unconfirmed submission,
 * exits that will not fire. Those stay blocking and always should.
 *
 * The fee account does not exist on chain, so `resolveFeeAccount` finds no destination and the
 * swap path skips the charge. That was blocking every activation, which protected nothing: with
 * no bot able to run there are no trades, so there was no 2% being defended — only trades that
 * never happened. Unblocking cannot earn less than zero.
 *
 * Nothing about the fee itself changes. The rate is still 200 bps per confirmed leg, the ledger
 * is untouched, and `/api/platform/config` still reports the collected rate honestly — "None"
 * today, "2.00%" the moment the account exists, with no code change and no redeploy.
 *
 * This is the owner's decision, taken after they were shown both options and asked for the
 * product to work. It is recorded here rather than in a commit message because the next session
 * needs to know it was a choice and not an oversight.
 */
const ADVISORY: ReadonlySet<string> = new Set(["fee"]);

/**
 * What a USER is told, as a constant rather than as the failing check's text.
 *
 * Every `reason` above is written for whoever operates this thing — "the platform fee account
 * is not ready on both the app and worker" is precise, and it is exactly the class §23 forbids
 * in the public UI, alongside "engine not configured" and "database reserves". It reached the
 * builder, the manager and the portfolio through TradingNotice, so a user weighing whether to
 * trust the product with money read a sentence about our fee plumbing.
 *
 * It is a CONSTANT, deliberately, and not `failed.reason` rewritten. Deriving the public string
 * from the failing check means the next check anyone adds leaks its operator wording the first
 * time it trips — which is how this happened. Here leakage is impossible by construction, and
 * `assertPublicReasonsAreVetted` fails the build if either sentence drifts.
 *
 * All eighteen checks are infrastructure; not one is something a user can fix. So naming WHICH
 * one failed tells them nothing they can act on, while the operator keeps the precise reason in
 * `reason` and the full array in `checks`. That is the split §23 asks for — user language in
 * front, technical detail behind the operator surface — not detail removed.
 */
const PUBLIC_PENDING_REASON = "Automated trading is not live yet, so bots save but do not place trades.";
const PUBLIC_ACTIVE_REASON = "Bots can place and manage trades automatically.";

/** Both sentences, so a test can assert no operator `reason` is ever one of them. */
export const PUBLIC_REASONS = [PUBLIC_PENDING_REASON, PUBLIC_ACTIVE_REASON] as const;
