/**
 * Every bot control must change what the engine does, or say that it does not yet.
 *
 * The defect class this closes has shipped twice already: take-profit levels past the second,
 * and trailing stops, were both collected, validated, versioned and persisted — and read by
 * nothing. Neither a type check nor a test of the save path can see it, because the save path
 * is correct. Only the relationship between the writer and the readers is wrong.
 *
 * So the relationship is declared in lib/bot-control-contract.js and checked here:
 *
 *   1. every path BotBuilder.buildConfig() persists is declared — an undeclared control fails,
 *      so a new one cannot be added silently;
 *   2. every ENFORCED entry's evidence token is genuinely present in the reader file it names;
 *   3. every PENDING entry's leaf key is absent from every reader — so a control that gets
 *      implemented must be promoted rather than left labelled pending;
 *   4. no entry names a control buildConfig() no longer persists.
 *
 * Property 3 is the one that keeps this honest in the other direction. A gate that only
 * catches new unread controls would let the notices rot into lies as controls get built.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BOT_CONTROL_CONTRACT, READER_GLOBS, EXECUTION_GLOBS, probesFor } =
  require(`${process.cwd()}/lib/bot-control-contract.js`);

const failures = [];
const fail = (message) => failures.push(message);

// ── what the builder persists ──────────────────────────────────────────────────────────────
const builder = readFileSync("components/product/BotBuilder.tsx", "utf8");
const start = builder.indexOf("function buildConfig()");
const end = builder.indexOf("async function save(", start);
if (start < 0 || end < 0) {
  console.error("check-bot-control-contract: buildConfig() not found in BotBuilder.tsx");
  process.exit(1);
}
const body = builder.slice(start, end);

/**
 * Key paths from the returned object literal, by depth.
 *
 * Indentation was tried first and is wrong: `takeProfit: { levels: x, trailing: y },` puts two
 * nested keys on one line, and `walletAddress,` is a shorthand property with no colon at all.
 * Both slipped through, so the scanner tracks braces instead. Depth 1 keys whose value is an
 * object contribute their children rather than themselves — `takeProfit` is not a control,
 * `takeProfit.levels` is — except when that object is empty.
 */
function persistedPaths(source) {
  const open = source.indexOf("return {");
  const text = source.slice(open + "return".length);
  const paths = [];
  const stack = [];
  let depth = 0, i = 0, expectKey = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) break; continue; }
    if (ch === "{" || ch === "[" || ch === "(") {
      if (ch === "{") { depth += 1; expectKey = true; } else { stack.push(ch); }
      i += 1; continue;
    }
    if (ch === "}" ) { depth -= 1; if (depth === 0) break; stack.pop(); i += 1; continue; }
    if (ch === "]" || ch === ")") { stack.pop(); i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch; i += 1;
      while (i < text.length && text[i] !== quote) i += text[i] === "\\" ? 2 : 1;
      i += 1; continue;
    }
    const key = /^([a-zA-Z][a-zA-Z0-9]*)\s*([:,}])/.exec(text.slice(i));
    if (key && expectKey && depth >= 1 && depth <= 2) {
      const name = key[1];
      const prefix = depth === 2 && stack.length === 0 ? null : null;
      void prefix;
      const rest = text.slice(i + key[0].length - 1).replace(/^[:,]\s*/, "");
      const opensObject = key[2] === ":" && rest.startsWith("{") && !/^\{\s*\}/.test(rest);
      const opensTernaryObject = key[2] === ":" && /^[a-zA-Z][\w.]*\s*===?\s*["'][a-z]+["']\s*\?\s*\{/.test(rest);
      if (depth === 1) {
        if (opensObject || opensTernaryObject) parentAtDepth2 = name;
        else paths.push(name);
      } else if (depth === 2 && parentAtDepth2) {
        paths.push(`${parentAtDepth2}.${name}`);
      }
      expectKey = false;
      i += key[0].length - 1;
      continue;
    }
    if (ch === ",") { expectKey = true; i += 1; continue; }
    i += 1;
  }
  return paths;
}
let parentAtDepth2 = null;
const persisted = persistedPaths(body);
const persistedSet = new Set(persisted);

// ── reader corpus ──────────────────────────────────────────────────────────────────────────
function collect(target, out) {
  let info;
  try { info = statSync(target); } catch { return out; }
  if (info.isDirectory()) {
    for (const entry of readdirSync(target)) collect(`${target}/${entry}`, out);
    return out;
  }
  if (/\.(js|mjs|ts|sql)$/.test(target)) out.set(target, readFileSync(target, "utf8"));
  return out;
}
const readers = new Map();
for (const glob of READER_GLOBS) collect(glob, readers);

/**
 * The EXECUTION corpus, deliberately narrower than the reader corpus.
 *
 * A config value only changes a trade by reaching the engine — directly out of
 * extended_config / entry_config, or through a subscription column the save RPC projects it
 * into. Appearing in SQL is therefore not evidence of enforcement on its own: three controls
 * appear only in degenaration-subscriber-config-versioning.sql, which BUILDS a legacy baseline
 * config and VALIDATES a submitted one. Storing a number and validating its range is not
 * acting on it, and treating it as such is precisely the mistake this gate exists to catch.
 *
 * So "pending" is judged against the engine alone, and an "enforced" claim must name every
 * link of its chain.
 */
const execution = new Map();
for (const glob of EXECUTION_GLOBS) collect(glob, execution);

/**
 * Comments do not enforce anything. A migration header naming `trailing` was, for a while,
 * the only place `trailing` appeared — stripping comments is what makes "no reader" mean it.
 */
function executable(source, file) {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  return file.endsWith(".sql")
    ? withoutBlock.replace(/^\s*--.*$/gm, " ")
    : withoutBlock.replace(/^\s*\/\/.*$/gm, " ");
}
const executableReaders = new Map([...readers].map(([file, source]) => [file, executable(source, file)]));
const executableExecution = new Map([...execution].map(([file, source]) => [file, executable(source, file)]));

// ── 1. every persisted control is declared ─────────────────────────────────────────────────
const declared = new Map(BOT_CONTROL_CONTRACT.map((entry) => [entry.path, entry]));
for (const path of persistedSet) {
  if (!declared.has(path)) {
    fail(`UNDECLARED CONTROL: buildConfig() persists "${path}" and lib/bot-control-contract.js does not declare it. ` +
      `Add it as enforced with its reader, or as pending with a truthful reason the builder will show.`);
  }
}

// ── 4. no declaration for a control that is gone ───────────────────────────────────────────
for (const entry of BOT_CONTROL_CONTRACT) {
  if (!persistedSet.has(entry.path)) {
    fail(`DEAD DECLARATION: the contract declares "${entry.path}" and buildConfig() no longer persists it.`);
  }
}

// ── 2 and 3. the claims themselves ─────────────────────────────────────────────────────────
for (const entry of BOT_CONTROL_CONTRACT) {
  if (entry.status === "enforced") {
    const links = Array.isArray(entry.readBy) ? entry.readBy : [entry.readBy];
    if (!links.length) { fail(`UNVERIFIABLE CLAIM: "${entry.path}" is enforced by nothing.`); continue; }
    for (const link of links) {
      const source = executableReaders.get(link?.file);
      if (source === undefined) {
        fail(`UNVERIFIABLE CLAIM: "${entry.path}" names reader file ${link?.file}, which is not in the reader corpus.`);
        continue;
      }
      if (!source.includes(link.token)) {
        fail(`FALSE CLAIM: "${entry.path}" is declared enforced by ${link.file}, ` +
          `but the token "${link.token}" is not in that file's executable text.`);
      }
    }
    // Every enforced control must terminate in the engine. A chain that stops at SQL has
    // stored the value, not acted on it.
    if (!links.some((link) => [...executableExecution.keys()].includes(link.file))) {
      fail(`INCOMPLETE CHAIN: "${entry.path}" is declared enforced but no link names an execution file. ` +
        `Storing a value is not enforcing it — name the engine file that consumes it.`);
    }
    continue;
  }

  if (entry.status !== "pending") {
    fail(`BAD STATUS: "${entry.path}" has status "${entry.status}"; only "enforced" and "pending" exist.`);
    continue;
  }
  if (!entry.reason || entry.reason.length < 20) {
    fail(`MISSING REASON: pending control "${entry.path}" needs a sentence the user can read.`);
  }
  // Explicit probes rather than the bare leaf key. `enabled`, `trailing` and `dynamic` all
  // occur throughout the engine for unrelated reasons, so a leaf search reported six controls
  // as implemented that are not. A probe is the shape an actual READ of this path takes.
  const probes = probesFor(entry);
  const seen = [...executableExecution]
    .filter(([, source]) => probes.some((probe) => source.includes(probe)))
    .map(([file]) => file);
  if (seen.length) {
    fail(`STALE PENDING: "${entry.path}" is declared pending, but one of [${probes.join(", ")}] ` +
      `appears in ${seen.join(", ")}. If it is now read, promote it to enforced; the builder is ` +
      `currently telling users it does nothing.`);
  }
}

const enforced = BOT_CONTROL_CONTRACT.filter((entry) => entry.status === "enforced").length;
const pending = BOT_CONTROL_CONTRACT.length - enforced;

if (failures.length) {
  console.error(`\nbot control contract: ${failures.length} problem(s)\n`);
  for (const message of failures) console.error(`  - ${message}\n`);
  process.exit(1);
}

console.log(JSON.stringify({
  check: "bot-control-contract",
  persistedControls: persistedSet.size,
  declared: BOT_CONTROL_CONTRACT.length,
  enforced,
  pending,
  readerFiles: readers.size,
  executionFiles: execution.size,
  asserts: [
    "every persisted control is declared",
    "every enforced claim's token is present in the reader it names",
    "every pending control's read-shaped probes are absent from every execution file",
    "every enforced control's chain terminates in an execution file",
    "no declaration outlives its control"
  ],
  note: "pending controls are shown to the user with their reason; they are saved and versioned, and they do not change execution"
}, null, 2));
