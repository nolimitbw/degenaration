import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Link from "next/link";
import { ArrowUpRight, Bot, ChartNoAxesCombined, Crosshair, ListChecks, Radar, WalletCards } from "lucide-react";

const PRODUCTS = [
  { icon: Bot, title: "Bots", copy: "Build from Discord calls or live KOL volatility rules.", href: "/bots", label: "Build automation" },
  { icon: ChartNoAxesCombined, title: "Affiliate", copy: "Track creator commissions, referrals, and payout requests.", href: "/affiliate", label: "View earnings" },
  { icon: WalletCards, title: "Portfolio", copy: "Follow positions, executions, fees, and realized performance.", href: "/portfolio", label: "Open portfolio" }
];

const STEPS = [
  { icon: Radar, number: "01", title: "Find the signal", copy: "Choose a reviewed Discord source or configure a KOL market strategy." },
  { icon: ListChecks, number: "02", title: "Define the trade", copy: "Set entry size, DCA, take profit, stop loss, and capital limits." },
  { icon: Crosshair, number: "03", title: "Run and follow", copy: "Activate when readiness passes, then review every position and execution." }
];

export default function Home() {
  return (
    <div className="degen-home" id="top">
      <Nav />
      <main id="main-content" tabIndex={-1}>
        <Hero />

        <div className="home-ticker border-y border-edge bg-gold-400 py-3 text-[#17110c]" aria-hidden="true">
          <div className="home-ticker-track font-mono text-xs font-bold uppercase tracking-[0.18em]">
            {Array.from({ length: 10 }).map((_, index) => <span key={index}>DegenAration · Signal to strategy · Solana</span>)}
          </div>
        </div>

        <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20 sm:py-28">
          <div className="grid gap-10 lg:grid-cols-[.7fr_1.3fr] lg:gap-16">
            <div>
              <p className="ui-label text-gold-400">How it works</p>
              <h2 className="home-section-title mt-4 max-w-lg font-black uppercase text-ink">From alpha to action.</h2>
              <p className="mt-5 max-w-md text-base leading-7 text-dim">One clear flow from source selection to a strategy you can monitor.</p>
              <Link href="/bots" className="mt-8 inline-flex min-h-11 items-center gap-2 border-b border-gold-400 py-2 text-sm font-bold text-ink">
                Explore bot sources <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
            </div>
            <div className="divide-y divide-edge border-y border-edge">
              {STEPS.map(({ icon: Icon, number, title, copy }) => (
                <div key={number} className="group grid gap-4 py-7 sm:grid-cols-[64px_44px_1fr] sm:items-start sm:gap-6">
                  <span className="font-mono text-sm text-gold-400">{number}</span>
                  <Icon aria-hidden="true" size={24} className="text-dim transition group-hover:text-gold-400" />
                  <div>
                    <h3 className="text-xl font-bold text-ink">{title}</h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-dim">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="home-product-zone border-y border-edge py-20 sm:py-24" id="platform">
          <div className="mx-auto max-w-7xl px-5">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="ui-label text-gold-400">The workspace</p>
                <h2 className="home-section-title mt-4 font-black uppercase text-ink">Three views. One trading loop.</h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-dim">Build strategies, track the people who drive them, and keep the financial record in one account.</p>
            </div>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {PRODUCTS.map(({ icon: Icon, title, copy, href, label }, index) => (
                <Link key={title} href={href} className="home-product-card group flex min-h-[320px] flex-col border border-edge bg-panel p-6 transition hover:-translate-y-1 hover:border-gold-400 sm:p-8">
                  <div className="flex items-start justify-between">
                    <Icon aria-hidden="true" size={26} className="text-gold-400" />
                    <span className="font-mono text-xs text-dim">0{index + 1}</span>
                  </div>
                  <div className="mt-auto pt-16">
                    <h3 className="text-3xl font-black uppercase text-ink">{title}</h3>
                    <p className="mt-3 max-w-sm text-sm leading-6 text-dim">{copy}</p>
                    <span className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-ink">{label}<ArrowUpRight aria-hidden="true" size={15} className="transition group-hover:translate-x-1 group-hover:-translate-y-1" /></span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 text-center sm:py-28">
          <p className="ui-label text-gold-400">Ready when you are</p>
          <h2 className="home-cta-title mx-auto mt-4 max-w-5xl font-black uppercase text-ink">Your next strategy starts with one source.</h2>
          <Link href="/bots" className="mt-9 inline-flex min-h-12 items-center gap-2 bg-gold-400 px-7 py-3 text-sm font-bold text-[#17110c] transition hover:brightness-110">
            Open DegenAration <ArrowUpRight aria-hidden="true" size={17} />
          </Link>
        </section>

        <footer className="border-t border-edge px-5 py-7">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs text-dim"><span>DegenAration</span><span>Trading is high risk. Nothing shown is financial advice.</span></div>
        </footer>
      </main>
    </div>
  );
}
