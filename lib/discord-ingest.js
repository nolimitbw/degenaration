// The /api/ingest-call transformation, as pure functions.
//
// Same reason as lib/server/input-rules.js: the test runner is plain node with no build
// step, so a .ts route body cannot be executed by a test. Everything the route decided
// about an untrusted Discord event lived inline in that route and was therefore unreachable
// — the snowflake and mint shapes, the event-version rule, the confidence map, the content
// hash that deduplication is keyed on, and which DexScreener pair becomes the immutable
// call-time price. Those are the decisions that determine whether a real call is journaled
// at all, and they were the only stage of the ingestion chain with no coverage.
//
// The route keeps the network calls (mint validation, price fetch, bridge POST) and imports
// these; scripts/verify-discord-replay.mjs drives the same functions from a stored fixture.

const { createHash } = require("node:crypto");
const { isMint } = require("./server/input-rules");

const SNOWFLAKE = /^\d{17,20}$/;
const EVENT_TYPES = new Set(["create", "edit", "delete"]);
const REJECTION_REASONS = new Set(["ambiguous_mint"]);
const PARSER_VERSION = "discord-v3";

const isDiscordSnowflake = (value) => typeof value === "string" && SNOWFLAKE.test(value);

const cleanText = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) || null : null);

const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/**
 * Parser evidence, as basis points, keyed by WHERE the mint was found.
 *
 * This map previously recognised only "slash-command", "message-edit" and "message" — none
 * of which the bot has ever sent. It sends the evidence label from the parser, so every
 * ingested call fell through to the 7500 default and `parsed_signals.confidence_bps` was a
 * constant. The labels below are the ones the parser actually produces, ordered by how
 * directly the source named the token: an explicit command outranks a link, a link outranks
 * a bare address, and anything inherited from a replied-to message ranks below the same
 * evidence found in the message itself.
 */
const CONFIDENCE_BPS = {
  "slash-command": 10_000,
  explicit: 10_000,
  link: 9_500,
  high: 9_500,
  message: 9_000,
  "embed-link": 9_000,
  address: 8_500,
  medium: 8_500,
  "message-edit": 8_000,
  "embed-address": 8_000,
  "reply-link": 7_500,
  "reply-embed-link": 7_250,
  "reply-address": 7_000,
  "reply-embed-address": 6_750
};

const DEFAULT_CONFIDENCE_BPS = 7_500;

function confidenceBps(value) {
  return (typeof value === "string" && CONFIDENCE_BPS[value]) || DEFAULT_CONFIDENCE_BPS;
}

/**
 * The deduplication key's payload half.
 *
 * Deliberately includes eventVersion and eventType: one message legitimately produces a
 * create and then an edit, and both must be journaled. It includes the mint because an edit
 * that changes the token is a different call, not a repeat of the same one.
 */
function contentHashFor({ channelId, messageId, eventVersion, eventType, mint }) {
  return createHash("sha256")
    .update([channelId, messageId, eventVersion, eventType, mint || ""].join(":"))
    .digest("hex");
}

/**
 * Validate and normalize one posted event.
 *
 * Returns `{ error, status }` for a refusal, or the normalized fields. Every refusal here is
 * permanent — the bot's delivery policy classifies 4xx as "reject, do not retry" — so each
 * one has to be a condition that genuinely cannot become true on a retry.
 */
function normalizeIngestRequest(body) {
  const source = body ?? {};
  const eventType = EVENT_TYPES.has(source.eventType) ? source.eventType : "create";
  const eventVersion = cleanText(source.eventVersion, 64) || (eventType === "create" ? "original" : null);
  const historicalBackfill = Boolean(eventVersion?.startsWith("history:"));
  const editedAt = source.editedAt && Number.isFinite(Date.parse(source.editedAt))
    ? new Date(source.editedAt).toISOString()
    : null;
  const rejectionReason = cleanText(source.rejectionReason, 64);

  if (!isDiscordSnowflake(source.channelId) || !isDiscordSnowflake(source.messageId)) {
    return { ok: false, error: "invalid Discord channel or message", status: 400 };
  }
  // Optional, because a listener build predating the guild/channel pair check does not send it.
  // Present-but-malformed is refused rather than nulled out: a caller that sends a broken guild
  // must not be handed the same benefit of the doubt as one that sends none.
  if (source.guildId != null && !isDiscordSnowflake(source.guildId)) {
    return { ok: false, error: "invalid Discord guild", status: 400 };
  }
  if (!eventVersion) return { ok: false, error: "event version required", status: 400 };
  if (rejectionReason && !REJECTION_REASONS.has(rejectionReason)) {
    return { ok: false, error: "invalid rejection reason", status: 400 };
  }
  // A delete and a parser rejection carry no mint by construction.
  if (eventType !== "delete" && !rejectionReason && !isMint(source.mint)) {
    return { ok: false, error: "invalid mint", status: 400 };
  }

  const mint = eventType === "delete" || rejectionReason ? null : source.mint;
  return {
    ok: true,
    guildId: source.guildId ?? null,
    channelId: source.channelId,
    channelName: cleanText(source.channelName, 100),
    messageId: cleanText(source.messageId, 64),
    caller: cleanText(source.caller, 100),
    confidence: cleanText(source.confidence, 32),
    candidateType: source.candidateType === "dexscreener_address" ? "dexscreener_address" : "mint",
    mint,
    eventType,
    eventVersion,
    historicalBackfill,
    editedAt,
    rejectionReason,
    confidenceBps: confidenceBps(source.confidence),
    contentHash: contentHashFor({
      channelId: source.channelId,
      messageId: source.messageId,
      eventVersion,
      eventType,
      mint
    })
  };
}

const KNOWN_PAIR_QUOTES = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
]);

/** Resolve a DexScreener pool only when exactly one non-quote token side is identifiable. */
function resolveDexScreenerPair(payload, pairAddress) {
  const pairs = Array.isArray(payload?.pairs) ? payload.pairs : payload?.pair ? [payload.pair] : [];
  const matching = pairs.filter((pair) => pair?.chainId === "solana"
    && String(pair?.pairAddress || "") === pairAddress);
  const mints = new Set();
  for (const pair of matching) {
    const base = pair?.baseToken?.address;
    const quote = pair?.quoteToken?.address;
    if (isMint(base) && !KNOWN_PAIR_QUOTES.has(base) && KNOWN_PAIR_QUOTES.has(quote)) mints.add(base);
    if (isMint(quote) && !KNOWN_PAIR_QUOTES.has(quote) && KNOWN_PAIR_QUOTES.has(base)) mints.add(quote);
  }
  return mints.size === 1 ? [...mints][0] : null;
}

function withResolvedMint(normalized, mint) {
  return {
    ...normalized,
    mint,
    candidateType: "mint",
    contentHash: contentHashFor({
      channelId: normalized.channelId,
      messageId: normalized.messageId,
      eventVersion: normalized.eventVersion,
      eventType: normalized.eventType,
      mint
    })
  };
}

/**
 * The immutable call-time price, chosen from DexScreener's pair list.
 *
 * Filtered to Solana pairs whose BASE token is this mint — a pair where the mint is the
 * quote side prices the other token, which would record a call at the wrong number — then
 * the deepest by liquidity, because a thin pool's last print is not a price anyone could
 * have traded at. Market cap falls back to FDV, which is what DexScreener reports for a
 * token with no circulating-supply figure.
 */
function selectPricePair(payload, mint) {
  const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
  const pair = pairs
    .filter((item) => item?.chainId === "solana" && item?.baseToken?.address === mint)
    .sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))[0];
  if (!pair) return { symbol: null, calledMcap: null, calledPrice: null, calledLiquidity: null };
  return {
    symbol: cleanText(pair.baseToken?.symbol, 24),
    calledMcap: positive(pair.marketCap) ?? positive(pair.fdv),
    calledPrice: positive(pair.priceUsd),
    calledLiquidity: positive(pair.liquidity?.usd)
  };
}

/** The exact bridge body for `ingest_signal_v2`. */
function buildIngestRpcParams({ normalized, price, secret }) {
  if (normalized.rejectionReason) {
    return {
      operation: "ingest_rejection",
      p_secret: secret,
      p_guild_id: normalized.guildId,
      p_channel_id: normalized.channelId,
      p_channel_name: normalized.channelName,
      p_message_id: normalized.messageId,
      p_caller: normalized.caller,
      p_event_type: normalized.eventType,
      p_event_version: normalized.eventVersion,
      p_rejection_reason: normalized.rejectionReason,
      p_parser_version: PARSER_VERSION,
      p_content_hash: normalized.contentHash
    };
  }
  const safePrice = normalized.historicalBackfill ? null : price;
  return {
    operation: "ingest_signal_v2",
    p_secret: secret,
    p_guild_id: normalized.guildId,
    p_channel_id: normalized.channelId,
    p_channel_name: normalized.channelName,
    p_mint: normalized.mint,
    p_symbol: safePrice?.symbol ?? null,
    p_called_mcap: safePrice?.calledMcap ?? null,
    p_called_price_usd: safePrice?.calledPrice ?? null,
    p_called_liquidity_usd: safePrice?.calledLiquidity ?? null,
    p_message_id: normalized.messageId,
    p_caller: normalized.caller,
    p_confidence: normalized.confidence,
    p_event_type: normalized.eventType,
    p_event_version: normalized.eventVersion,
    p_edited_at: normalized.editedAt,
    p_parser_version: PARSER_VERSION,
    p_confidence_bps: normalized.confidenceBps,
    p_content_hash: normalized.contentHash
  };
}

module.exports = {
  EVENT_TYPES,
  REJECTION_REASONS,
  CONFIDENCE_BPS,
  DEFAULT_CONFIDENCE_BPS,
  PARSER_VERSION,
  isDiscordSnowflake,
  cleanText,
  positive,
  confidenceBps,
  contentHashFor,
  normalizeIngestRequest,
  selectPricePair,
  resolveDexScreenerPair,
  withResolvedMint,
  buildIngestRpcParams
};
