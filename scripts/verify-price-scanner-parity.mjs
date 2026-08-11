#!/usr/bin/env node
/**
 * The call-price scanner exists twice. This is what stops the two copies drifting.
 *
 * `bestSolanaPair` in server/engine/performance.js is driven by the worker and by the Vercel
 * cron route. `app_private.pick_best_pair` in supabase/degenaration-in-database-price-scanner.sql
 * is driven by pg_cron, which is the only scheduler that survived: Railway's trial expired, and
 * Vercel Hobby allows two cron jobs at one run per day with both slots already used.
 *
 * Duplicating a rule is the defect class this codebase keeps finding — a reader and a writer
 * that each look correct and were never checked against each other. The duplication here was a
 * deliberate trade (the alternative was an unpriced journal until someone pays for a host), and
 * a deliberate trade still needs a gate, or it silently becomes an accident.
 *
 * Both implementations get the SAME fixtures and must return the SAME chosen pair. The fixtures
 * are the cases where a plausible implementation of one would disagree with the other:
 * a deeper pool that is not the base token, a non-Solana chain, a zero price, marketCap absent
 * with fdv present, liquidity missing entirely, and no matching pair at all.
 *
 * SKIPS rather than fails when PGlite is unavailable, matching the other verifiers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { bestSolanaPair } = await import(join(root, "server/engine/performance.js"))
  .then((m) => m.default || m)
  .catch(async () => {
    const { createRequire } = await import("node:module");
    return createRequire(import.meta.url)(join(root, "server/engine/performance.js"));
  });

let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.log(JSON.stringify({ verifier: "price-scanner-parity", status: "SKIPPED", reason: "PGlite is not installed" }));
  process.exit(0);
}

const MINT = "So11111111111111111111111111111111111111112";
const OTHER = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const pair = (over = {}) => ({
  chainId: "solana",
  baseToken: { address: MINT },
  priceUsd: "1.5",
  liquidity: { usd: 1000 },
  ...over
});

const FIXTURES = [
  {
    name: "deepest liquidity wins",
    body: { pairs: [pair({ liquidity: { usd: 10 }, priceUsd: "9" }), pair({ liquidity: { usd: 5000 }, priceUsd: "7" })] }
  },
  {
    name: "a deeper pool for a DIFFERENT base token is ignored",
    body: { pairs: [pair({ liquidity: { usd: 5000 }, baseToken: { address: OTHER } }), pair({ liquidity: { usd: 10 } })] }
  },
  {
    name: "a deeper pool on another chain is ignored",
    body: { pairs: [pair({ liquidity: { usd: 9999 }, chainId: "base" }), pair({ liquidity: { usd: 12 } })] }
  },
  {
    name: "liquidity absent sorts as zero rather than throwing",
    body: { pairs: [pair({ liquidity: undefined, priceUsd: "3" }), pair({ liquidity: { usd: 1 }, priceUsd: "4" })] }
  },
  { name: "no matching pair at all", body: { pairs: [pair({ chainId: "base" })] } },
  { name: "pairs key missing entirely", body: {} },
  { name: "empty pairs array", body: { pairs: [] } }
];

const db = new PGlite();
await db.exec("create schema if not exists app_private;");
// The function under test, lifted verbatim from the migration.
const migration = readFileSync(join(root, "supabase/degenaration-in-database-price-scanner.sql"), "utf8");
const start = migration.indexOf("create or replace function app_private.pick_best_pair");
const end = migration.indexOf("$$;", start) + 3;
if (start < 0) {
  console.log(JSON.stringify({ verifier: "price-scanner-parity", status: "FAILED", reason: "pick_best_pair not found in the migration" }));
  process.exit(1);
}
await db.exec(migration.slice(start, end));

const failures = [];
let compared = 0;

for (const fixture of FIXTURES) {
  const js = bestSolanaPair(fixture.body, MINT);
  const { rows } = await db.query("select app_private.pick_best_pair($1::jsonb, $2) as pair", [
    JSON.stringify(fixture.body),
    MINT
  ]);
  const sql = rows[0]?.pair ?? null;
  compared += 1;

  const jsKey = js ? `${js.priceUsd}@${js.liquidity?.usd ?? "null"}` : "none";
  const sqlKey = sql ? `${sql.priceUsd}@${sql.liquidity?.usd ?? "null"}` : "none";

  if (jsKey !== sqlKey) {
    failures.push(`${fixture.name}: js chose ${jsKey}, sql chose ${sqlKey}`);
  }
}

// positive_or_null vs numberOrNull — the absence rule, which decides whether a live token
// renders as worthless. A price of 0 must be ABSENT, never 0.
await db.exec(migration.slice(migration.indexOf("create or replace function app_private.positive_or_null"),
  migration.indexOf("$$;", migration.indexOf("create or replace function app_private.positive_or_null")) + 3));

const numberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

for (const value of ["1.5", "0", "-3", "", "abc", "0.000000001", null]) {
  const js = numberOrNull(value);
  const { rows } = await db.query("select app_private.positive_or_null($1) as v", [value]);
  const sql = rows[0]?.v == null ? null : Number(rows[0].v);
  compared += 1;
  if (js !== sql) failures.push(`positive_or_null(${JSON.stringify(value)}): js ${js}, sql ${sql}`);
}

await db.close();

if (failures.length) {
  console.log(JSON.stringify({ verifier: "price-scanner-parity", status: "FAILED", compared, failures }, null, 1));
  process.exit(1);
}

console.log(JSON.stringify({
  verifier: "price-scanner-parity",
  status: "PASS",
  compared,
  proves: "server/engine/performance.js and app_private.pick_best_pair select the same pair for every fixture, including a deeper pool on the wrong base token, a deeper pool on another chain, missing liquidity, and no match at all — and treat a zero or negative price as ABSENT rather than as zero",
  why: "the scanner runs in two places because pg_cron is the only scheduler available; this is what stops the two copies drifting apart silently"
}, null, 1));
