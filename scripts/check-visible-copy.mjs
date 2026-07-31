#!/usr/bin/env node
// Public UI copy check.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §4.4, §6.1, §11.4, §23.
// Run: node scripts/check-visible-copy.mjs
//
// Fails on internal engineering language, placeholder text, and emoji or Unicode
// pictograms used as interface icons in production UI.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Admin Console is where operational detail belongs, so it is exempt (§11.4).
// lib/ is scanned too: user-facing strings live there (e.g. AUTOMATED_MAINNET_RELEASE
// .reason renders in the header popover), and a checker that only reads app/ and
// components/ misses them. Browser verification is what surfaced that blind spot.
const SCAN_DIRS = ["app", "components", "lib"];
const EXEMPT = [
  join("app", "admin"),
  join("components", "admin"),
  join("lib", "server")
];

// Phrases that describe the implementation rather than the user's situation.
const FORBIDDEN_PHRASES = [
  "activation locked",
  "activation remains locked",
  "release locked",
  "release gates",
  "release review",
  "remain locked",
  "remains locked",
  "controlled release",
  "no fallback fills",
  "database reserves",
  "engine not configured",
  "immutable commission accounting",
  "immutable accounting",
  "insufficient measured",
  "insufficient history",
  "atomically",
  "lorem ipsum",
  "unlock your potential",
  "revolutionize your trading",
  "coming soon",
  "todo:",
  "tbd"
];
// `placeholder=` is a legitimate input attribute, so the word itself is not forbidden.

// Unicode pictograms used as interface affordances. Real icons come from the SVG icon
// layer (§5.6). Typographic punctuation is allowed.
const PICTOGRAM = /[←-⇿☀-➿⬀-⯿️\u{1F000}-\u{1FAFF}]/u;
const PICTOGRAM_ALLOWLIST = new Set(["→", "←"]); // → ← in prose only

let failures = 0;
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(root, full);
    if (EXEMPT.some((e) => rel.startsWith(e))) continue;
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full);
    else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
  }
}

for (const dir of SCAN_DIRS) walk(join(root, dir));

console.log(`public copy (${files.length} files)`);

for (const file of files) {
  const rel = relative(root, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // Skip comment-only lines; comments are not user-visible.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;

    const lower = line.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lower.includes(phrase)) {
        failures += 1;
        console.log(`  FAIL ${rel}:${index + 1} — forbidden public copy: "${phrase}"`);
      }
    }

    for (const char of line) {
      if (PICTOGRAM.test(char) && !PICTOGRAM_ALLOWLIST.has(char)) {
        failures += 1;
        console.log(`  FAIL ${rel}:${index + 1} — Unicode pictogram "${char}" used in UI; use an SVG icon`);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Second pass: API error strings that reach the public UI.
//
// lib/server/ is exempt above, which is correct for genuinely server-only text — but it
// is ALSO where the product APIs build their `error` fields, and lib/product-api.ts
// `parseResponse` throws that field VERBATIM for the dashboards to render. So
// "server not configured" and "database request failed" were user-visible while sitting
// in an exempt directory. The bot builder was observed displaying the first one.
//
// This pass scans only the paths whose errors are consumed by productFetch, so it stays
// low-noise: bot/admin endpoints may keep technical errors, since no public UI shows them.
const API_ERROR_DIRS = [join("app", "api", "product"), join("lib", "server", "app-bridge.ts")];
const INTERNAL_VOCAB = [
  "database", "supabase", "postgres", "rpc", "not configured", "env var",
  "service role", "admin_key", "secret", "bridge", "internal error", "stack"
];

const apiFiles = [];
for (const target of API_ERROR_DIRS) {
  const full = join(root, target);
  try {
    if (statSync(full).isDirectory()) walkAll(full, apiFiles);
    else apiFiles.push(full);
  } catch { /* path absent — nothing to scan */ }
}

function walkAll(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkAll(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
}

console.log(`\napi error copy (${apiFiles.length} files)`);

for (const file of apiFiles) {
  const rel = relative(root, file);
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    // Only string literals assigned to an `error` field cross to the client.
    const match = line.match(/error:\s*"([^"]+)"/);
    if (!match) return;
    const message = match[1].toLowerCase();
    for (const term of INTERNAL_VOCAB) {
      if (message.includes(term)) {
        failures += 1;
        console.log(`  FAIL ${rel}:${index + 1} — user-visible API error leaks internal language: "${match[1]}"`);
        break;
      }
    }
  });
}

if (failures > 0) {
  console.error(`\ncheck-visible-copy: ${failures} problem(s)`);
  process.exit(1);
}
console.log("\ncheck-visible-copy: clean");
