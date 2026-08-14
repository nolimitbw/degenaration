/**
 * Call parser — extracts a Solana token mint from a Discord call event.
 *
 * SECURITY: message content is UNTRUSTED input. We only ever extract base58 addresses;
 * we never eval or act on any other text.
 *
 * Two entry points:
 *   parseCall(text)       — content-only. Used by /alpha, where the operator typed the
 *                           token themselves, and kept as the legacy contract.
 *   parseMessage(message) — the full event: content, embeds, and the replied-to message.
 *
 * Why parseMessage exists: real call channels rarely post a bare address in message
 * content. They relay through a webhook or a bot that posts an EMBED, and the mint lives
 * in the embed description, a field value, or the embed URL. A parser that reads only
 * `msg.content` sees an empty string for those and the call is never journaled — with no
 * error anywhere, because "no mint found" is indistinguishable from ordinary chatter.
 */
const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// DexScreener's /solana/<address> path may contain either a mint or a pool address. Preserve
// that provenance so the server can validate it as a mint first and resolve the pool only
// through DexScreener's pair endpoint. Treating every path segment as a mint made common
// button-only calls fail on-chain validation even though the source identified one token.
/**
 * Where a Solana call links to.
 *
 * This listed four sites — pump.fun, DexScreener, Birdeye and Jupiter — and real call
 * channels do not confine themselves to four. A caller posting an Axiom, GMGN, Photon,
 * BullX, Solscan or DexTools link produced no LINK match at all, so the parser fell back to
 * scanning for a bare base58 address. That fallback usually finds the address inside the URL,
 * but it loses the one thing a link gives you: the knowledge that THIS address is the token
 * and not a wallet someone pasted beside it. Two addresses in a message and the call is
 * refused as ambiguous when it was never ambiguous to a reader.
 *
 * Several of these carry a POOL or PAIR address rather than the mint — Photon's /lp/,
 * DexTools' pair-explorer, Axiom's meme route, DexScreener's /solana/. Those are not mints
 * and on-chain validation correctly refuses them, which is why such calls were being dropped.
 * They are marked as pair candidates so the ingest route resolves them to the token.
 *
 * Ordering matters: alternatives are tried left to right, so the more specific path of a host
 * must precede the looser one (pump.fun/coin/ before pump.fun/).
 */
const LINK_MINT = new RegExp(
  "(" + [
    // — direct mint in the path —
    "pump\\.fun\\/(?:coin\\/)?",
    "birdeye\\.so\\/token\\/",
    "jup\\.ag\\/swap\\/[A-Za-z0-9]+-",
    "jup\\.ag\\/tokens\\/",
    "gmgn\\.ai\\/sol\\/token\\/",
    "solscan\\.io\\/(?:token|account)\\/",
    "raydium\\.io\\/swap\\/\\?[^\\s]*outputMint=",
    "(?:neo\\.)?bullx\\.io\\/[^\\s]*address=",
    "axiom\\.trade\\/t\\/",
    // — pool or pair in the path; resolved to the mint downstream —
    "dexscreener\\.com\\/solana\\/",
    "dextools\\.io\\/app\\/[a-z-]+\\/solana\\/pair-explorer\\/",
    "photon-sol\\.tinyastro\\.io\\/[a-z]+\\/lp\\/",
    "axiom\\.trade\\/meme\\/"
  ].join("|") + ")([1-9A-HJ-NP-Za-km-z]{32,44})",
  "g"
);

/** Hosts whose path carries a pool/pair address rather than the token mint. */
const PAIR_LINK = /dexscreener\.com|dextools\.io|photon-sol|axiom\.trade\/meme/;

const MAX_REGION = 4000;

function linksIn(text) {
  if (!text) return [];
  const found = [];
  // Fresh lastIndex per call: LINK_MINT is /g and a shared regex object keeps state.
  LINK_MINT.lastIndex = 0;
  let match;
  while ((match = LINK_MINT.exec(text)) !== null) {
    found.push({
      address: match[2],
      // `dexscreener_address` means "this may be a pool address, resolve it before trusting
      // it". The previous test was startsWith("dexscreener.com"), which was correct for the
      // one host it knew — the match begins at the host, so the scheme is not in match[1].
      // It cannot express the new ones: DexTools, Photon and Axiom's meme route also carry a
      // pair, and Photon's host is photon-sol.tinyastro.io, which no prefix test covers.
      candidateType: PAIR_LINK.test(match[1]) ? "dexscreener_address" : "mint"
    });
  }
  return found;
}

function addressesIn(text) {
  if (!text) return [];
  BASE58.lastIndex = 0;
  return text.match(BASE58) || [];
}

/**
 * Every place a mint can legitimately appear, in the order a human would read them.
 *
 * Regions are scanned SEPARATELY rather than concatenated. Concatenation would merge an
 * embed footer's contract address with the mint in the description into one blob, and the
 * ambiguity rule below would then reject a call that is perfectly clear to a reader.
 */
function regionsOf(message) {
  const regions = [];
  // Origin is carried explicitly rather than inferred from position. An empty `content`
  // is skipped, which shifted the embed regions up and made the first of them look like
  // message content — so an embed-only call was reported with content-level confidence.
  const push = (origin, value) => {
    if (typeof value === "string" && value.trim()) regions.push({ origin, text: value.slice(0, MAX_REGION) });
  };
  push("content", message?.content);
  for (const embed of Array.isArray(message?.embeds) ? message.embeds.slice(0, 10) : []) {
    push("embed", embed?.title);
    push("embed", embed?.description);
    push("embed", embed?.url);
    push("embed", embed?.author?.name);
    push("embed", embed?.author?.url);
    for (const field of Array.isArray(embed?.fields) ? embed.fields.slice(0, 25) : []) {
      push("embed", field?.name);
      push("embed", field?.value);
    }
    push("embed", embed?.footer?.text);
    // Some call bots put the mint only in the embed's image/thumbnail URL (a chart or a
    // token icon served by mint), and provider/link fields carry it too.
    push("embed", embed?.image?.url);
    push("embed", embed?.thumbnail?.url);
    push("embed", embed?.provider?.url);
  }

  // Action rows. A production call embed's mint is very often ONLY in a button URL —
  // "Buy on Jupiter", "Chart", "Dexscreener" — because the visible text shows a symbol
  // rather than an address. Those are links, so they resolve at link confidence and, being
  // links, also disambiguate a message that shows several bare addresses.
  for (const row of Array.isArray(message?.components) ? message.components.slice(0, 10) : []) {
    for (const component of Array.isArray(row?.components) ? row.components.slice(0, 25) : []) {
      push("component", component?.url);
      push("component", component?.label);
    }
  }

  // Attachment filenames and descriptions. Lowest value of the three, but a chart image
  // named after the mint is a real pattern and costs nothing to read.
  const attachments = message?.attachments;
  const attachmentList = Array.isArray(attachments)
    ? attachments
    : attachments && typeof attachments.values === "function"
      ? [...attachments.values()]
      : [];
  for (const attachment of attachmentList.slice(0, 10)) {
    push("attachment", attachment?.name);
    push("attachment", attachment?.description);
    push("attachment", attachment?.url);
  }

  return regions;
}

/**
 * Resolve one tier (the message itself, or the message it replied to).
 *
 * The ambiguity guarantee from v1 is preserved exactly: if the tier yields more than one
 * DISTINCT candidate address and no link says which one is the token, we refuse rather
 * than guess. A wallet flex next to a mint must never be bought.
 */
function resolveTier(regions, prefix) {
  const linkMints = new Set();
  const linkTypes = new Map();
  const addresses = new Set();
  let linkOrigin = null;
  let addressOrigin = null;

  for (const region of regions) {
    for (const candidate of linksIn(region.text)) {
      if (linkOrigin === null) linkOrigin = region.origin;
      linkMints.add(candidate.address);
      linkTypes.set(candidate.address, candidate.candidateType);
    }
    for (const address of addressesIn(region.text)) {
      if (addressOrigin === null) addressOrigin = region.origin;
      addresses.add(address);
    }
  }

  const label = (origin, kind) => prefix + (origin === "embed" ? `embed-${kind}` : kind);

  // A link is explicit evidence of WHICH address is the token, so it outranks bare
  // addresses even when several of those are present.
  if (linkMints.size === 1) {
    const [mint] = linkMints;
    return { mint, confidence: label(linkOrigin, "link"), candidateType: linkTypes.get(mint) || "mint" };
  }
  if (linkMints.size > 1) {
    return { rejected: "ambiguous-links", candidates: linkMints.size };
  }
  if (addresses.size === 1) {
    const [mint] = addresses;
    return { mint, confidence: label(addressOrigin, "address") };
  }
  if (addresses.size > 1) {
    return { rejected: "ambiguous-addresses", candidates: addresses.size };
  }
  return null;
}

/**
 * Parse a whole Discord message event.
 *
 * Returns one of:
 *   { mint, confidence }              a call to ingest
 *   { rejected, candidates }          something call-shaped that we refuse to guess at
 *   null                              ordinary chatter, nothing to record
 *
 * The rejection case is deliberately distinct from null. "We saw two addresses and would
 * not pick one" is a fact a source owner needs to see; "someone said gm" is not.
 */
function parseMessage(message) {
  const own = resolveTier(regionsOf(message), "");
  if (own) return own;

  // A reply carries its parent as context: "aped this" under a posted mint is a call.
  // The parent is a SEPARATE tier, so its addresses can never make the reply ambiguous.
  const referenced = message?.referencedMessage;
  if (referenced) {
    const parent = resolveTier(regionsOf(referenced), "reply-");
    // Only accept a parent match. A parent that is itself ambiguous is not this
    // message's problem, and reporting it would blame the wrong event.
    if (parent && parent.mint) return parent;
  }
  return null;
}

/** Legacy content-only contract, kept for /alpha and for regression cover on v1 behaviour. */
function parseCall(text) {
  if (!text || text.length > 2000) return null;
  const result = resolveTier([{ origin: "content", text }], "");
  if (!result || !result.mint) return null;
  return { mint: result.mint, confidence: result.confidence === "link" ? "high" : "medium" };
}

module.exports = { parseCall, parseMessage };

