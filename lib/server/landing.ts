import { callAppBridge } from "@/lib/server/app-bridge";

/**
 * Real data for the landing hero.
 *
 * The reference design puts four labelled nodes around the headline, each with a name and a
 * figure. Hardcoding names and numbers there would be exactly the "fake production data" the
 * project rules forbid — and it is the most damaging place to fake, because the front door is
 * where someone decides whether to trust us with money.
 *
 * So the nodes are the real approved sources with their real call counts. Fewer sources means
 * fewer nodes; no sources means no nodes and the graph renders as lines only, claiming nothing.
 * A source that has never been measured shows its name and no figure rather than a zero.
 */

export type LandingNode = {
  name: string;
  /** Total calls recorded. Null when the source has none — never rendered as 0. */
  calls: number | null;
};

export type LandingStats = {
  nodes: LandingNode[];
  /** Approved sources currently listed. Null when the query failed. */
  sourceCount: number | null;
  /** Calls recorded across every source, all time. Null when unavailable. */
  totalCalls: number | null;
  /** Sources with at least one measured call — the honest "we can show returns" figure. */
  measuredSources: number | null;
};

const EMPTY: LandingStats = { nodes: [], sourceCount: null, totalCalls: null, measuredSources: null };

function count(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function getLandingStats(): Promise<LandingStats> {
  try {
    const result = await callAppBridge<any>("app_public_list_discord_marketplace", {
      p_period: "30d",
      p_sort: "calls",
      p_limit: 12
    });
    if (!result.ok) return EMPTY;

    const sources: any[] = Array.isArray(result.data?.sources) ? result.data.sources : [];
    const named = sources
      .map((source) => ({
        name: String(source?.name || source?.displayName || "").trim(),
        calls: count(source?.totalCalls ?? source?.eligibleCalls),
        measured: count(source?.measuredCalls) || 0
      }))
      .filter((source) => source.name.length > 0);

    return {
      // Four is what the layout has room for; the graph adapts down, never pads up.
      nodes: named.slice(0, 4).map(({ name, calls }) => ({ name, calls: calls || null })),
      sourceCount: named.length,
      totalCalls: named.reduce((sum, source) => sum + (source.calls || 0), 0) || null,
      measuredSources: named.filter((source) => source.measured > 0).length
    };
  } catch {
    // A landing page must render when the database is unreachable. It renders WITHOUT the
    // figures rather than with placeholder ones.
    return EMPTY;
  }
}
