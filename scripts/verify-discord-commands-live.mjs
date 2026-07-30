#!/usr/bin/env node
// Post-deploy Discord command verification (spec §15.1).
//
// Run: DISCORD_BOT_TOKEN=... DISCORD_APP_ID=... node scripts/verify-discord-commands-live.mjs
//
// scripts/check-discord-commands.mjs verifies the SOURCE registry. It cannot see what
// Discord is actually serving, and the duplicate /register was never a source problem —
// stale GLOBAL commands from an earlier deployment survived guild-scoped redeployment.
// Only Discord's own API can confirm that scope is now empty.
//
// Read-only. It lists and reports; it never registers or deletes anything, so it is safe
// to run against production.

const API = "https://discord.com/api/v10";

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID;

let failures = 0;
const fail = (m) => { failures += 1; console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  --   ${m}`);

if (!token || !appId) {
  console.log("verify-discord-commands-live: DISCORD_BOT_TOKEN and DISCORD_APP_ID required.");
  console.log("");
  console.log("This check needs the deployed bot's credentials, which are owner-held. Run it");
  console.log("after deploying the worker to confirm the duplicate /register is gone:");
  console.log("");
  console.log("  DISCORD_BOT_TOKEN=... DISCORD_APP_ID=... npm run verify:discord-live");
  console.log("");
  process.exit(0);
}

async function api(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bot ${token}` }
  });
  if (response.status === 401) throw new Error("unauthorized — check DISCORD_BOT_TOKEN");
  if (response.status === 403) throw new Error("forbidden — the token lacks applications.commands access");
  if (!response.ok) throw new Error(`${response.status} ${await response.text().catch(() => "")}`.slice(0, 160));
  return response.json();
}

console.log("discord commands, live application");

let globals;
try {
  globals = await api(`/applications/${appId}/commands`);
} catch (e) {
  console.log(`  FAIL could not read global commands: ${e.message}`);
  process.exit(1);
}

// The root cause. Guild-scoped deployment never clears this list, so anything here is
// served ALONGSIDE the guild copies and appears twice in the client.
if (globals.length === 0) {
  ok("global command scope is empty — no duplicate source");
} else {
  fail(`global scope still serves ${globals.length} command(s): ${globals.map((c) => `/${c.name}`).join(", ")}`);
  note("these appear in the client IN ADDITION to the guild-scoped copies");
  note("clearGlobalCommands() in server/bot/index.js empties this on startup — has the worker restarted?");
}

let guilds;
try {
  guilds = await api("/users/@me/guilds");
} catch (e) {
  note(`could not enumerate guilds (${e.message}); global check above still stands`);
  guilds = [];
}

note(`bot is installed in ${guilds.length} guild(s)`);

const EXPECTED = ["register", "alpha", "degen", "test-call", "onboard", "help"];

for (const guild of guilds) {
  let commands;
  try {
    commands = await api(`/applications/${appId}/guilds/${guild.id}/commands`);
  } catch (e) {
    fail(`${guild.name}: could not read guild commands — ${e.message}`);
    continue;
  }

  const names = commands.map((c) => c.name);
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);

  const duplicated = [...counts.entries()].filter(([, n]) => n > 1);
  if (duplicated.length) {
    fail(`${guild.name}: duplicated within the guild scope — ${duplicated.map(([n, c]) => `/${n}×${c}`).join(", ")}`);
  }

  const registerTotal = (counts.get("register") || 0) + globals.filter((c) => c.name === "register").length;
  if (registerTotal === 1) {
    ok(`${guild.name}: /register served exactly once`);
  } else {
    fail(`${guild.name}: /register served ${registerTotal} time(s) across global + guild scope`);
  }

  const missing = EXPECTED.filter((n) => !names.includes(n));
  if (missing.length) note(`${guild.name}: not yet deployed — ${missing.map((n) => `/${n}`).join(", ")}`);

  const unexpected = names.filter((n) => !EXPECTED.includes(n));
  if (unexpected.length) fail(`${guild.name}: serving undocumented command(s) ${unexpected.map((n) => `/${n}`).join(", ")}`);
}

console.log("");
if (failures > 0) {
  console.error(`verify-discord-commands-live: ${failures} problem(s) — requirement 7 is NOT satisfied`);
  process.exit(1);
}
console.log("verify-discord-commands-live: exactly one copy of every command is served");
