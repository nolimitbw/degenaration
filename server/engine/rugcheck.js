/**
 * Rug-check — runs BEFORE every auto-buy. All checks must pass.
 * Uses free public APIs; engine skips the trade + notifies user on any failure.
 */
const MIN_LIQUIDITY_USD = 10_000;
const MAX_TOP10_PCT = 45;

async function rugCheck(mint) {
  const reasons = [];

  // 1) DexScreener: pair exists + liquidity
  const ds = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`).then(r => r.json()).catch(() => null);
  const pair = ds?.pairs?.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  if (!pair) reasons.push("no trading pair found");
  else if ((pair.liquidity?.usd || 0) < MIN_LIQUIDITY_USD) reasons.push(`liquidity $${Math.round(pair.liquidity?.usd || 0)} < $${MIN_LIQUIDITY_USD}`);

  // 2) RugCheck.xyz community report
  const rc = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`).then(r => r.json()).catch(() => null);
  if (rc) {
    if (rc.score_normalised != null && rc.score_normalised > 60) reasons.push(`rugcheck risk score ${rc.score_normalised}/100`);
    for (const risk of rc.risks || []) {
      if (["danger", "warn"].includes(risk.level) && /mint|freeze|honeypot/i.test(risk.name)) {
        reasons.push(`rugcheck: ${risk.name}`);
      }
    }
  }

  // 3) On-chain: mint + freeze authority must be revoked (via RPC).
  // FAIL CLOSED: if we cannot verify authorities (RPC down / rate-limited / unexpected
  // response) we BLOCK the trade rather than assume the token is safe — an unverified
  // active mint authority (infinite supply) or freeze authority (honeypot) is exactly
  // what this gate exists to catch. Prefer the reliable RPC to avoid spurious blocks.
  const rpc = process.env.MAINNET_RPC || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const acct = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] })
  }).then(r => r.json()).catch(() => null);
  const info = acct?.result?.value?.data?.parsed?.info;
  if (!info) {
    reasons.push("could not verify mint/freeze authority on-chain (blocked for safety)");
  } else {
    if (info.mintAuthority) reasons.push("mint authority NOT revoked (can print more tokens)");
    if (info.freezeAuthority) reasons.push("freeze authority NOT revoked (can freeze your tokens)");
  }

  return { ok: reasons.length === 0, reasons, pair: pair ? { dex: pair.dexId, priceUsd: pair.priceUsd, liqUsd: pair.liquidity?.usd } : null };
}

module.exports = { rugCheck };
