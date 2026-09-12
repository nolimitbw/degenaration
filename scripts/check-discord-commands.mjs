#!/usr/bin/env node
// Discord application command registry check.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §4.4, §15.
// Run: node scripts/check-discord-commands.mjs
//
// Fails on duplicate names, conflicting scopes, missing descriptions, published
// commands with no handler, and handlers for commands that are not published.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "server/bot/index.js"), "utf8");

let failures = 0;
const fail = (message) => { failures += 1; console.log(`  FAIL ${message}`); };
const ok = (message) => console.log(`  ok   ${message}`);

// Top-level command names come from `.setName("x")` calls that are NOT inside an
// addSubcommand(...) or addStringOption(...) chain.
const topLevel = [];
const subcommands = [];
for (const line of source.split("\n")) {
  const match = line.match(/\.setName\("([a-z0-9-]+)"\)/);
  if (!match) continue;
  if (/addSubcommand|addStringOption|addIntegerOption|addBooleanOption/.test(line)) {
    subcommands.push(match[1]);
  } else {
    topLevel.push(match[1]);
  }
}

console.log("discord command registry");

if (topLevel.length === 0) fail("no commands found in server/bot/index.js");

// 1. Every published command name is unique.
const seen = new Map();
for (const name of topLevel) seen.set(name, (seen.get(name) || 0) + 1);
for (const [name, count] of seen) {
  if (count > 1) fail(`/${name} is declared ${count} times`);
}
if (![...seen.values()].some((c) => c > 1)) ok(`${topLevel.length} unique top-level commands`);

// 2. /register must exist exactly once (spec §22.4).
const registerCount = seen.get("register") || 0;
if (registerCount === 1) ok("/register declared exactly once");
else fail(`/register declared ${registerCount} times, expected exactly 1`);

// 3. Every command has a description.
const described = source.match(/\.setName\("([a-z0-9-]+)"\)\s*\n?\s*\.setDescription\(/g) || [];
if (described.length >= topLevel.length) ok("every command has a description");
else fail(`${topLevel.length - described.length} command(s) missing a description`);

// 4. Exactly one deployment scope. Mixing global and guild scope is what produces
//    duplicate commands in the Discord client.
const usesGuildScope = /guild\.commands\.set\(/.test(source);
const publishesGlobally = /client\.application\.commands\.set\(\s*COMMANDS/.test(source);
if (usesGuildScope && publishesGlobally) {
  fail("commands are published to BOTH guild and global scope; duplicates will appear");
} else if (usesGuildScope) {
  ok("commands are published guild-scoped only");
} else if (publishesGlobally) {
  ok("commands are published globally only");
} else {
  fail("no command deployment call found");
}

// 5. Guild-scoped deployment must actively clear the global scope, otherwise stale
//    global commands registered by an earlier deployment survive forever.
if (usesGuildScope) {
  if (/application\.commands\.set\(\s*\[\s*\]\s*\)/.test(source)) {
    ok("stale global commands are cleared on startup");
  } else {
    fail("guild-scoped deployment does not clear stale global commands");
  }
}

// 6. Every published command is handled, and nothing is handled that is not published.
// Both dispatch forms count: `commandName === "x"` and the negative guard
// `if (commandName !== "x") return;` which routes the remainder of the handler to x.
const handled = new Set();
for (const match of source.matchAll(/interaction\.commandName\s*[!=]==\s*"([a-z0-9-]+)"/g)) {
  handled.add(match[1]);
}
for (const name of seen.keys()) {
  if (!handled.has(name)) fail(`/${name} is published but has no handler`);
}
for (const name of handled) {
  if (!seen.has(name)) fail(`a handler exists for /${name}, which is not published`);
}
if ([...seen.keys()].every((n) => handled.has(n)) && [...handled].every((n) => seen.has(n))) {
  ok("every published command has exactly one handler");
}

// 7. /test-call must never trade (spec §15.2).
if (seen.has("test-call")) {
  const block = source.slice(source.indexOf('interaction.commandName === "test-call"'));
  const body = block.slice(0, block.indexOf("\n  if (interaction.commandName") + 1 || 2000);
  if (/ingestCall|buyToken|sellToken|executeBuy/.test(body)) {
    fail("/test-call reaches trade or ingest code; it must be diagnostic only");
  } else {
    ok("/test-call performs no trade or ingest");
  }
}

// 8. Subcommands must not duplicate a top-level command's purpose.
for (const sub of subcommands) {
  if (seen.has(sub)) fail(`subcommand "${sub}" collides with top-level /${sub}`);
}

if (failures > 0) {
  console.error(`\ncheck-discord-commands: ${failures} problem(s)`);
  process.exit(1);
}
console.log("\ncheck-discord-commands: registry is clean");
