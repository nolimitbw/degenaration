#!/usr/bin/env node
/**
 * Does every column the worker reads actually exist where the worker will run?
 *
 * WHY THIS GATE EXISTS
 *
 * The funds incident had one cause: the deployed edge function did not implement four
 * operations the application called, and nothing in the repository could see that,
 * because both halves were individually correct. `npm run check:bridge-contract` now
 * catches that class for the bridge.
 *
 * The worker has the identical exposure and had no equivalent gate. It reads
 * `copy_subscriptions` and `subscriptions` over PostgREST, selecting `kill_switch`,
 * `subscriber_config_version_id` and `subscriber_config_snapshot`. Those columns are
 * added by supabase/degenaration-subscriber-config-versioning.sql, which is NOT applied
 * to production — verified 2026-08-04. PostgREST answers an unknown column with 400, so
 * the worker would fail on its very first subscriber load, on every tick, with a message
 * that names a column rather than a cause.
 *
 * That fact was recorded in a source comment and in OPEN_BLOCKERS E-1. A comment is not a
 * gate. This is.
 *
 * Three outcomes per column:
 *   in the captured production schema        -> fine, it exists today
 *   added by a migration IN the package      -> fine, deploying the package satisfies it
 *   added by a migration NOT in the package  -> FAIL, the worker breaks on deploy
 *   added by nothing at all                  -> FAIL, the worker breaks now
 *
 * Run: node scripts/check-worker-schema-contract.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PRODUCTION_TABLES } from "./lib/production-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DOC = join(root, "docs/ai/PENDING_DEPLOYMENT.md");

// PostgREST reserved query parameters — not columns.
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "and", "or"]);

let failures = 0;
const fail = (message) => { failures += 1; console.log(`  FAIL ${message}`); };

/** Every `<table>?<query>` string the worker builds, from any Supabase REST helper. */
function workerQueries() {
  const found = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { scan(full); continue; }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      // BOTH quote styles. This matched only template literals, and `loadOpenPositions` — the
      // largest query in the worker, ~27 columns of public.positions — is a double-quoted
      // string. So the one query most likely to read a column production lacks was the one
      // query this gate never checked, and it reported a clean run while skipping it.
      for (const match of source.matchAll(/sb(?:Get|Post|Patch|Delete)\(\s*[`"']([a-z_]+)\?((?:[^`"']|\\.)*)[`"']/g)) {
        found.push({ file: entry.name, table: match[1], query: match[2] });
      }
    }
  };
  scan(join(root, "server"));
  return found;
}

/** Columns a single query string depends on: the select list plus every filtered column. */
function columnsUsed(query) {
  const columns = new Set();
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "select") {
      if (value.trim() === "*") continue;
      // Embedded resources (`bot(name)`) name a relationship, not a column of this table.
      for (const column of value.split(",")) {
        const clean = column.split("(")[0].split(":").pop().trim();
        if (clean && !clean.includes("$") && /^[a-z_][a-z0-9_]*$/.test(clean)) columns.add(clean);
      }
      continue;
    }
    if (key === "order") {
      const clean = value.split(".")[0].trim();
      if (clean && /^[a-z_][a-z0-9_]*$/.test(clean)) columns.add(clean);
      continue;
    }
    if (RESERVED.has(key)) continue;
    if (/^[a-z_][a-z0-9_]*$/.test(key)) columns.add(key);
  }
  return columns;
}

/** Which repo migration, if any, adds this column to this table. */
function migrationAdding(table, column) {
  const files = readdirSync(join(root, "supabase")).filter((name) => name.endsWith(".sql"));
  const addPattern = new RegExp(`add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${column}\\b`, "i");
  const tablePattern = new RegExp(`alter\\s+table[^;]*\\b${table}\\b`, "i");
  const createPattern = new RegExp(`create\\s+table[^;]*\\b${table}\\b[^;]*\\b${column}\\b`, "is");
  for (const name of files) {
    const source = readFileSync(join(root, "supabase", name), "utf8");
    if (createPattern.test(source)) return name;
    if (!tablePattern.test(source)) continue;
    // The ALTER and the ADD must belong to the same statement, not merely the same file.
    for (const statement of source.split(";")) {
      if (tablePattern.test(statement) && addPattern.test(statement)) return name;
    }
  }
  return null;
}

console.log("worker schema contract");

const packageDoc = readFileSync(PACKAGE_DOC, "utf8");
const queries = workerQueries();
if (queries.length === 0) fail("no worker PostgREST queries were found — this gate would pass vacuously");

const captured = new Map();
for (const [qualified, table] of Object.entries(PRODUCTION_TABLES)) {
  captured.set(qualified.split(".")[1], new Set(table.columns.map((column) => column.name)));
}

let checked = 0;
const uncapturedTables = new Set();
for (const { file, table, query } of queries) {
  const live = captured.get(table);
  if (!live) { uncapturedTables.add(table); continue; }
  for (const column of columnsUsed(query)) {
    checked += 1;
    if (live.has(column)) continue;
    const migration = migrationAdding(table, column);
    if (!migration) {
      fail(`server/${file}: reads ${table}.${column}, which is in no captured production table and no migration adds it`);
      continue;
    }
    if (!packageDoc.includes(migration)) {
      fail(`server/${file}: reads ${table}.${column}, added only by supabase/${migration}, which is NOT in the deployment package — PostgREST returns 400 for an unknown column, so the worker fails on first read`);
      continue;
    }
    console.log(`  note ${table}.${column} needs supabase/${migration} (in the package, apply before the worker runs)`);
  }
}

console.log(`  ok   ${checked} column reads checked across ${queries.length} worker queries`);
if (uncapturedTables.size) {
  console.log(`  note ${uncapturedTables.size} table(s) not in the schema capture, so unchecked: ${[...uncapturedTables].sort().join(", ")}`);
}

if (failures) {
  console.log(`\ncheck-worker-schema-contract: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-worker-schema-contract: worker reads are satisfied by production plus the deployment package");
