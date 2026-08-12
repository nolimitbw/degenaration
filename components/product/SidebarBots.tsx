"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatSol, type ProductBot } from "@/lib/product-api";

/**
 * The live rail list — the reference dashboard's most distinctive element, where the sidebar
 * carries the user's own holdings rather than only destinations.
 *
 * It renders NOTHING until it has real bots. A signed-out visitor, a failed request and an
 * account with no bots are all "no list", because the alternative is a rail of placeholder
 * rows that look like someone's portfolio. The reference fills this space with invented
 * assets; that is the one thing it does which we cannot copy.
 *
 * Deliberately not a skeleton either: the rail is secondary furniture, and a shimmering block
 * in the corner of every page draws the eye away from the content the user came for.
 */

type Row = Pick<ProductBot, "id" | "kind" | "name" | "status" | "openTrades" | "netPnlLamports">;

const LIVE: ReadonlySet<string> = new Set(["active", "stopping"]);

export default function SidebarBots() {
  const [bots, setBots] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/product/bots", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const list: Row[] = Array.isArray(payload?.bots) ? payload.bots : [];
        // Live bots first — a paused bot is still worth showing, but it is not what someone
        // opens the app to check.
        const ordered = [...list].sort((a, b) => Number(LIVE.has(b.status)) - Number(LIVE.has(a.status)));
        setBots(ordered.slice(0, 5));
      })
      .catch(() => {
        if (!cancelled) setBots(null);
      });
    return () => { cancelled = true; };
  }, []);

  if (!bots || bots.length === 0) return null;

  return (
    <section className="mt-6 px-3" aria-labelledby="rail-bots">
      <h2 id="rail-bots" className="ui-label px-3">
        Your bots
      </h2>
      <ul className="mt-2 grid gap-0.5">
        {bots.map((bot) => {
          const pnl = bot.netPnlLamports == null ? null : Number(bot.netPnlLamports);
          return (
            <li key={bot.id}>
              <Link
                href={`/bots/activity/${bot.id}`}
                className="flex min-h-11 items-center gap-2.5 rounded-md px-3 py-1.5 transition-colors duration-150 hover:bg-[color:var(--rule)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${LIVE.has(bot.status) ? "bg-up" : "bg-[color:var(--text-disabled)]"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate t-meta text-ink">{bot.name}</span>
                  {/* Status is words, never colour alone — the dot repeats it, it does not
                      carry it. */}
                  <span className="block truncate t-label text-dim">
                    {bot.status}
                    {typeof bot.openTrades === "number" && bot.openTrades > 0 && ` · ${bot.openTrades} open`}
                  </span>
                </span>
                {pnl != null && pnl !== 0 && (
                  <span className={`ui-figure shrink-0 t-label ${pnl > 0 ? "text-up" : "text-down"}`}>
                    {formatSol(pnl)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
