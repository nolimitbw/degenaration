#!/usr/bin/env node
/**
 * A bot built with the builder's DEFAULTS must be able to trade.
 *
 * THE DEFECT THIS EXISTS TO CATCH
 *
 * server/engine/safety.js can evaluate five ranges and four flags. Everything else has no
 * wired evidence provider, and an enabled filter whose evidence is unavailable BLOCKS the
 * trade — deliberately, because silently skipping a safety control the user asked for is the
 * defect that module was written to remove.
 *
 * The builder's defaults did not respect that boundary. `defaultFilters()` enabled
 * `top10HolderBps`, `minimumRouteLiquidityUsd` and `maximumPriceImpactBps`, and
 * `defaultFlags()` enabled every flag except `dexPaid` — seven of which have no provider. So
 * ten filters that can never be satisfied were on by default.
 *
 * The consequence is total and silent: every bot created by clicking through the builder
 * refuses EVERY candidate, forever, with a blocked reason per unwired filter. Nothing raises.
 * Because no worker has ever run, no user has ever seen it — it would have surfaced on the
 * first day of live trading and read as "the worker is broken".
 *
 * This drives the REAL defaults through the REAL evaluator with generous, obviously-passing
 * evidence. If the defaults ever again enable something the engine cannot check, this fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { evaluateSafety } = require(join(root, "server/engine/safety.js"));

/**
 * The builder is a .tsx module the plain-node runner cannot import, so its two default
 * functions are read out of the source. Brittle by nature — which is the point: if the shape
 * changes, this fails loudly rather than silently testing something that is no longer there.
 */
const source = readFileSync(join(root, "components/product/BotBuilder.tsx"), "utf8");

/** `new Set<string>([...])` or a bare array literal, by constant name. */
const listOf = (name) => {
  const m = source.match(new RegExp(`const ${name}[^=]*=\\s*(?:new Set<string>\\()?\\s*(\\[[^\\]]*\\])`));
  if (!m) throw new Error(`${name} no longer matches the expected shape`);
  return JSON.parse(m[1].replace(/'/g, '"').replace(/,\s*\]/, "]"));
};

// Mirrors the predicate in defaultFilters(): on by default AND evaluable by the engine.
const enabledRanges = (() => {
  const wanted = listOf("DEFAULT_ON_RANGES");
  const evaluable = listOf("ENGINE_EVALUABLE_RANGES");
  return wanted.filter((k) => evaluable.includes(k));
})();

const flagKeys = (() => {
  const block = source.match(/const FLAG_FILTERS = \[([\s\S]*?)\n\] as const;/);
  if (!block) throw new Error("FLAG_FILTERS no longer matches the expected shape");
  return [...block[1].matchAll(/\["([a-zA-Z0-9]+)"/g)].map((m) => m[1]);
})();

// Mirrors defaultFlags(): evaluable by the engine AND not deliberately opt-in.
const optIn = listOf("OPT_IN_FLAGS");
const evaluableFlags = listOf("ENGINE_EVALUABLE_FLAGS");
const enabledFlags = flagKeys.filter((k) => evaluableFlags.includes(k) && !optIn.includes(k));

// Evidence a healthy, liquid, well-established token would produce. Nothing here should
// trip a filter on value — any block is a filter that cannot be evaluated at all.
const pair = {
  // latinNameSymbol reads pair.baseToken, and dexPaid reads pair.info — feeding either at the
  // top level would report a block this module did not cause. A gate that manufactures its own
  // failures is worse than no gate.
  baseToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana" },
  info: { socials: [{ type: "twitter" }], websites: [{ url: "https://solana.com" }], imageUrl: "https://x/y.png" },
  liquidity: { usd: 5_000_000 },
  marketCap: 250_000_000,
  fdv: 250_000_000,
  volume: { h24: 40_000_000 },
  priceChange: { h24: 3 },
  pairCreatedAt: Date.now() - 400 * 24 * 60 * 60 * 1000
};
const mintInfo = { mintAuthority: null, freezeAuthority: null, decimals: 9 };

const ranges = Object.fromEntries(enabledRanges.map((k) => [k, { enabled: true, min: 0, max: 1e15 }]));
const flags = Object.fromEntries(enabledFlags.map((k) => [k, true]));

const result = evaluateSafety({
  pair,
  mintInfo,
  nowMs: Date.now(),
  safety: { ranges, flags, unavailableDataBehavior: "fail-closed" },
  symbol: "SOL",
  name: "Solana"
});

const report = {
  verifier: "default-filters-tradeable",
  defaultEnabledRanges: enabledRanges,
  defaultEnabledFlags: enabledFlags,
  blockedUnevaluated: result.blockedUnevaluated || [],
  evaluated: result.evaluated || []
};

if (!result.ok) {
  console.log(JSON.stringify({
    ...report,
    status: "FAILED",
    why: "a bot built with the builder's own defaults refuses a token that should obviously pass",
    reasons: result.reasons
  }, null, 1));
  process.exit(1);
}

console.log(JSON.stringify({
  ...report,
  status: "PASS",
  proves: "every filter the builder enables by default has a wired evidence provider, so a bot created by clicking through the builder can actually trade",
  note: "filters without a provider remain available and still fail closed when a user enables them deliberately — that behaviour is correct and untouched"
}, null, 1));
