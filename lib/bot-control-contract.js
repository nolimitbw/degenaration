// Which bot controls actually change what the engine does — declared once, checked by a gate.
//
// WHY THIS FILE EXISTS
//
// `BotBuilder.buildConfig()` persists 34 control paths. A survey of every reader — the nine
// files under server/engine, server/worker.js, and every supabase/*.sql — found that thirteen
// of them appear nowhere at all, not even in a comment, and several more appear only in
// validation. A control that saves, reloads, versions, and changes nothing is the defect this
// project has already shipped twice: take-profit levels beyond the second, and trailing stops,
// were both collected, validated, persisted and read by nothing, and both were found only by
// someone going looking.
//
// The failure is silent by construction. The control persists, so a round trip through the
// editor shows the user's value back to them; nothing errors, because nothing reads it.
// Neither a type checker nor a test of the save path can see it — the save path is correct.
// Only the relationship between the writer and the readers is wrong, which is this codebase's
// documented signature.
//
// So the relationship is declared here and checked mechanically by
// `npm run check:bot-control-contract`, which asserts four things:
//
//   1. every path buildConfig() persists appears below — a new control cannot be added
//      silently, because an undeclared one fails the build;
//   2. every ENFORCED entry's evidence token really is present in the reader file it names,
//      so the claim is verified rather than asserted;
//   3. every PENDING entry's token is absent from every reader — when a control is finally
//      implemented, the gate forces it to be promoted rather than left labelled pending;
//   4. no entry names a control buildConfig() no longer persists.
//
// The UI reads the same list. A pending control renders with a truthful note in its section
// rather than looking live, which is what FINAL_LAUNCH_SPEC section 9 requires: every visible
// control must affect real behaviour or be clearly marked with a truthful reason.
//
// PROMOTING A CONTROL. Implement the reader, then change `status` to "enforced" and add
// `readBy`. The gate will fail until the token is genuinely present, and fail again if you
// leave it pending after implementing it.

/** Everything a control could plausibly be read by; used to verify an "enforced" claim. */
const READER_GLOBS = ["server/engine", "server/worker.js", "supabase"];

/**
 * Where a config value actually becomes a trading decision.
 *
 * Narrower than READER_GLOBS on purpose. Three controls appear only in
 * degenaration-subscriber-config-versioning.sql, which BUILDS a legacy baseline config and
 * VALIDATES a submitted one — storing a number and range-checking it is not acting on it. A
 * gate that counted SQL as enforcement reported those three as implemented, which is the same
 * mistake, one level up.
 *
 * So the rule is "SQL is not enforcement" with exactly one NAMED exception, listed file by file
 * rather than by directory. degenaration-bot-entry-limits.sql is not a schema or a validator: it
 * is the entry decision itself, replacing worker_claim_call_execution so that a limit refuses
 * the claim and writes the reason. It has to be in SQL — every one of those limits is a question
 * about a SET of executions, and a check performed in the worker before the claim has a window
 * in which ten calls each read "0 open trades" and each claim. Putting the rule in both places
 * would be two implementations that drift, which is the other failure this file exists to stop.
 *
 * Adding a file here is a deliberate act. A directory glob over supabase/ would restore exactly
 * the mistake described above, so do not widen this into one.
 */
const EXECUTION_GLOBS = [
  "server/engine",
  "server/worker.js",
  "supabase/degenaration-bot-entry-limits.sql",
  // The same reasoning, and the same file it supersedes: this one is the entry decision too,
  // adding the channel scope to it. Named individually, never a directory glob.
  "supabase/degenaration-subscription-channel-scope.sql",
  // Supersedes the two above; the entry decision, again, with the post-stop freeze added.
  "supabase/degenaration-freeze-after-stop.sql",
  // Supersedes all three; the entry decision with auto re-entry added.
  "supabase/degenaration-auto-reentry.sql",
  // Supersedes all of the above; the entry decision with the daily trade COUNT added, and the
  // trading day moved to 06:00 America/New_York for both daily limits. Named individually for
  // the reason in the comment above: it is the claim itself, not a schema or a validator.
  "supabase/degenaration-daily-trade-count.sql"
];

/**
 * The shapes an actual READ of a config path takes, in JS and in SQL.
 *
 * A bare leaf key is not one: `enabled`, `trailing` and `dynamic` occur throughout the engine
 * for unrelated reasons, and searching for them reported six pending controls as implemented.
 * An entry may override with its own `probes` when the default set is wrong for it.
 */
function probesFor(entry) {
  if (Array.isArray(entry.probes) && entry.probes.length) return entry.probes;
  const parts = entry.path.split(".");
  if (parts.length === 1) return [parts[0]];
  const [parent, leaf] = parts;
  return [
    `${parent}.${leaf}`,
    `${parent}?.${leaf}`,
    `${parent}"]["${leaf}`,
    `'${parent}'->>'${leaf}'`,
    `'${parent}'->'${leaf}'`,
    `{${parent},${leaf}}`
  ];
}

/**
 * One entry per path `buildConfig()` emits, at the granularity it emits them: top level, and
 * one level into the nested objects.
 *
 * `path`     dotted key path in the persisted config
 * `label`    what the user sees on the control
 * `section`  builder section, so the UI can group pending notes where the control lives
 * `kinds`    which bot kinds persist it
 * `status`   "enforced" | "pending"
 * `readBy`   enforced only: { file, token } the gate must find
 * `reason`   pending only: one sentence, shown to the user
 * `blocker`  pending only: the external blocker id, or null when it is purely internal work
 */
const BOT_CONTROL_CONTRACT = [
  // ── identity, wallet, source ────────────────────────────────────────────────────────────
  { path: "walletAddress", label: "Execution wallet", section: "wallet", kinds: ["discord", "kol"],
    status: "enforced", readBy: [
      { file: "supabase/degenaration-product-rpcs.sql", token: "v_wallet_address" },
      { file: "server/engine/store.js", token: "user_pubkey" }
    ] },
  { path: "walletId", label: "Execution wallet", section: "wallet", kinds: ["discord", "kol"],
    status: "enforced", readBy: [
      { file: "supabase/degenaration-product-rpcs.sql", token: "v_privy_wallet_id" },
      { file: "server/engine/signer.js", token: "walletId" }
    ] },
  { path: "channelId", label: "Specific channel", section: "source", kinds: ["discord"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-subscription-channel-scope.sql", token: "v_call_channel" }] },

  // ── the three masters ───────────────────────────────────────────────────────────────────
  // Not exit rules: these govern whether the bot may act at all, so each is enforced at the
  // point it decides something rather than in the section it is displayed in.
  { path: "autoEntry", label: "Automatic entries", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "autoEntry" }] },
  { path: "autoExit", label: "Automatic exits", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/monitor.js", token: "plan.autoExit" }] },
  { path: "killSwitch", label: "Emergency stop", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "killSwitch" }] },

  // ── the limit switches ──────────────────────────────────────────────────────────────────
  // Every numeric limit keeps its value at all times — subscriber_config_valid requires several
  // of them to be present and numeric, so "off" cannot be expressed by clearing the field.
  // These flags are what the claim reads before applying each cap. Absent reads as ON.
  { path: "limits.maxOpenTrades", label: "Maximum open trades limit", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "v_limits->>'maxOpenTrades'" }] },
  { path: "limits.maximumCapital", label: "Maximum capital limit", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "v_limits->>'maximumCapital'" }] },
  { path: "limits.dailyLoss", label: "Daily loss limit switch", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "v_limits->>'dailyLoss'" }] },
  { path: "limits.perTokenExposure", label: "Per-token exposure limit", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "v_limits->>'perTokenExposure'" }] },
  { path: "limits.cooldown", label: "Token cooldown switch", section: "execution", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "v_limits->>'cooldown'" }] },
  // Off does not stop the counting, only the refusal — so turning it back on cannot hand the
  // bot a fresh day's allowance it has already spent. Proven by
  // verify:bot-entry-limits -> dailyTradeCountAccruesWhileOff.
  { path: "limits.maxTradesPerDay", label: "Daily trade limit switch", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-daily-trade-count.sql", token: "v_limits->>'maxTradesPerDay'" }] },
  { path: "limits.priorityFee", label: "Priority fee cap switch", section: "execution", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/store.js", token: "limits.priorityFee" }] },

  // ── funding and exposure ────────────────────────────────────────────────────────────────
  { path: "buyAmountLamports", label: "Buy amount", section: "funding", kinds: ["discord", "kol"],
    status: "enforced", readBy: [
      { file: "supabase/degenaration-product-rpcs.sql", token: "buyAmountLamports" },
      { file: "server/engine/store.js", token: "size_sol" }
    ] },
  { path: "dailyLossLimitLamports", label: "Daily loss limit", section: "funding", kinds: ["discord", "kol"],
    status: "enforced", readBy: [
      { file: "supabase/degenaration-product-rpcs.sql", token: "dailyLossLimitLamports" },
      { file: "server/engine/store.js", token: "daily_cap_sol" }
    ] },
  { path: "maximumCapitalLamports", label: "Maximum capital", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "maximumCapitalLamports" }] },
  { path: "perTokenExposureLamports", label: "Per-token exposure limit", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "perTokenExposureLamports" }] },
  { path: "maxOpenTrades", label: "Maximum open trades", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "maxOpenTrades" }] },
  // Entries per trading day. Distinct from dailyLossLimitLamports, which caps SOL SPENT: a bot
  // with a 1 SOL daily budget and a 0.02 margin can take fifty entries and stay inside it.
  { path: "maxTradesPerDay", label: "Maximum trades per day", section: "funding", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-daily-trade-count.sql", token: "maxTradesPerDay" }] },

  // ── entry and execution ─────────────────────────────────────────────────────────────────
  { path: "entryMode", label: "Entry mode", section: "entry", kinds: ["discord", "kol"],
    status: "pending", blocker: null,
    reason: "Every entry is a market order today. Limit entry has no reader." },
  { path: "slippageBps", label: "Slippage cap", section: "entry", kinds: ["discord", "kol"],
    status: "enforced", readBy: [
      { file: "supabase/degenaration-product-rpcs.sql", token: "slippageBps" },
      { file: "server/engine/store.js", token: "slippage_bps" },
      { file: "server/engine/jupiter.js", token: "slippage" }
    ] },
  { path: "priorityFeeStrategy", label: "Priority fee strategy", section: "execution", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/jupiter.js", token: "priorityFeeStrategy" }] },
  { path: "priorityFeeMaxLamports", label: "Priority fee cap", section: "execution", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/jupiter.js", token: "priorityFeeMaxLamports" }] },
  { path: "autoRetryCount", label: "Auto retry", section: "execution", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/calls.js", token: "execution?.autoRetryCount" }] },
  { path: "limitRetryCount", label: "Limit-order retries", section: "execution", kinds: ["discord", "kol"],
    status: "pending", blocker: null,
    reason: "Depends on limit entry, which is not implemented." },
  { path: "quoteExpirationSeconds", label: "Quote expiration", section: "execution", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/jupiter.js", token: "quoteExpirationSeconds" }] },
  { path: "cooldownSeconds", label: "Duplicate cooldown", section: "execution", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "cooldownSeconds" }] },
  { path: "simulationRequired", label: "Require simulation", section: "execution", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [
      { file: "server/engine/store.js", token: "config.simulationRequired" },
      { file: "server/engine/calls.js", token: "execution?.simulationRequired" },
      { file: "server/engine/monitor.js", token: "execution?.simulationRequired" }
    ] },
  { path: "firstCallOnly", label: "First call only", section: "execution", kinds: ["discord"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-bot-entry-limits.sql", token: "firstCallOnly" }] },

  // ── take profit ─────────────────────────────────────────────────────────────────────────
  { path: "takeProfit.levels", label: "Take-profit levels", section: "takeProfit", kinds: ["discord", "kol"],
    status: "enforced", readBy: [{ file: "server/engine/monitor.js", token: "takeProfit" }] },
  // The master switch. Off persists `levels: []`, and exitPlan branches on the PRESENCE of the
  // takeProfit object rather than on level count — which it did not before, so an off switch
  // fell through to the legacy tp1/tp2 columns and sold at the 2x default anyway. The probe is
  // that branch, so the toggle cannot silently become decorative again.
  { path: "takeProfit.enabled", label: "Take profit", section: "takeProfit", kinds: ["discord", "kol"],
    status: "enforced",
    probes: ["config.takeProfit && typeof config.takeProfit"],
    readBy: [{ file: "server/engine/monitor.js", token: "config.takeProfit && typeof config.takeProfit" }] },
  { path: "takeProfit.trailing", label: "Trailing take profit", section: "takeProfit", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/monitor.js", token: "trailingEnabled" }] },

  // ── stop loss ───────────────────────────────────────────────────────────────────────────
  { path: "stopLoss.stopBps", label: "Stop loss", section: "stopLoss", kinds: ["discord", "kol"],
    status: "enforced", readBy: [{ file: "server/engine/monitor.js", token: "stopBps" }] },
  // Off persists stopBps 0, and decideExit gates the whole stop branch on `dropFraction > 0`.
  { path: "stopLoss.enabled", label: "Stop loss", section: "stopLoss", kinds: ["discord", "kol"],
    status: "enforced",
    probes: ["plan.stop.dropFraction > 0"],
    readBy: [{ file: "server/engine/monitor.js", token: "plan.stop.dropFraction > 0" }] },
  { path: "stopLoss.trailing", label: "Trailing stop", section: "stopLoss", kinds: ["discord", "kol"],
    status: "enforced", readBy: [{ file: "server/engine/monitor.js", token: "stopLoss?.trailing" }] },
  { path: "stopLoss.dynamic", label: "Dynamic stop", section: "stopLoss", kinds: ["discord", "kol"],
    status: "pending", blocker: null,
    reason: "No reader. The stop is fixed or trailing; there is no volatility-adjusted mode yet." },
  { path: "stopLoss.delaySeconds", label: "Stop delay", section: "stopLoss", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/monitor.js", token: "stopLoss?.delaySeconds" }] },
  { path: "stopLoss.freezeAfterStop", label: "Freeze token after stop", section: "stopLoss", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-freeze-after-stop.sql", token: "freezeAfterStop" }] },
  // Section 4 of the release directive puts this directly below Stop loss, and it is a
  // genuinely different rule from firstCallOnly: that one refuses a repeat CALL for a token
  // already acted on, this one refuses a fresh entry after a POSITION in that token has closed.
  { path: "autoReentry", label: "Auto re-entry", section: "stopLoss", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "supabase/degenaration-auto-reentry.sql", token: "autoReentry" }] },
  { path: "stopLoss.emergencyExit", label: "Emergency exit", section: "stopLoss", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/monitor.js", token: "emergencyExit" }] },

  // ── KOL universe, trigger, DCA, scanner ─────────────────────────────────────────────────
  // Section is "entry" for the universe and scanner controls because that is where the
  // builder renders them — inside "Entry trigger" — and the note has to appear beside the
  // control it describes, not in a section the user never opens.
  { path: "manualMints", label: "Manual token list", section: "entry", kinds: ["kol"],
    status: "pending", blocker: "E-3",
    reason: "The KOL entry path is not wired to a running worker, so a manual token list is stored and not scanned." },
  { path: "trigger.priceDropBps", label: "Price-drop trigger", section: "entry", kinds: ["kol"],
    status: "pending", blocker: "E-3",
    reason: "The KOL entry trigger has no reader. A KOL bot does not open positions on its own yet." },
  { path: "trigger.referenceMode", label: "Reference price", section: "entry", kinds: ["kol"],
    status: "pending", blocker: "E-3", reason: "Part of the KOL entry trigger, which has no reader." },
  { path: "trigger.lookbackMinutes", label: "Lookback window", section: "entry", kinds: ["kol"],
    status: "pending", blocker: "E-3", reason: "Part of the KOL entry trigger, which has no reader." },
  { path: "trigger.stalePriceBehavior", label: "Stale price handling", section: "entry", kinds: ["kol"],
    status: "pending", blocker: "E-3", reason: "Part of the KOL entry trigger, which has no reader." },
  { path: "dca.enabled", label: "Dollar-cost averaging", section: "dca", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [
      { file: "server/engine/dca.js", token: "dca.enabled" },
      { file: "server/engine/monitor.js", token: "decideDca" }
    ] },
  { path: "dca.levels", label: "DCA levels", section: "dca", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [
      { file: "server/engine/dca.js", token: "dca.levels" },
      { file: "server/engine/monitor.js", token: "placeDca" }
    ] },
  { path: "dca.expirationMinutes", label: "DCA expiration", section: "dca", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/dca.js", token: "expirationMinutes" }] },
  { path: "dca.maximumEntries", label: "Maximum DCA entries", section: "dca", kinds: ["discord", "kol"],
    status: "enforced",
    readBy: [{ file: "server/engine/dca.js", token: "maximumEntries" }] },
  { path: "scanner.preset", label: "Scanner preset", section: "entry", kinds: ["kol"],
    status: "pending", blocker: "E-3",
    reason: "The preset shapes the filters saved with the bot. Scheduled scanning needs a running worker." },
  { path: "scanner.autoRefreshMinutes", label: "Auto-refresh", section: "entry", kinds: ["kol"],
    status: "pending", blocker: "E-3", reason: "No scheduled scan runs, so the refresh period has no effect." },
  { path: "scanner.previewCount", label: "Tokens to preview", section: "entry", kinds: ["kol"],
    status: "pending", blocker: null, reason: "Applies to the on-demand preview only, not to execution." },
  { path: "scanner.degenMode", label: "Degen mode", section: "entry", kinds: ["kol"],
    status: "pending", blocker: null, reason: "Widens the preview. It does not relax the safety filters the engine enforces." },

  // ── safety ──────────────────────────────────────────────────────────────────────────────
  { path: "safetyFilters.dexes", label: "Allowed DEXes", section: "safety", kinds: ["discord", "kol"],
    status: "pending", blocker: null,
    reason: "The route is chosen by the aggregator across every supported venue; the list is not yet a constraint on it." },
  { path: "safetyFilters.ranges", label: "Token filters", section: "safety", kinds: ["discord", "kol"],
    status: "enforced", readBy: [{ file: "server/engine/safety.js", token: "ranges" }] },
  { path: "safetyFilters.flags", label: "Security flags", section: "safety", kinds: ["discord", "kol"],
    status: "enforced", readBy: [{ file: "server/engine/safety.js", token: "flags" }] },
  { path: "safetyFilters.unavailableDataBehavior", label: "Missing data behaviour", section: "safety", kinds: ["discord", "kol"],
    status: "enforced", readBy: [{ file: "server/engine/safety.js", token: "unavailableDataBehavior" }] },

  // ── metadata ────────────────────────────────────────────────────────────────────────────
  // Declared enforced first, on the strength of the save RPC storing it on kol_strategies.
  // The gate refused: no execution file reads it, so storing it is all that happens. It is a
  // disclosure on the marketplace listing, not a constraint — choosing "Very high" neither
  // loosens nor tightens anything the engine does, and the user is told so.
  { path: "riskTier", label: "Risk tier", section: "identity", kinds: ["kol"],
    status: "pending", blocker: null,
    reason: "Shown on your marketplace listing so subscribers can judge the strategy. It is a label, not a limit: it does not change any filter or cap the engine applies." }
];

/** Controls this bot kind saves that no execution path reads yet, grouped by builder section. */
function pendingControls(kind) {
  const grouped = new Map();
  for (const entry of BOT_CONTROL_CONTRACT) {
    if (entry.status !== "pending") continue;
    if (kind && !entry.kinds.includes(kind)) continue;
    const list = grouped.get(entry.section) || [];
    list.push(entry);
    grouped.set(entry.section, list);
  }
  return grouped;
}

/** One truthful sentence for a section, or null when everything in it is enforced. */
function pendingNotice(kind, section) {
  const entries = pendingControls(kind).get(section);
  if (!entries || entries.length === 0) return null;
  return {
    labels: entries.map((entry) => entry.label),
    reasons: entries.map((entry) => `${entry.label}: ${entry.reason}`)
  };
}

module.exports = { BOT_CONTROL_CONTRACT, READER_GLOBS, EXECUTION_GLOBS, probesFor, pendingControls, pendingNotice };
