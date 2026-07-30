#!/usr/bin/env node
// Signal journal contract check.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §4.4, §9.
// Run: node scripts/verify-performance-journal.mjs
//
// Static contract verification: confirms the schema can express a complete journal and
// that the parser handles the fixture cases §22.3 requires. It deliberately does NOT
// claim the live pipeline works — that needs database access (OPEN_BLOCKERS B-4) and is
// reported as unverified rather than silently passed.

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const fail = (m) => { failures += 1; console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);

// Concatenate the SQL so a table may live in any migration file.
const sql = readdirSync(join(root, "supabase"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(root, "supabase", f), "utf8"))
  .join("\n");

console.log("journal schema contract");

const REQUIRED_TABLES = [
  "raw_signals",
  "parsed_signals",
  "signal_deliveries",
  "trade_intents",
  "trade_executions",
  "performance_snapshots"
];
for (const table of REQUIRED_TABLES) {
  if (new RegExp(`create table if not exists app_private\\.${table}\\b`).test(sql)) {
    ok(`${table} exists`);
  } else {
    fail(`${table} is missing — the journal cannot be complete without it`);
  }
}

// A raw event must be storable before parsing, so a parser bug never loses a call.
if (/create table if not exists app_private\.raw_signals[\s\S]{0,900}?content_hash/.test(sql)) {
  ok("raw_signals carries a content hash for immutable dedupe");
} else {
  fail("raw_signals has no content_hash column");
}

// Deduplication must be enforced by the database, not by application convention.
//
// This check previously just looked for the word "unique" near the table and passed. That
// was a FALSE PASS: the constraint that existed was
// UNIQUE (source_type, source_ref, external_event_id), and Postgres treats NULLs as
// distinct in a unique index, so two identical deliveries with a NULL external_event_id
// both inserted. Confirmed against the live database before being fixed.
//
// A dedupe constraint is only trustworthy if every column in it is NOT NULL, so require
// one anchored on content_hash, which is.
if (/unique index[^;]*raw_signals[^;]*content_hash/i.test(sql)) {
  ok("raw_signals dedupe is anchored on content_hash (NOT NULL, so NULLs cannot defeat it)");
} else if (/raw_signals[\s\S]{0,900}?unique/i.test(sql)) {
  fail("raw_signals has a uniqueness constraint, but none anchored on content_hash — a NULL "
     + "in any nullable column of the constraint lets duplicates through");
} else {
  fail("raw_signals has no uniqueness constraint; duplicates can be journaled twice");
}

console.log("parser fixture cases (spec 22.3)");

const { parseCall } = require(join(root, "server/bot/parser.js"));
const MINT = "6dNUKef4vjbxWnPeGCTk9nu6y2CybnrKGCB6Ke2ApUMP";
const OTHER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const cases = [
  ["direct mint", `buy ${MINT} now`, (r) => r && r.mint === MINT],
  ["pump.fun link", `pump.fun/coin/${MINT}`, (r) => r && r.mint === MINT],
  ["dexscreener link", `dexscreener.com/solana/${OTHER}`, (r) => r && r.mint === OTHER],
  ["ticker only is rejected", "$WIF is pumping", (r) => r === null],
  ["plain chatter is rejected", "gm frens wagmi", (r) => r === null],
  ["empty input is rejected", "", (r) => r === null],
  ["oversized input is rejected", "x".repeat(3000), (r) => r === null],
  ["ambiguous two-mint post is rejected", `a ${OTHER} b ${MINT}`, (r) => r === null]
];

for (const [label, input, assertion] of cases) {
  let result = null;
  try {
    result = parseCall(input);
  } catch (e) {
    fail(`${label} threw: ${e.message}`);
    continue;
  }
  if (assertion(result)) ok(label);
  else fail(`${label} — got ${JSON.stringify(result)}`);
}

// Same message twice must parse identically, so dedupe upstream is deterministic.
const a = parseCall(`call ${MINT}`);
const b = parseCall(`call ${MINT}`);
if (a && b && a.mint === b.mint && a.confidence === b.confidence) {
  ok("parsing is deterministic across repeated delivery");
} else {
  fail("parsing is not deterministic; deduplication cannot be trusted");
}

console.log("");
console.log("UNVERIFIED: this check is static. It does not prove the live pipeline");
console.log("journals anything. Ingestion, eligibility, baseline pricing, sampling, and");
console.log("aggregation require database access — see OPEN_BLOCKERS.md B-4.");

if (failures > 0) {
  console.error(`\nverify-performance-journal: ${failures} problem(s)`);
  process.exit(1);
}
console.log("\nverify-performance-journal: schema and parser contract hold");
