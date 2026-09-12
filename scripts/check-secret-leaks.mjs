/** Fail the release when authentication material is committed to a tracked text file. */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const listed = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (listed.status !== 0) throw new Error("could not enumerate tracked files");

const signatures = [
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["Stripe live secret", /\bsk_live_[A-Za-z0-9]{16,}\b/],
  ["Discord bot token", /\b(?:MTA|MTI|MTM|MTQ|MTU|MTY|MTc|MTg|MTk)[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}\b/]
];
const textExtensions = /(?:^|\.)(?:env(?:\.[\w-]+)?|js|jsx|mjs|cjs|ts|tsx|json|md|sql|toml|ya?ml|txt|sh)$/i;
const findings = [];

for (const file of listed.stdout.split("\0").filter(Boolean)) {
  if (!textExtensions.test(file) || file === "package-lock.json") continue;
  let contents;
  try { contents = readFileSync(file, "utf8"); } catch { continue; }
  for (const [name, pattern] of signatures) {
    const match = pattern.exec(contents);
    if (match) findings.push(`${file}:${contents.slice(0, match.index).split("\n").length} — ${name}`);
  }
}

if (findings.length) {
  console.error(`check-secret-leaks: FAIL\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`check-secret-leaks: clean (${listed.stdout.split("\0").filter(Boolean).length} tracked files)`);
