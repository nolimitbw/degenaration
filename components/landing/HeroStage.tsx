import Link from "next/link";
import { ArrowUpRight, ArrowDown } from "lucide-react";
import Logo from "@/components/Logo";
import type { LandingStats } from "@/lib/server/landing";

/**
 * The landing stage.
 *
 * Built to the owner's reference: one inset rounded viewport, a centred pill nav, a soft
 * diagonal light bloom, a node graph orbiting the headline, and a display line whose closing
 * phrase falls away into the background.
 *
 * Two deliberate departures from the reference, both load-bearing:
 *
 * 1. **Gold, not mint.** The reference blooms mint-green and the dashboard reference accents
 *    purple. Our identity is black/gold/white and the rules pin it. The design guidance also
 *    names "AI purple/pink gradients" as the thing to avoid for a fintech surface — which is
 *    precisely that accent. The bloom carries the same job in our palette.
 *
 * 2. **The nodes hold real sources.** The reference labels them with invented names and
 *    figures. Those are the highest-stakes numbers on the page, because the front door is
 *    where a stranger decides whether to trust us with money. They come from the marketplace
 *    RPC; a source with nothing measured shows its name and no figure, and no sources means no
 *    nodes at all — the graph degrades to lines, which claim nothing.
 *
 * Server component. No client JS: everything here is a link, a gradient or an SVG path.
 */
export default function HeroStage({ stats }: { stats: LandingStats }) {
  const nodes = stats.nodes;
  // Fixed anchors, filled in reading order. The graph is a composition, so positions are
  // authored rather than computed — but it must not look broken with one node or none.
  const anchors = [
    { className: "left-[3%] top-[26%] sm:left-[6%] sm:top-[30%]", align: "left" as const },
    { className: "right-[3%] top-[22%] sm:right-[6%] sm:top-[26%]", align: "right" as const },
    { className: "left-[3%] bottom-[24%] sm:left-[8%] sm:bottom-[26%]", align: "left" as const },
    { className: "right-[3%] bottom-[22%] sm:right-[8%] sm:bottom-[24%]", align: "right" as const }
  ];

  return (
    <section className="px-3 pt-3 sm:px-5 sm:pt-5">
      <div className="stage relative isolate overflow-hidden rounded-[20px] border border-edge sm:rounded-[28px]">
        {/* Atmosphere. Three layers, all painted — no images, so it stays crisp at any width. */}
        <div aria-hidden="true" className="stage-bloom" />
        <div aria-hidden="true" className="stage-grid" />
        <div aria-hidden="true" className="stage-streaks" />

        {/* ── Nav ───────────────────────────────────────────────────────────────────── */}
        <header className="relative z-20 flex items-center justify-between gap-4 px-4 py-4 sm:px-7 sm:py-6">
          {/* min-h-11/min-w-11: the mark itself is 32px, so the link was a 39px target at
              390px. The audit measures min(width, height), and a logo is the one control on
              the page every visitor aims at first. */}
          <Link href="/" aria-label="DegenAration home" className="inline-flex min-h-11 min-w-11 shrink-0 items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-400">
            <Logo compact className="sm:hidden" />
            <Logo className="hidden sm:inline-flex" />
          </Link>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-1 rounded-full border border-edge bg-[rgb(var(--ink-rgb)/0.04)] px-1.5 py-1.5 backdrop-blur-xl">
              {[
                ["Bots", "/bots"],
                ["Discord sources", "/bots/discord"],
                ["KOL strategies", "/bots/kol"],
                ["Affiliate", "/affiliate"],
                ["Portfolio", "/portfolio"]
              ].map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-9 items-center rounded-full px-3.5 t-meta text-dim transition-colors duration-150 hover:bg-[rgb(var(--ink-rgb)/0.06)] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <Link
            href="/portfolio"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-edge px-4 py-2.5 t-meta font-medium text-ink transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
          >
            <span className="hidden sm:inline">Open app</span>
            <span className="sm:hidden">App</span>
            <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </header>

        {/* ── Node graph ────────────────────────────────────────────────────────────── */}
        {nodes.length > 0 && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 hidden sm:block">
            <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
              <path d="M4 32 C 22 32, 26 22, 44 22" className="stage-wire" vectorEffect="non-scaling-stroke" />
              <path d="M96 27 C 78 27, 74 18, 56 18" className="stage-wire" vectorEffect="non-scaling-stroke" />
              <path d="M6 74 C 24 74, 28 84, 46 84" className="stage-wire" vectorEffect="non-scaling-stroke" />
              <path d="M94 78 C 76 78, 72 88, 54 88" className="stage-wire" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        )}

        {nodes.map((node, index) => {
          const anchor = anchors[index];
          if (!anchor) return null;
          return (
            <div
              key={`${node.name}-${index}`}
              className={`absolute z-10 hidden max-w-[30%] sm:block ${anchor.className} ${anchor.align === "right" ? "text-right" : ""}`}
            >
              <div className={`flex items-center gap-2.5 ${anchor.align === "right" ? "flex-row-reverse" : ""}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-edge bg-[rgb(var(--void-rgb)/0.6)] backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-gold-400" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate t-meta text-ink">{node.name}</span>
                  {/* A source with nothing recorded gets no figure. Never a zero — an unmeasured
                      source and a source that called nothing are different facts. */}
                  <span className="block t-label text-dim">
                    {node.calls == null ? "Tracking" : `${node.calls.toLocaleString()} calls`}
                  </span>
                </span>
              </div>
            </div>
          );
        })}

        {/* ── Headline ──────────────────────────────────────────────────────────────── */}
        <div className="relative z-10 flex flex-col items-center px-5 pb-28 pt-16 text-center sm:pb-32 sm:pt-24 lg:pb-40 lg:pt-28">
          <p className="inline-flex items-center gap-2 rounded-full border border-edge bg-[rgb(var(--void-rgb)/0.5)] px-3.5 py-2 t-label text-dim backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-up" />
            Non-custodial · Solana mainnet
          </p>

          <h1 className="stage-display mt-7 max-w-5xl text-[2.1rem] font-semibold leading-[1.02] tracking-[-0.03em] text-ink sm:text-6xl lg:text-[4.6rem]">
            From Discord call to <span className="stage-display-fade">filled trade</span>
          </h1>

          <p className="mt-6 max-w-xl text-balance t-body leading-7 text-dim">
            Pick a server you already trust, set your own risk limits, and let it run against your
            own wallet. You keep the keys the whole way through.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/bots/discord"
              className="inline-flex min-h-12 items-center gap-2 rounded-full bg-gold-400 px-6 py-3 t-body font-semibold text-[#17110c] transition-colors duration-150 hover:bg-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200"
            >
              Browse Discord sources
              <ArrowUpRight aria-hidden="true" size={17} />
            </Link>
            <Link
              href="/bots"
              className="inline-flex min-h-12 items-center rounded-full border border-edge bg-[rgb(var(--ink-rgb)/0.04)] px-6 py-3 t-body font-medium text-ink backdrop-blur-sm transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
            >
              How it works
            </Link>
          </div>
        </div>

        {/* ── Footer rail ───────────────────────────────────────────────────────────── */}
        <div className="relative z-10 flex items-end justify-between gap-4 px-4 pb-5 sm:px-7 sm:pb-7">
          <a
            href="#how"
            className="inline-flex min-h-11 items-center gap-3 rounded-full border border-edge bg-[rgb(var(--void-rgb)/0.5)] py-1.5 pl-1.5 pr-4 backdrop-blur-sm transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-void">
              <ArrowDown aria-hidden="true" size={15} />
            </span>
            <span className="t-label text-dim">Scroll down</span>
          </a>

          {/* Real counts or nothing. The reference shows a decorative progress meter here; a
              number that means something is worth more than a meter that means nothing. */}
          {stats.sourceCount != null && stats.sourceCount > 0 && (
            <p className="text-right t-label text-dim">
              <span className="block text-ink">{stats.sourceCount} approved {stats.sourceCount === 1 ? "source" : "sources"}</span>
              {stats.totalCalls != null && <span className="block">{stats.totalCalls.toLocaleString()} calls recorded</span>}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
