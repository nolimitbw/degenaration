/**
 * Bridge contract guard.
 *
 * WHY THIS EXISTS
 *
 * The Next.js app can only reach the database through the `app-bridge` Supabase edge
 * function, which carries a HAND-MAINTAINED allowlist of permitted RPC names. A name that is
 * not in that allowlist is rejected with `400 unknown operation` before the database is ever
 * consulted, and lib/server/app-bridge.ts converts that into a generic
 * "This is temporarily unavailable" for the user. Nothing in the type system, the linter or
 * the test suite connects a `callPrivyRpc("…")` call site to that allowlist, so the two
 * drifted apart silently and stayed broken for weeks:
 *
 *   app_user_set_risk_acceptance     never allowlisted -> onboarding step 0 never worked
 *                                    for ANY user; public.privy_profiles has 0 rows
 *   app_user_save_mainnet_bot_draft  never allowlisted -> no bot could be saved at all
 *   app_user_get_bot_activity        allowlisted, but the SQL function was never written
 *                                    to a migration that reached production
 *
 * See docs/ai/DEPLOYMENT_DRIFT_REPORT.md.
 *
 * WHAT IT CHECKS
 *
 *   1. Every RPC name the application references has an allowlist entry.
 *   2. Every allowlist entry names a function that supabase/*.sql actually defines.
 *   3. Every allowlist parameter exists on that function — a typo'd name is not a silent
 *      NULL, PostgREST rejects the whole call.
 *   4. Every function parameter WITHOUT a default is present in the allowlist — an omitted
 *      required parameter arrives as NULL and the failure surfaces deep inside plpgsql.
 *
 * WHAT IT CANNOT CHECK
 *
 * Whether the deployed edge function matches this file. "What is deployed" is not knowable
 * offline. `npm run verify:bridge-live` probes that against the running project.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const repo = process.cwd();
const problems = [];
const fail = (message) => problems.push(message);

// ---- the two bridges ------------------------------------------------------------------

/** app-bridge: `name: ["p_secret", …]`. bot-bridge: `alias: { rpc: "name", params: […] }`. */
function parseAllowlist(source, file) {
  const entries = new Map();

  for (const match of source.matchAll(/^ {2}([a-z_0-9]+):\s*\[([^\]]*)\]/gm)) {
    entries.set(match[1], { rpc: match[1], params: quoted(match[2]), alias: match[1], file });
  }
  for (const match of source.matchAll(
    /^ {2}([a-z_0-9]+):\s*\{\s*\n\s*rpc:\s*"([a-z_0-9]+)",\s*\n\s*params:\s*\[([\s\S]*?)\]/gm
  )) {
    entries.set(match[2], { rpc: match[2], params: quoted(match[3]), alias: match[1], file });
  }
  return entries;
}

const quoted = (text) => [...text.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);

// ---- what the SQL actually declares ----------------------------------------------------

/**
 * A function may be redefined across several migration files and there is no ordering
 * manifest, so every definition is kept. A call site is satisfied if it matches ANY of them
 * — the alternative is failing the build over historical duplicates that production has
 * already collapsed into one.
 */
async function parseSqlFunctions() {
  const functions = new Map();
  const dir = join(repo, "supabase");
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql"))) {
    const source = await readFile(join(dir, name), "utf8");
    for (const match of source.matchAll(
      /create\s+or\s+replace\s+function\s+(public|app_private)\.([a-z_0-9]+)\s*\(([\s\S]*?)\)\s*\n\s*returns/gi
    )) {
      const [, schema, fn, rawParams] = match;
      if (schema !== "public") continue; // only public.* is reachable through PostgREST
      const params = rawParams
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => ({
          name: part.split(/\s+/)[0],
          optional: /\bdefault\b/i.test(part)
        }));
      if (!functions.has(fn)) functions.set(fn, []);
      functions.get(fn).push({ params, file: name });
    }
  }
  return functions;
}

// ---- what the application references ----------------------------------------------------

/**
 * Deliberately NOT `callPrivyRpc\("name"\)`. app/api/product/bots/route.ts picks its RPC
 * through a variable:
 *
 *   const rpcName = parsed.value.status === "active" ? "app_user_save_bot" : "app_user_save…";
 *   callPrivyRpc(rpcName, …)
 *
 * A call-shaped regex misses that, and missing it is exactly how defect A-1 survived. So any
 * RPC-shaped literal in the app is treated as a reference, and the false positives are then
 * removed by requiring the name to be a real public SQL function.
 */
async function collectReferences(sqlFunctions) {
  const references = new Map();
  const roots = ["app", "lib", "components"];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const lines = (await readFile(path, "utf8")).split("\n");
        lines.forEach((line, index) => {
          for (const match of line.matchAll(/"((?:app_|admin_|worker_|bot_)[a-z_0-9]+)"/g)) {
            const name = match[1];
            if (!sqlFunctions.has(name)) continue;
            if (!references.has(name)) references.set(name, []);
            references.get(name).push(`${path}:${index + 1}`);
          }
        });
      }
    }
  }

  for (const root of roots) await walk(join(repo, root));
  return references;
}

// ---- run --------------------------------------------------------------------------------

const appBridge = parseAllowlist(
  await readFile(join(repo, "supabase/functions/app-bridge/index.ts"), "utf8"),
  "app-bridge"
);
const botBridge = parseAllowlist(
  await readFile(join(repo, "supabase/functions/bot-bridge/index.ts"), "utf8"),
  "bot-bridge"
);
const allowlist = new Map([...appBridge, ...botBridge]);
const sqlFunctions = await parseSqlFunctions();
const references = await collectReferences(sqlFunctions);

if (allowlist.size < 40) fail(`only ${allowlist.size} bridge operations parsed — the parser is broken, not the bridge`);
if (sqlFunctions.size < 60) fail(`only ${sqlFunctions.size} public SQL functions parsed — the parser is broken`);

// 1. every referenced RPC is reachable
for (const [name, sites] of [...references].sort()) {
  // Worker RPCs are called by server/ through the service-role key, not through a bridge.
  if (name.startsWith("worker_")) continue;
  if (!allowlist.has(name)) {
    fail(
      `${name} is called by the app but has no bridge operation — every call returns ` +
        `400 "unknown operation".\n      called from ${sites.join(", ")}\n      ` +
        `fix: add it to supabase/functions/app-bridge/index.ts`
    );
  }
}

// 2-4. every allowlist entry matches a real signature
for (const [name, entry] of [...allowlist].sort()) {
  const definitions = sqlFunctions.get(name);
  if (!definitions) {
    fail(
      `${entry.file} allowlists ${name}, but no supabase/*.sql defines public.${name}.\n      ` +
        `A deploy would turn 400 "unknown operation" into 502 "bridge operation failed".`
    );
    continue;
  }

  const matches = definitions.some((definition) => {
    const declared = new Set(definition.params.map((p) => p.name));
    const passed = new Set(entry.params);
    const unknown = entry.params.filter((p) => !declared.has(p));
    const missingRequired = definition.params.filter((p) => !p.optional && !passed.has(p.name));
    return unknown.length === 0 && missingRequired.length === 0;
  });

  if (!matches) {
    const first = definitions[0];
    const declared = new Set(first.params.map((p) => p.name));
    const unknown = entry.params.filter((p) => !declared.has(p));
    const passedSet = new Set(entry.params);
    const missing = first.params.filter((p) => !p.optional && !passedSet.has(p.name)).map((p) => p.name);
    fail(
      `${entry.file} allowlists ${name} with a parameter list that matches no definition of it.\n      ` +
        `defined in ${definitions.map((d) => d.file).join(", ")}\n      ` +
        (unknown.length ? `passes parameters the function does not declare: ${unknown.join(", ")}\n      ` : "") +
        (missing.length ? `omits required parameters: ${missing.join(", ")}\n      ` : "")
    );
  }
}

// ---- report ------------------------------------------------------------------------------

if (problems.length) {
  console.error(`\nBridge contract check FAILED — ${problems.length} problem(s):\n`);
  problems.forEach((problem, index) => console.error(`  ${index + 1}. ${problem}\n`));
  console.error(
    "  Each of these is a call that fails at runtime with a generic \"temporarily\n" +
      "  unavailable\" message and no type or lint error. See docs/ai/DEPLOYMENT_DRIFT_REPORT.md.\n"
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      bridgeOperations: allowlist.size,
      publicSqlFunctions: sqlFunctions.size,
      rpcNamesReferencedByTheApp: references.size,
      everyReferenceReachable: "PASS",
      everyOperationHasASqlDefinition: "PASS",
      everyParameterListMatchesItsSignature: "PASS",
      notCheckedHere: "whether the DEPLOYED edge function matches this file — run npm run verify:bridge-live"
    },
    null,
    2
  )
);
