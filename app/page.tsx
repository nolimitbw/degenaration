import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Link from "next/link";
import { Bot, ChartNoAxesCombined, Search, ShieldCheck, Workflow } from "lucide-react";

export default function Home() {
  return (
    <div className="degen-home" id="top">
      <Nav />
      <main>
        <Hero />
        <section className="home-band border-y border-edge" id="platform">
          <div className="mx-auto grid max-w-7xl divide-y divide-edge px-5 md:grid-cols-4 md:divide-x md:divide-y-0">
            {[
              [Search, "Search", "Screen live Solana markets and inspect token liquidity."],
              [Bot, "Bots", "Follow approved Discord sources with configurable controls."],
              [ChartNoAxesCombined, "Portfolio", "Track wallet positions, trade history, and fees."],
              [Workflow, "Affiliate", "Use the referral link assigned to each approved server."]
            ].map(([Icon, title, copy]) => {
              const FeatureIcon = Icon as typeof Search;
              return <div key={title as string} className="px-5 py-8 first:pl-0 last:pr-0">
                <FeatureIcon aria-hidden="true" size={19} className="text-toxic" />
                <h2 className="mt-4 text-sm font-semibold text-ink">{title as string}</h2>
                <p className="mt-2 text-sm leading-6 text-dim">{copy as string}</p>
              </div>;
            })}
          </div>
        </section>
        <section className="mx-auto grid max-w-7xl gap-12 px-5 py-24 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
          <div>
            <p className="font-mono text-[11px] uppercase text-toxic">Execution with context</p>
            <h2 className="mt-4 max-w-lg text-3xl font-semibold leading-tight text-ink md:text-4xl">One focused workspace from discovery to wallet signature.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-dim">Market data, call-source performance, risk signals, order controls, and portfolio history stay connected. You review the route before signing; Degenaration never takes custody of your wallet.</p>
            <Link href="/terminal" className="mt-8 inline-flex rounded-md bg-toxic px-5 py-3 text-sm font-semibold text-[#17110c] transition hover:bg-[#d1a371]">Start in Terminal</Link>
          </div>
          <div className="border border-edge bg-panel p-6">
            <div className="flex items-center gap-3 border-b border-edge pb-4"><ShieldCheck className="text-up" size={20} /><div><p className="text-sm font-semibold">Wallet-signed execution</p><p className="text-xs text-dim">Preview, verify, then approve in your wallet.</p></div></div>
            <div className="mt-5 grid gap-px bg-edge sm:grid-cols-3">
              {[['Route','Jupiter'],['Custody','Non-custodial'],['Network','Solana']].map(([k,v]) => <div key={k} className="bg-void p-4"><p className="font-mono text-[10px] uppercase text-dim">{k}</p><p className="mt-2 text-sm font-semibold text-ink">{v}</p></div>)}
            </div>
          </div>
        </section>
        <footer className="border-t border-edge px-5 py-7"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs text-dim"><span>Degenaration</span><span>Trading is high risk. Verify every transaction before signing.</span></div></footer>
      </main>
    </div>
  );
}
