#!/usr/bin/env node
// Repository lint gate (spec §24 "lint", §2.8–2.10, §13.1).
// Run: node scripts/check-code-quality.mjs
//
// Deliberately dependency-free. Generic ESLint would mean a new dependency and a large
// backlog of pre-existing style findings; what the release gate actually needs is
// enforcement of the rules THIS specification calls release-blocking. Strict `tsc`
// already covers type safety, so this checks the things a type checker cannot see.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["app", "components", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build"]);

let failures = 0;
const fail = (file, line, message) => {
  failures += 1;
  console.log(`  FAIL ${file}:${line} — ${message}`);
};

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) files.push(full);
  }
}
for (const dir of SCAN) walk(join(root, dir));

// Paths where money is computed. Floating-point arithmetic here is release-blocking.
const MONEY = /(fee|lamport|payout|commission|ledger|withdraw|balance|notional|referral)/i;

console.log(`code quality (${files.length} files)`);

for (const file of files) {
  const rel = relative(root, file);
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const isMoneyFile = MONEY.test(rel);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const n = index + 1;
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;

    // 1. Debug output left in shipped code (§2 self-review, §"Remove temporary logs").
    //    console.error/warn are legitimate error paths; console.log is not.
    if (/\bconsole\.log\s*\(/.test(line)) {
      fail(rel, n, "console.log left in source; remove debug output before completion");
    }

    // 2. Unresolved work markers presented as finished code.
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line) && !/eslint|@ts-/.test(line)) {
      fail(rel, n, "unresolved work marker; resolve it or record it in OPEN_BLOCKERS");
    }

    // 3. Suppressing the type checker rather than addressing the cause (§2.8).
    if (/@ts-(ignore|nocheck)/.test(line)) {
      fail(rel, n, "type checking suppressed; fix the cause instead of silencing it");
    }

    // 4. Swallowed errors. `catch {}` and `catch (e) {}` hide real failures (§2.9).
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}\s*$/.test(line)) {
      fail(rel, n, "empty catch swallows the error; handle it or comment why it is safe");
    }

    // 5. Floating-point arithmetic on money (§13.1). Integer lamports only.
    if (isMoneyFile) {
      if (/\/\s*1e9\b/.test(line) || /\*\s*1e9\b/.test(line)) {
        if (!/BigInt|Math\.round|Math\.floor|lamportsToSol|solToLamports/.test(line)) {
          fail(rel, n, "floating-point conversion on a money value; use integer lamports");
        }
      }
      if (/\/\s*10_?000\b/.test(line) && !/BigInt/.test(line)) {
        fail(rel, n, "basis-point division outside BigInt; use bpsOf() from lib/fee-model");
      }
      if (/\bparseFloat\s*\(/.test(line)) {
        fail(rel, n, "parseFloat on a money path; parse to integer lamports instead");
      }
    }

    // 6. Unsafe casts that bypass contract validation at a trust boundary (§2.9).
    if (/\bas\s+any\b/.test(line) && isMoneyFile) {
      fail(rel, n, "`as any` on a money path bypasses contract validation");
    }
  });

  // 7. A published control with no handler is a decorative button (§2.7).
  if (/<button(?![^>]*\b(onClick|type="submit"|disabled)\b)[^>]*>/.test(source)) {
    const idx = lines.findIndex((l) => /<button(?![^>]*\b(onClick|type="submit"|disabled)\b)[^>]*>/.test(l));
    if (idx >= 0) fail(rel, idx + 1, "button without onClick, submit type, or disabled state");
  }
}

if (failures > 0) {
  console.error(`\ncheck-code-quality: ${failures} problem(s)`);
  process.exit(1);
}
console.log("\ncheck-code-quality: clean");
