import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  ChartNoAxesCombined,
  ShieldCheck,
  WalletCards
} from "lucide-react";

export default function Home() {
  return (
    <div className="degen-home" id="top">
      <Nav />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <section className="home-band border-y border-edge" id="platform">
          <div className="mx-auto grid max-w-7xl divide-y divide-edge px-5 md:grid-cols-3 md:divide-x md:divide-y-0">
            {[
              [Bot, "Bots", "Build from reviewed Discord sources or live KOL volatility rules.", "/bots"],
              [ChartNoAxesCombined, "Affiliate", "Track creator commissions, referrals, and payout requests.", "/affiliate"],
              [WalletCards, "Portfolio", "Review running positions, executions, fees, and PnL evidence.", "/portfolio"]
            ].map(([Icon, title, copy, href]) => {
              const FeatureIcon = Icon as typeof Bot;
              return <Link key={title as string} href={href as string} className="group px-5 py-8 first:pl-0 last:pr-0">
                <FeatureIcon aria-hidden="true" size={19} className="text-toxic" />
                <div className="mt-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-ink">{title as string}</h2>
                  <ArrowUpRight aria-hidden="true" size={15} className="text-dim transition group-hover:text-toxic" />
                </div>
                <p className="mt-2 text-sm leading-6 text-dim">{copy as string}</p>
              </Link>;
            })}
          </div>
        </section>
        <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
          <div>
            <p className="font-mono text-[11px] uppercase text-toxic">Automation with evidence</p>
            <h2 className="mt-4 max-w-lg text-3xl font-semibold leading-tight text-ink md:text-4xl">Every signal passes through the same risk and capital controls.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-dim">Source performance, scanner evidence, immutable bot versions, route estimates, and portfolio history stay connected. Missing market evidence rejects entries instead of guessing.</p>
            <Link href="/bots" className="mt-8 inline-flex rounded-md bg-toxic px-5 py-3 text-sm font-semibold text-[#17110c] transition hover:bg-[#d1a371]">Configure a bot</Link>
          </div>
          <div className="border border-edge bg-panel p-6">
            <div className="flex items-center gap-3 border-b border-edge pb-4"><ShieldCheck className="text-up" size={20} /><div><p className="text-sm font-semibold">Bounded automation</p><p className="text-xs text-dim">Versioned controls, explicit release gates, and audited actions.</p></div></div>
            <div className="mt-5 grid gap-px bg-edge sm:grid-cols-3">
              {[["Automation", "Release locked"], ["Missing data", "Fail closed"], ["Network", "Solana Mainnet"]].map(([key, value]) => <div key={key} className="bg-void p-4"><p className="font-mono text-[10px] uppercase text-dim">{key}</p><p className="mt-2 text-sm font-semibold text-ink">{value}</p></div>)}
            </div>
          </div>
        </section>
        <footer className="border-t border-edge px-5 py-7"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs text-dim"><span>DegenAration</span><span>Trading is high risk. Nothing shown is financial advice.</span></div></footer>
      </main>
    </div>
  );
}
