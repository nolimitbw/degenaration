import Link from "next/link";
import { ArrowUpRight, ArrowDown, Play } from "lucide-react";
import Logo from "@/components/Logo";
import type { LandingStats } from "@/lib/server/landing";

/**
 * The landing stage, built to the owner's reference frame.
 *
 * Composition, outermost in: a page with soft light at two corners → the near-black card
 * carrying the nav → an inner rounded panel holding the light, the node graph and the
 * headline. That inner panel is the piece the first version missed, and it is what makes the
 * frame work: without it the bloom bleeds to the card edge and the whole thing flattens into
 * one wash. With it the light is contained and the panel edge catches it.
 *
 * Two departures from the reference, both load-bearing:
 *
 * 1. **Gold, not mint.** The reference blooms mint and its dashboard accents purple. Our
 *    identity is black/gold/white and the rules pin it — and the design guidance independently
 *    names "AI purple/pink gradients" as the pattern to avoid on a fintech surface.
 *
 * 2. **The nodes hold real sources.** The reference labels them with invented names and
 *    figures. The front door is where a stranger decides whether to trust us with money, so a
 *    fabricated track record here is the worst possible place for one. They come from the
 *    marketplace RPC; a source with nothing measured shows its name and no figure, and no
 *    sources means no nodes at all.
 *
 * Server component — every layer is a gradient, an SVG path or a link. No client JS.
 */
export default function HeroStage({ stats }: { stats: LandingStats }) {
  const nodes = stats.nodes;
  // Authored positions, filled in reading order. The graph is a composition, not a layout, but
  // it must degrade cleanly to one node or none.
  const anchors = [
    { className: "left-[4%] top-[20%]", align: "left" as const },
    { className: "right-[4%] top-[15%]", align: "right" as const },
    { className: "left-[6%] bottom-[22%]", align: "left" as const },
    { className: "right-[6%] bottom-[26%]", align: "right" as const }
  ];

  return (
    <section className="px-2.5 pt-2.5 sm:px-4 sm:pt-4">
      <div className="stage relative isolate overflow-hidden rounded-[22px] border border-edge sm:rounded-[30px]">
        {/* ── Nav, on the card above the panel ──────────────────────────────────────── */}
        <header className="relative z-30 flex items-center justify-between gap-4 px-4 py-4 sm:px-7 sm:py-6">
          <Link
            href="/"
            aria-label="DegenAration home"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-400"
          >
            <Logo compact className="sm:hidden" />
            <Logo className="hidden sm:inline-flex" />
          </Link>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-0.5 rounded-full border border-[color:rgb(var(--ink-rgb)/0.08)] bg-[rgb(var(--ink-rgb)/0.05)] px-1.5 py-1.5 backdrop-blur-xl">
              {[
                ["Bots", "/bots"],
                ["Discord sources", "/bots/discord"],
                ["KOL strategies", "/bots/kol"],
                ["Affiliate", "/affiliate"],
                ["Portfolio", "/portfolio"],
                // Docs sits last in the pill: it is the one destination a stranger reaches for
                // before signing in, so it belongs on the front door rather than only in the
                // footer where a first-time reader never looks.
                ["Docs", "/docs"]
              ].map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-9 items-center rounded-full px-3.5 t-meta text-dim transition-colors duration-150 hover:bg-[rgb(var(--ink-rgb)/0.08)] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* The pill above is hidden below lg, so without this a phone visitor could only
                reach the documentation from the very bottom of the page. It is the one link a
                stranger looks for before signing in, so it stays reachable at every width and
                simply steps aside once the pill appears. */}
            <Link
              href="/docs"
              className="inline-flex min-h-11 items-center rounded-full px-3 t-meta text-dim transition-colors duration-150 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400 lg:hidden"
            >
              Docs
            </Link>
            <Link
              href="/portfolio"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-[color:rgb(var(--ink-rgb)/0.12)] px-4 py-2.5 t-meta font-medium text-ink transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
            >
              <span className="hidden sm:inline">Open app</span>
              <span className="sm:hidden">App</span>
              <ArrowUpRight aria-hidden="true" size={15} />
            </Link>
          </div>
        </header>

        {/* ── The panel: light, dust, shafts, graph and headline all live inside it ──── */}
        <div className="stage-panel">
          {/* No grid. A faint technical grid over a dark hero is one of the most recognisable
              AI-generated-page tells there is, the reference has none, and it was fighting the
              light for attention. The dust does the job of keeping the black from reading flat. */}
          <div aria-hidden="true" className="stage-bloom" />
          <div aria-hidden="true" className="stage-stars" />
          <div aria-hidden="true" className="stage-streaks" />

          {nodes.length > 0 && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 hidden sm:block">
              <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                <path d="M0 26 C 20 26, 24 17, 42 17" className="stage-wire" vectorEffect="non-scaling-stroke" />
                <path d="M100 21 C 80 21, 76 13, 58 13" className="stage-wire" vectorEffect="non-scaling-stroke" />
                <path d="M0 74 C 22 74, 26 84, 44 84" className="stage-wire" vectorEffect="non-scaling-stroke" />
                <path d="M100 70 C 78 70, 74 80, 56 80" className="stage-wire" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          )}

          {nodes.map((node, index) => {
            const anchor = anchors[index];
            if (!anchor) return null;
            return (
              <div
                key={`${node.name}-${index}`}
                className={`absolute z-20 hidden max-w-[26%] sm:block ${anchor.className} ${anchor.align === "right" ? "text-right" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-11 w-11 place-items-center rounded-full border border-[color:rgb(var(--ink-rgb)/0.14)] bg-[rgb(var(--ink-rgb)/0.05)] backdrop-blur-md ${anchor.align === "right" ? "ml-auto" : ""}`}
                >
                  <span className="h-2 w-2 rounded-full bg-gold-300" />
                </span>
                <p className="mt-3 flex items-center gap-1.5 truncate t-body text-ink">
                  {anchor.align === "left" && <span aria-hidden="true" className="h-1 w-1 rounded-full bg-gold-400" />}
                  <span className="truncate">{node.name}</span>
                  {anchor.align === "right" && <span aria-hidden="true" className="h-1 w-1 rounded-full bg-gold-400" />}
                </p>
                {/* A source with nothing recorded gets no figure. Never a zero — unmeasured
                    and called-nothing are different facts. */}
                <p className="ui-figure t-label text-dim">
                  {node.calls == null ? "Tracking" : node.calls.toLocaleString()}
                </p>
              </div>
            );
          })}

          <div className="relative z-20 flex h-full flex-col items-center justify-center px-5 py-16 text-center sm:py-20">
            <Link
              href="#how"
              aria-label="See how it works"
              className="grid h-12 w-12 place-items-center rounded-full border border-[color:rgb(var(--ink-rgb)/0.14)] bg-[rgb(var(--ink-rgb)/0.06)] text-ink backdrop-blur-md transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
            >
              <Play aria-hidden="true" size={15} className="ml-0.5" fill="currentColor" />
            </Link>

            <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-[color:rgb(var(--ink-rgb)/0.10)] bg-[rgb(var(--void-rgb)/0.45)] px-3.5 py-2 t-label text-dim backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-up" />
              Non-custodial · Solana mainnet
            </p>

            {/* One line from 1024px up, as in the reference. It was wrapping because the
                container was max-w-6xl (1152px) inside a ~1370px panel — the type size was
                never the problem, the box was. The size is now tied to viewport width so the
                line stays unbroken across desktop widths instead of at one of them. */}
            <h1 className="mt-7 max-w-full text-[2.4rem] font-semibold leading-[1.0] tracking-[-0.035em] text-ink sm:text-[5.2vw] lg:whitespace-nowrap lg:text-[min(5.4vw,5.6rem)]">
              From Discord call to <span className="stage-display-fade">filled trade</span>
            </h1>

            <p className="mt-7 max-w-xl text-balance t-body leading-7 text-dim">
              Pick a server you already trust, set your own risk limits, and let it run against
              your own wallet. You keep the keys the whole way through.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/bots/discord"
                className="inline-flex min-h-12 items-center gap-2 rounded-full border border-[color:rgb(var(--ink-rgb)/0.12)] bg-[rgb(var(--ink-rgb)/0.06)] px-6 py-3 t-body font-medium text-ink backdrop-blur-md transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
              >
                Browse sources
                <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
              {/* The reference's solid white pill. Ours is gold — it is the one primary action
                  on the page, and gold is where this product puts those. */}
              <Link
                href="/bots"
                className="inline-flex min-h-12 items-center rounded-full bg-gold-400 px-6 py-3 t-body font-semibold text-[#17110c] transition-colors duration-150 hover:bg-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200"
              >
                How it works
              </Link>
            </div>
          </div>

          {/* ── Footer rail, inside the panel as in the reference ──────────────────── */}
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-4 sm:p-6">
            <a
              href="#how"
              className="inline-flex min-h-11 items-center gap-3 rounded-full border border-[color:rgb(var(--ink-rgb)/0.10)] bg-[rgb(var(--void-rgb)/0.45)] py-1.5 pl-1.5 pr-4 backdrop-blur-sm transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-void">
                <ArrowDown aria-hidden="true" size={15} />
              </span>
              <span className="t-label text-dim">Scroll down</span>
            </a>

            {/* Real counts, and a meter that MEANS something: one mark per approved source,
                filled for the ones with measured history. The reference's dashes are a
                decorative carousel indicator; a bar that encodes a fact costs the same. */}
            {stats.sourceCount != null && stats.sourceCount > 0 && (
              <div className="hidden text-right sm:block">
                <p className="t-label text-ink">
                  {stats.sourceCount} approved {stats.sourceCount === 1 ? "source" : "sources"}
                </p>
                <div
                  className="mt-2 flex justify-end gap-1.5"
                  role="img"
                  aria-label={`${stats.measuredSources ?? 0} of ${stats.sourceCount} approved sources have measured history`}
                >
                  {Array.from({ length: Math.min(stats.sourceCount, 6) }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-0.5 w-7 rounded-full ${index < (stats.measuredSources ?? 0) ? "bg-gold-400" : "bg-[rgb(var(--ink-rgb)/0.18)]"}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
