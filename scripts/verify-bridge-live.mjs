/**
 * Live bridge deployment probe.
 *
 * scripts/check-bridge-contract.mjs proves this repository is internally consistent. It
 * cannot prove the DEPLOYED edge function matches it, and that gap is precisely what caused
 * the funds incident: app_user_withdrawable_state was correct in the repository and absent
 * from production for six days, so every withdrawal attempt returned "Balance is temporarily
 * unavailable" while the Portfolio showed the user's real on-chain balance.
 *
 * NO CREDENTIAL IS TRANSMITTED. The deployed handler checks the operation name before it
 * uses p_secret:
 *
 *     const allowed = Object.hasOwn(operations, operation) ? operations[operation] : null;
 *     if (!allowed) return json({ error: "unknown operation" }, 400);
 *
 * so a deliberately invalid secret separates the two failures cleanly:
 *
 *     400 unknown operation  -> the operation is NOT in the deployed allowlist
 *     401 unauthorized       -> it IS deployed; the database rejected the secret
 *
 * A 401 is therefore the PASS condition. Read-only: an invalid secret cannot mutate anything.
 *
 * Usage:  npm run verify:bridge-live
 *         SUPABASE_URL=https://<ref>.supabase.co npm run verify:bridge-live
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repo = process.cwd();

async function resolveBaseUrl() {
  const fromEnv = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  // Fall back to the project URL in .env.local without printing anything else from it.
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(join(repo, file), "utf8");
      const match = text.match(/^\s*(?:NEXT_PUBLIC_)?SUPABASE_URL\s*=\s*"?([^"\s]+)"?/m);
      if (match) return match[1].replace(/\/+$/, "");
    } catch {
      /* not present */
    }
  }
  return null;
}

const base = await resolveBaseUrl();
if (!base) {
  console.log(
    JSON.stringify(
      {
        skipped: true,
        reason: "SUPABASE_URL is not set and no .env file supplies it",
        note: "Offline consistency is still enforced by npm run check:bridge-contract"
      },
      null,
      2
    )
  );
  process.exit(0);
}

/** Every operation this repository declares, plus the controls that prove the probe works. */
const source = await readFile(join(repo, "supabase/functions/app-bridge/index.ts"), "utf8");
const declared = [...source.matchAll(/^ {2}([a-z_0-9]+):\s*\[/gm)].map((m) => m[1]);

// A probe that returns 400 for EVERYTHING would "pass" a naive test by proving nothing.
// These three are known-deployed, so a 401 from them establishes the probe reaches the
// database at all. If a control returns 400, the probe itself is broken — report that, do
// not report 60 false failures.
const CONTROLS = ["app_user_portfolio_summary", "app_user_affiliate_summary", "app_user_list_bots"];

const url = `${base}/functions/v1/app-bridge`;
const INVALID = "deliberately-invalid-probe-secret";

async function probe(operation) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, p_secret: INVALID })
  }).catch((error) => ({ ok: false, status: 0, _error: String(error?.message || error) }));
  if (response.status === 0) return { operation, status: 0, deployed: null, error: response._error };
  const body = await response.json().catch(() => ({}));
  return {
    operation,
    status: response.status,
    deployed: response.status !== 400 || body?.error !== "unknown operation"
  };
}

const results = [];
for (const operation of declared) results.push(await probe(operation));

const unreachable = results.filter((r) => r.status === 0);
if (unreachable.length) {
  console.error(`Could not reach ${url} — ${unreachable[0].error}`);
  process.exit(1);
}

const controlResults = results.filter((r) => CONTROLS.includes(r.operation));
const brokenControls = controlResults.filter((r) => !r.deployed);
if (brokenControls.length) {
  console.error(
    `Probe control failed: ${brokenControls.map((r) => r.operation).join(", ")} answered ` +
      `400 "unknown operation". Either the deployment is far older than expected or this ` +
      `probe is wrong. Investigate before trusting any result below.`
  );
  process.exit(1);
}

const missing = results.filter((r) => !r.deployed).map((r) => r.operation);

if (missing.length) {
  console.error(
    `\nDEPLOYMENT DRIFT — ${missing.length} operation(s) exist in this repository but not in the\n` +
      `deployed app-bridge function at ${base}:\n`
  );
  missing.forEach((operation) => console.error(`  - ${operation}`));
  console.error(
    `\n  Every call to these returns 400 "unknown operation", which lib/server/app-bridge.ts\n` +
      `  turns into a generic "temporarily unavailable" for the user. Redeploy the edge\n` +
      `  function. Controls (${CONTROLS.join(", ")}) answered 401, so the probe is sound.\n`
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      target: base,
      operationsDeclared: declared.length,
      controlsAnswered401: controlResults.length,
      deploymentDrift: "NONE",
      credentialTransmitted: "none — the probe sends a deliberately invalid secret"
    },
    null,
    2
  )
);
