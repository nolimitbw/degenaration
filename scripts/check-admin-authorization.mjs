/**
 * Two admin acceptance items, checked on every commit instead of once by hand.
 *
 * Master spec section 8 and section 17 both require "no arbitrary balance editor" and
 * "server-side admin only". Both were true, and both were established by querying production
 * once and writing the answer in a document. A property verified that way survives exactly
 * until the next migration, and the next migration is written by someone reading the document
 * rather than the catalog.
 *
 * So they are asserted here, against the SQL in this repository, before anything is deployed:
 *
 *   1. no admin function writes a user's money record — the balance editor cannot appear by
 *      accident, only by deleting a line of this file;
 *   2. every admin function is SECURITY DEFINER with search_path pinned to the empty string;
 *   3. every admin function is revoked from public, anon and authenticated — and, the property
 *      that actually mattered, NEVER granted to anon or authenticated afterwards.
 *
 * Property 3's second half is not hypothetical. supabase/admin-dashboard-secret-rpcs.sql ended
 * with `grant execute ... to anon, authenticated` on all five of its admin functions, two of
 * which approve or reject a Discord source. Production was not exposed — a later migration
 * revoked both roles — but the FILE was, and its own header instructs an operator to run
 * another file after it, so any replay would have re-granted the admin API to anonymous
 * callers while looking like an ordinary migration. A revoke-only check would have passed it,
 * because the revokes were there too, three lines above the grants.
 *
 * Property 2 is not decoration. A SECURITY DEFINER function without a pinned search_path
 * resolves unqualified names against the CALLER's path, so an attacker who can create a
 * schema can shadow a table the function reads and run their own code as the owner.
 *
 * PAYOUTS ARE NOT AN EXCEPTION AND ARE NOT COVERED HERE. `admin_decide_payout` legitimately
 * changes a payout request's state — spec section 8 lists approve/reject as an audited admin
 * action — and its ledger behaviour has its own verifier, `verify:payout-lifecycle`. What the
 * balance rule forbids is different in kind: writing a user's wallet, position, intent,
 * execution or cash movement directly, which is editing the record of what happened rather
 * than deciding something about it.
 */
import { readFileSync, readdirSync } from "node:fs";

const failures = [];
const fail = (message) => failures.push(message);

/**
 * Legacy definitions that pin search_path to `public, pg_temp` rather than the empty string.
 *
 * pg_temp is LAST, which is the documented mitigation: a caller's temp object cannot shadow
 * anything that exists in public. The residual vector is an unqualified name that does NOT
 * exist in public, which then resolves in pg_temp. Narrow, but a deviation from the standard
 * every function written since holds to, and the deployment record claimed "0 exceptions"
 * when there are four.
 *
 * Frozen deliberately. The list may shrink and may never grow: converting these to '' means
 * schema-qualifying every identifier in bodies that predate the convention, which is a real
 * change needing its own verification, and doing it badly breaks the admin console. A new
 * function may not join them.
 */
const LEGACY_UNQUALIFIED_PATH = new Set([
  "admin_list_server_applications",
  "admin_decide_server_application",
  "admin_list_call_channels",
  "admin_decide_call_channel",
  "admin_dashboard_summary"
]);

/**
 * A user's money record. Writing any of these from an admin path is editing history.
 * payout_requests and commission_ledger_entries are deliberately absent — see the header.
 */
const MONEY_TABLES = [
  "app_private.trading_wallets",
  "app_private.cash_movements",
  "app_private.positions",
  "app_private.position_lots",
  "app_private.trade_intents",
  "app_private.trade_executions",
  "app_private.withdrawal_intents"
];

const files = readdirSync("supabase").filter((f) => f.endsWith(".sql"));
const corpus = new Map(files.map((f) => [f, readFileSync(`supabase/${f}`, "utf8")]));

/** Strip line comments; a header naming a table is not a write to it. */
const executable = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*--.*$/gm, " ");

/**
 * Split a file into `create [or replace] function` bodies, so a property is attributed to the
 * function that has it rather than to the file. `$$ ... $$` delimits the body, and a file
 * holding six functions would otherwise pass on one function's `security definer`.
 */
function functionsIn(sql) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+((?:[a-z_]+\.)?[a-z_0-9]+)\s*\(/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const nameStart = match.index;
    const bodyStart = sql.indexOf("$$", nameStart);
    if (bodyStart < 0) continue;
    const bodyEnd = sql.indexOf("$$", bodyStart + 2);
    if (bodyEnd < 0) continue;
    out.push({
      name: match[1],
      header: sql.slice(nameStart, bodyStart),
      body: sql.slice(bodyStart, bodyEnd + 2),
      whole: sql.slice(nameStart, bodyEnd + 2)
    });
    re.lastIndex = bodyEnd + 2;
  }
  return out;
}

let admins = 0;
const seen = new Set();

for (const [file, raw] of corpus) {
  const sql = executable(raw);
  for (const fn of functionsIn(sql)) {
    const bare = fn.name.replace(/^public\./, "");
    if (!/^admin_/.test(bare)) continue;
    admins += 1;
    seen.add(bare);

    // 1. no money record is written
    for (const table of MONEY_TABLES) {
      const short = table.split(".")[1];
      const writes = new RegExp(
        `(?:update|insert\\s+into|delete\\s+from)\\s+(?:app_private\\.)?${short}\\b`, "i"
      );
      if (writes.test(fn.body)) {
        fail(`BALANCE EDITOR: ${bare} (${file}) writes ${table}. An admin path may DECIDE things ` +
          `— approve a source, pause a bot, resolve a payout — and may never edit the record of ` +
          `what happened to a user's money.`);
      }
    }

    // 2. definer rights with a pinned path
    if (!/security\s+definer/i.test(fn.header)) {
      fail(`INVOKER RIGHTS: ${bare} (${file}) is not SECURITY DEFINER, so it runs with the ` +
        `caller's privileges and its own authorization check decides nothing.`);
    }
    const emptyPath = /set\s+search_path\s*=\s*''/i.test(fn.header);
    const anyPath = /set\s+search_path\s*=/i.test(fn.header);
    if (!emptyPath && !(anyPath && LEGACY_UNQUALIFIED_PATH.has(bare))) {
      fail(`UNPINNED PATH: ${bare} (${file}) is SECURITY DEFINER without search_path = ''. ` +
        `Unqualified names then resolve against the caller's path, so a shadowed table runs ` +
        `attacker code as the function owner.` +
        (anyPath ? ` It sets a non-empty search_path and is not in the frozen legacy list.` : ""));
    }

    // 3. revoked from the public roles, in the file that defines it
    const revoked = new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${bare}\\s*\\(`, "i");
    const revokeLine = revoked.exec(sql);
    if (!revokeLine) {
      fail(`NOT REVOKED: ${bare} (${file}) has no "revoke execute ... from public, anon, ` +
        `authenticated". A new function is executable by PUBLIC by default.`);
      continue;
    }
    const revokeStatement = sql.slice(revokeLine.index).split(";")[0];
    for (const role of ["public", "anon", "authenticated"]) {
      if (!new RegExp(`\\b${role}\\b`, "i").test(revokeStatement)) {
        fail(`PARTIAL REVOKE: ${bare} (${file}) does not revoke execute from ${role}.`);
      }
    }

    // THE ONE THAT MATTERED. A revoke three lines above a grant is not a revoke.
    const granted = new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${bare}\\s*\\([^)]*\\)\\s*to\\s+([^;]+);`, "gi"
    );
    let grant;
    while ((grant = granted.exec(sql)) !== null) {
      const roles = grant[1].toLowerCase();
      for (const role of ["anon", "authenticated", "public"]) {
        if (new RegExp(`\\b${role}\\b`).test(roles)) {
          fail(`GRANTED TO ${role.toUpperCase()}: ${bare} (${file}) grants execute to ${role}. ` +
            `Only service_role may execute an admin function; the web app reaches these through ` +
            `the secret-checked bridge, which runs as service_role.`);
        }
      }
    }
  }
}

if (admins === 0) {
  fail("no admin_* function was found at all — the parser is broken, and a gate that finds " +
    "nothing to check reports success while checking nothing.");
}

if (failures.length) {
  console.error(`\nadmin authorization: ${failures.length} problem(s)\n`);
  for (const message of failures) console.error(`  - ${message}\n`);
  process.exit(1);
}

console.log(JSON.stringify({
  check: "admin-authorization",
  adminFunctionDefinitions: admins,
  distinctAdminFunctions: seen.size,
  sqlFiles: corpus.size,
  legacyNonEmptySearchPath: [...LEGACY_UNQUALIFIED_PATH].length,
  asserts: [
    "no admin function writes a wallet, position, lot, intent, execution, cash movement or withdrawal",
    "every admin function is SECURITY DEFINER",
    "every admin function pins search_path to the empty string",
    "every admin function is revoked from public, anon and authenticated",
    "no admin function is granted to public, anon or authenticated anywhere in its file"
  ],
  notCovered: "payout decisions, which are an audited admin action by design — see verify:payout-lifecycle"
}, null, 2));
