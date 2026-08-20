import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server/auth";
import { ensureUser } from "@/lib/server/user";
import { db } from "@/lib/db/client";
import { getPriceUsd } from "@/lib/trading/jupiter";
import { gainPercent } from "@/lib/trading/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PositionRow = {
  id: string;
  mint: string;
  symbol: string | null;
  status: string;
  amount_sol: string;
  tokens_bought: string;
  tokens_remaining: string;
  entry_price_usd: string | null;
  realized_sol: string;
  opened_at: string;
};

export async function GET(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const user = await ensureUser({ tgId: auth.user.id, username: auth.user.username, firstName: auth.user.firstName });
  if (!user) return NextResponse.json({ error: "could not load account" }, { status: 503 });

  const rows = await db<PositionRow[]>(
    `positions?user_id=eq.${user.id}&select=id,mint,symbol,status,amount_sol,tokens_bought,tokens_remaining,entry_price_usd,realized_sol,opened_at&order=opened_at.desc&limit=50`
  );
  if (!rows) return NextResponse.json({ error: "positions unavailable" }, { status: 503 });

  // Price each distinct mint once, not once per position.
  const mints = [...new Set(rows.filter((row) => row.status === "open").map((row) => row.mint))];
  const prices = new Map<string, number | null>();
  await Promise.all(mints.map(async (mint) => prices.set(mint, await getPriceUsd(mint))));

  return NextResponse.json({
    positions: rows.map((row) => {
      const entry = row.entry_price_usd === null ? null : Number(row.entry_price_usd);
      const current = prices.get(row.mint) ?? null;
      return {
        id: row.id,
        mint: row.mint,
        symbol: row.symbol,
        status: row.status,
        amountSol: Number(row.amount_sol),
        realizedSol: Number(row.realized_sol),
        entryPriceUsd: entry,
        currentPriceUsd: current,
        // Null rather than 0 when unknown: an unpriced position must not render as flat.
        changePct: entry && current ? gainPercent(entry, current) : null,
        remainingPct: Number(row.tokens_bought) > 0 ? (Number(row.tokens_remaining) / Number(row.tokens_bought)) * 100 : 0,
        openedAt: row.opened_at
      };
    })
  });
}
