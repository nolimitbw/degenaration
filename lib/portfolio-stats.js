// Portfolio statistics derived from the authoritative summary.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §17.1, reference R5 "Main Stats".
//
// Pure and CommonJS so the figures can be unit-tested. The Portfolio page is
// authentication-gated, so the rendered panel cannot be exercised in a browser without a
// real session — extracting the arithmetic here is what makes it verifiable at all.
//
// Every value is derived from persisted data. Anything the summary does not carry is
// returned as null so the UI renders "--" rather than a fabricated zero (§9.6, §23).

const LAMPORTS_PER_SOL = 1000000000;

function toSol(value) {
  if (value == null) return 0;
  try {
    return Number(BigInt(value)) / LAMPORTS_PER_SOL;
  } catch {
    const n = Number(value);
    return Number.isFinite(n) ? n / LAMPORTS_PER_SOL : 0;
  }
}

const CLOSED_STATES = new Set(["closed", "exited"]);

function portfolioStatistics(summary) {
  const s = summary || {};
  const executions = s.executions || [];
  const positions = s.positions || [];
  const legacy = s.legacyTrades || [];
  const performance = s.performance || null;

  const bySide = (side) => executions.filter((e) => e && e.side === side);
  const volumeFor = (side) => bySide(side).reduce((total, e) => total + toSol(e.grossNotionalLamports), 0);

  const closed = positions.filter((p) => p && CLOSED_STATES.has(p.status));
  const wins = closed.filter((p) => Number(p.realizedPnlLamports) > 0).length;
  const losses = closed.filter((p) => Number(p.realizedPnlLamports) < 0).length;

  const networkFees = toSol(performance && performance.networkFeesLamports);
  const allFees = networkFees
    + toSol(performance && performance.platformFeesLamports)
    + toSol(performance && performance.creatorFeesLamports);

  const lastSwapAt = [...executions, ...legacy]
    .map((row) => row && row.created_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  const uniqueTokens = new Set(
    [...executions, ...legacy].map((row) => row && row.mint).filter(Boolean)
  ).size;

  return {
    totalSwaps: executions.length + legacy.length,
    buyCount: bySide("buy").length,
    sellCount: bySide("sell").length,
    buyVolumeSol: volumeFor("buy"),
    sellVolumeSol: volumeFor("sell"),
    // Null rather than 0/0 when nothing has closed — no closed positions and an even
    // win/loss split are different facts.
    wins: closed.length ? wins : null,
    losses: closed.length ? losses : null,
    closedPositions: closed.length,
    networkFeesSol: networkFees,
    allFeesSol: allFees,
    uniqueTokens,
    lastSwapAt,
    // Provided by the server when it has risk evidence; never inferred here.
    riskFlaggedTokens: performance && performance.metrics && performance.metrics.riskFlaggedTokens != null
      ? Number(performance.metrics.riskFlaggedTokens)
      : null
  };
}


/**
 * Unrealized PnL, by pairing the ledger's held cost basis with live market quotes.
 *
 * WHY THIS EXISTS. degenaration-performance-snapshots.sql deliberately refuses to compute
 * unrealized PnL, and says why: it needs a live price for a held token, which is a
 * market-data question rather than a ledger one, and inventing it is the one thing a
 * performance figure must never do. What it publishes instead is the cost basis still held,
 * "for the surface to pair with a live quote".
 *
 * No surface paired it. So a metric both the master spec (section 11) and the launch spec
 * (section 17.1) require was absent from Portfolio entirely — the writer published a value
 * with no reader, which is this project's recurring defect shape.
 *
 * ATTRIBUTION RULE. The product is non-custodial: the tokens a bot position holds ARE the
 * wallet's tokens for that mint. So a position is priced from the wallet holding of the same
 * mint. When two open positions share a mint that attribution is ambiguous — the holding
 * cannot be split between them without token decimals the client does not have — so those
 * positions are counted as unpriced rather than guessed at.
 *
 * FAIL-CLOSED. If any open position cannot be priced, no total is returned. A partial sum
 * would silently understate the user's position while looking like a complete figure, and a
 * wrong number here is worse than an honest "awaiting a quote".
 *
 * The value arithmetic uses Number because a USD quote is float market data, not ledger
 * money. The basis it is compared against stays integer lamports, and the result is only
 * ever displayed.
 *
 * @param {{openPositions?: Array<any>, walletPositions?: Array<any>, solPriceUsd?: number}} input
 * @returns {{ok: true, lamports: bigint, priced: number, unpriced: number}
 *          | {ok: false, reason: string, priced: number, unpriced: number}}
 */
function unrealizedPnl({ openPositions, walletPositions, solPriceUsd } = {}) {
  const open = Array.isArray(openPositions) ? openPositions : [];
  if (open.length === 0) return { ok: true, lamports: 0n, priced: 0, unpriced: 0 };
  if (!(Number(solPriceUsd) > 0)) {
    return { ok: false, reason: "no-sol-quote", priced: 0, unpriced: open.length };
  }

  const perMint = new Map();
  for (const position of open) {
    perMint.set(position.mint, (perMint.get(position.mint) || 0) + 1);
  }
  const quotes = new Map(
    (Array.isArray(walletPositions) ? walletPositions : []).map((h) => [h.mint, h])
  );

  let valueSol = 0;
  let basisLamports = 0n;
  let priced = 0;
  let unpriced = 0;
  for (const position of open) {
    const quote = quotes.get(position.mint);
    const ambiguous = (perMint.get(position.mint) || 0) > 1;
    if (ambiguous || !quote || !(Number(quote.valueUsd) > 0)) {
      unpriced += 1;
      continue;
    }
    valueSol += Number(quote.valueUsd) / Number(solPriceUsd);
    try {
      basisLamports += BigInt(position.costLamports || 0);
    } catch {
      unpriced += 1;
      continue;
    }
    priced += 1;
  }

  if (unpriced > 0) return { ok: false, reason: "awaiting-quote", priced, unpriced };
  return {
    ok: true,
    lamports: BigInt(Math.round(valueSol * 1e9)) - basisLamports,
    priced,
    unpriced: 0
  };
}

module.exports = { portfolioStatistics, unrealizedPnl };
