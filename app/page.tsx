import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import HeroStage from "@/components/landing/HeroStage";
import HowItWorks from "@/components/landing/HowItWorks";
import LiveMarketTerminal from "@/components/LiveMarketTerminal";
import Logo from "@/components/Logo";
import { getLandingStats } from "@/lib/server/landing";

export const dynamic = "force-dynamic";

/**
 * The public landing page, rebuilt to the owner's reference frames.
 *
 * The stage carries its own navigation, so the shared <Nav /> is deliberately not rendered
 * here — two navs stacked was the first thing that broke when this was assembled.
 *
 * The "Built on" row replaces the reference's customer-logo cloud. We have no customers to
 * name, and a row of borrowed logos implying otherwise is the exact kind of fabricated social
 * proof the rules forbid. These are integrations we genuinely run against, set as wordmarks
 * rather than guessed SVG paths, which also keeps us clear of anyone's brand guidelines.
 */

const BUILT_ON = ["Solana", "Jupiter", "Privy", "Discord", "Supabase", "DexScreener"];

export default async function Home() {
  const stats = await getLandingStats();

  return (
    <div className="degen-home min-h-dvh" id="top">
      <main id="main-content" tabIndex={-1}>
        <HeroStage stats={stats} />

        <section aria-labelledby="built-on" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 id="built-on" className="ui-label text-center">
            Built on
          </h2>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 sm:gap-x-14">
            {BUILT_ON.map((name) => (
              <li key={name} className="t-body font-medium tracking-tight text-[color:var(--text-muted)]">
                {name}
              </li>
            ))}
          </ul>
        </section>

        <HowItWorks stats={stats} />

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
            <div>
              <h2 className="text-[1.9rem] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-4xl">
                Live market
              </h2>
              <p className="mt-2 t-meta text-dim">Solana mainnet, read directly. Nothing here is simulated.</p>
            </div>
          </div>
          <LiveMarketTerminal />
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="relative isolate overflow-hidden rounded-2xl border border-edge px-6 py-14 text-center sm:px-10 sm:py-20">
            <div aria-hidden="true" className="stage-bloom" />
            <div className="relative z-10">
              <h2 className="mx-auto max-w-2xl text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.02em] text-ink sm:text-5xl">
                Start with one server
              </h2>
              <p className="mx-auto mt-4 max-w-lg t-body leading-7 text-dim">
                Set your limits, keep your keys, and watch what a source actually does before you
                raise your size.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/bots/discord"
                  className="inline-flex min-h-12 items-center gap-2 rounded-full bg-gold-400 px-6 py-3 t-body font-semibold text-[#17110c] transition-colors duration-150 hover:bg-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200"
                >
                  Browse Discord sources <ArrowUpRight aria-hidden="true" size={17} />
                </Link>
                <Link
                  href="/portfolio"
                  className="inline-flex min-h-12 items-center rounded-full border border-edge px-6 py-3 t-body font-medium text-ink transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
                >
                  Open the app
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-edge">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
              {[
                ["Bots", "/bots"],
                ["Affiliate", "/affiliate"],
                ["Portfolio", "/portfolio"],
                ["Risk", "/risk"]
              ].map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-11 items-center t-meta text-dim transition-colors duration-150 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
