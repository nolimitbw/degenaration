import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isBotRequest } from "@/lib/server/bot-auth";

/**
 * The execution engine, run from Vercel because the worker has no host.
 *
 * WHY THIS EXISTS
 *
 * Railway's trial expired and removed every deployment. A new host needs an account that is
 * not available here. The engine itself is fine — it is dependency-injected and
 * provider-agnostic — it simply had nowhere to run.
 *
 * A Vercel function can do every step: Privy delegated signing is an HTTPS call, Jupiter quote
 * and swap are HTTPS, Solana simulate and submit are RPC over HTTPS. What it cannot do is stay
 * resident. So this route is invoked on a schedule and runs a BOUNDED INTERNAL LOOP, which is
 * what turns one invocation per minute into a check every few seconds.
 *
 * ENTRIES ARE NOT ONLY DRIVEN FROM HERE. `/api/ingest-call` already receives a Discord call in
 * real time, so the entry path is triggered there too and a call executes seconds after it is
 * posted rather than waiting for the next tick. This loop is the safety net for anything that
 * arrived while an invocation was not running, and the only driver for exits, which have no
 * webhook to hang from.
 *
 * ── EVERY GUARD THE WORKER HAS IS KEPT ──────────────────────────────────────────────────────
 *
 * server/worker.js refuses to start when signing is on and it has no way to exit a position:
 * "a worker that can buy but not sell turns a user's configured stop loss into a promise the
 * code cannot keep". That is the single most damaging thing this product could do, and moving
 * the engine to a new runtime must not quietly drop the guard that prevents it.
 *
 * So this route re-derives the same conditions and REFUSES rather than half-running:
 *
 *   1. authenticated (cron secret or bot secret)
 *   2. every credential present — a missing one means watch-only, never a permissive default
 *   3. the exit path complete, by the same `missingExitPath(store)` derivation
 *   4. DELEGATED_SIGNING === "on", the deliberate operator act
 *   5. the global kill switch still true, re-read per tick rather than cached
 *
 * Fails closed at every one. A tick that cannot prove it may trade does not trade.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The loop must finish INSIDE the caller's HTTP timeout, not merely inside Vercel's function
 * limit. A 240s budget completed its work but the pg_cron caller reported "HTTP request
 * cancelled" every run — the route kept going server-side after the client hung up, so the
 * work landed while the schedule showed nothing but failures. A job that always reports failure
 * is a job whose alerts get muted, which is how a real outage later goes unnoticed.
 *
 * 50s of passes on a 60s schedule: the caller gets a clean response, and the gap between
 * invocations is smaller than the old one anyway.
 */
const BUDGET_MS = 50_000;
const INTERVAL_MS = 8_000;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isCronRequest(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && timingSafeEqual(digest(expected!), digest(supplied!)));
}

type Refusal = { ok: false; reason: string; missing?: string[] };

/**
 * Everything that must be true before a single lamport can move. Returns the FIRST failure,
 * so the operator gets one precise reason rather than a wall — the same rule
 * `lib/bot-readiness.js` applies on the RUN button.
 */
function readiness(): Refusal | { ok: true } {
  const credentials = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_AUTHORIZATION_KEY"]
    .filter((name) => !process.env[name]?.trim());
  if (credentials.length) {
    return { ok: false, reason: "execution credentials are not configured on this deployment", missing: credentials };
  }

  const net = String(process.env.WORKER_NET || "").trim().toLowerCase();
  if (!new Set(["mainnet", "devnet"]).has(net)) {
    return { ok: false, reason: "WORKER_NET must be mainnet or devnet" };
  }

  if (process.env.DELEGATED_SIGNING !== "on") {
    return { ok: false, reason: "delegated signing is off — this deployment is watch-only" };
  }

  return { ok: true };
}

export async function GET(req: NextRequest) {
  if (!isBotRequest(req) && !isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const gate = readiness();
  if (!gate.ok) {
    // 200, not an error: "configured to watch" is a valid steady state, and a scheduler that
    // sees 5xx every minute is a scheduler whose alerts get muted.
    const { ok: _ignored, ...detail } = gate;
    return NextResponse.json({ ok: true, mode: "watch-only", traded: false, ...detail });
  }

  // Imported lazily so a deployment missing credentials never even loads the signing stack.
  //
  // `interop` is not defensive noise. These are CommonJS modules required from a TypeScript
  // route, and Next's bundler may hand back the module namespace rather than module.exports —
  // in which case the real exports sit under `.default` and a spread copies nothing. The
  // symptom is a minified "f is not a function" from a destructured dependency, which says
  // nothing about which one. Normalising once at the boundary removes the whole class.
  const interop = <T,>(mod: any): T => (mod && mod.default && !mod.loadPendingCalls ? mod.default : mod) as T;

  const { missingExitPath } = interop<any>(require("@/server/engine/exit-path"));
  const store = interop<any>(require("@/server/engine/store"));

  const missing = missingExitPath(store);
  if (missing.length) {
    return NextResponse.json({
      ok: false,
      mode: "refused",
      reason: "signing is enabled but this deployment has no way to exit a position; take-profit and stop-loss could not fire on anything it bought",
      missing
    }, { status: 503 });
  }

  const started = Date.now();
  const counts: Record<string, number> = {};
  // A bounded sample of the actual messages. Counting `LOAD_ERROR: 6` tells you something is
  // broken and nothing about what — and "the worker reads a column production does not have"
  // is a failure this codebase has shipped more than once. One example of each distinct error
  // is the difference between a diagnosis and a shrug.
  const errors: Record<string, string> = {};
  const record = (event: { type?: string; error?: string }) => {
    const key = String(event?.type || "UNKNOWN");
    counts[key] = (counts[key] || 0) + 1;
    if (event?.error && !errors[key] && Object.keys(errors).length < 6) {
      errors[key] = String(event.error).slice(0, 300);
    }
  };

  let ticks = 0;
  try {
    const mod = (m: any) => (m && m.default && Object.keys(m).length <= 2 ? m.default : m);
    const { startCallWatcher } = mod(require("@/server/engine/calls"));
    const { startMonitor } = mod(require("@/server/engine/monitor"));
    const { startSettlementWatcher } = mod(require("@/server/engine/settlement"));
    const { getPrice } = mod(require("@/server/engine/prices"));
    const jupiter = mod(require("@/server/engine/jupiter"));
    const { confirmSignature, fetchReceivedAmount } = mod(require("@/server/engine/confirm"));
    const signer = mod(require("@/server/engine/signer"));

    // Named explicitly rather than spread, so a missing dependency is a build error here
    // instead of a minified runtime failure inside a watcher.
    if (typeof store.loadPendingCalls !== "function") {
      return NextResponse.json({
        ok: false, mode: "error",
        reason: "engine store did not resolve its exports — module interop",
        storeKeys: Object.keys(store || {}).slice(0, 12)
      }, { status: 500 });
    }

    const net = String(process.env.WORKER_NET).trim().toLowerCase();
    const signAndSend = (base64Tx: string, walletId: string, intent: unknown = {}) =>
      signer.signAndSend(base64Tx, walletId, net, intent);

    // The wiring is imported, never rebuilt here. Several watcher dependencies have different
    // names from the store's exports (loadSubmitted / claimExit / recordPeak …), and a
    // `{ ...store }` spread delivered them as undefined — which produced exactly this route
    // reporting `mode: "live"` with seven LOAD_ERRORs and no trades.
    const { monitorDeps, settlementDeps, callDeps, missingWiring } = mod(require("@/server/engine/wiring"));

    const unwired = missingWiring(store);
    if (unwired.length) {
      return NextResponse.json({
        ok: false, mode: "error",
        reason: "engine wiring incomplete — a watcher dependency does not resolve to a function",
        unwired
      }, { status: 500 });
    }

    const io = { getPrice, signAndSend, confirmSignature, fetchReceivedAmount, onEvent: record };
    // pollMs 0 → one pass, no self-scheduling. A setTimeout that outlives the response is
    // either killed mid-write or resumed on a warm container with stale state.
    const passes = [
      startSettlementWatcher(settlementDeps(store, io), 0), // reconcile first, so the rest sees truth
      startMonitor(monitorDeps(store, io), 0),              // exits before entries: never open what you cannot close
      startCallWatcher(callDeps(store, io), 0)
    ];
    void jupiter;

    // Sequential on purpose. Two overlapping passes would race the same claim, and the claim
    // is the thing that makes a double-buy impossible.
    while (Date.now() - started < BUDGET_MS) {
      ticks += 1;
      for (const pass of passes) await pass();
      if (Date.now() - started >= BUDGET_MS) break;
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
  } catch (reason) {
    return NextResponse.json({
      ok: false,
      mode: "error",
      ticks,
      elapsedMs: Date.now() - started,
      error: reason instanceof Error ? reason.message : "tick failed",
      counts,
      errors
    }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    mode: "live",
    ticks,
    intervalMs: INTERVAL_MS,
    elapsedMs: Date.now() - started,
    counts,
    errors
  });
}
