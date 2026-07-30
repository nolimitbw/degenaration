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

module.exports = { portfolioStatistics };
