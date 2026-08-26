import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Footer from "@/components/Footer";
import Link from "next/link";
import {
  ArrowUpRight,
  BadgePercent,
  BookOpen,
  Bot,
  ChartNoAxesCombined,
  ListChecks,
  MessagesSquare,
  Radar,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  WalletCards
} from "lucide-react";

const STEPS = [
  { icon: Radar, title: "Choose a signal", copy: "Start with a reviewed Discord source or a live KOL market strategy." },
  { icon: ListChecks, title: "Set the rules", copy: "Define entry size, take profit, stop loss, and the capital you are willing to use." },
  { icon: ShieldCheck, title: "Run with limits", copy: "Activate after readiness checks, then review every execution and outcome." }
];
const PRODUCTS = [
  { icon: Bot, title: "Bots", copy: "Build and manage your automated strategies.", href: "/bots" },
  { icon: ChartNoAxesCombined, title: "Affiliate", copy: "Track referrals, commissions, and payouts.", href: "/affiliate" },
  { icon: WalletCards, title: "Portfolio", copy: "Review positions, executions, fees, and PnL.", href: "/portfolio" }
];
const FEATURES = [
  { icon: MessagesSquare, title: "Discord automation", copy: "Follow approved server calls with your own entry and exit rules.", href: "/bots/discord" },
  { icon: Radar, title: "KOL strategies", copy: "Build strategies around live market activity and configurable filters.", href: "/bots/kol" },
  { icon: SlidersHorizontal, title: "Bot management", copy: "Review status, update controls, and inspect each bot's activity.", href: "/bots/manage" },
  { icon: WalletCards, title: "Portfolio", copy: "See open positions, execution history, fees, and realized results.", href: "/portfolio" },
  { icon: BadgePercent, title: "Affiliate", copy: "Share DegenAration and follow commissions and payout history.", href: "/affiliate" },
  { icon: Wallet, title: "Wallet setup", copy: "Connect your Solana wallet and prepare it for automated execution.", href: "/wallet" },
  { icon: BookOpen, title: "Guides", copy: "Read how bots, risk controls, measurement, and custody work.", href: "/docs" }
];

export default function Home() {
  return <div className="degen-home" id="top"><Nav /><main id="main-content" tabIndex={-1}>
    <Hero />
    <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20 sm:py-28">
      <div className="max-w-2xl"><p className="ui-label text-gold-400">How it works</p><h2 className="home-section-title mt-4 font-bold text-ink">A straight path from signal to strategy.</h2></div>
      <div className="mt-12 divide-y divide-edge border-y border-edge">{STEPS.map(({ icon: Icon, title, copy }, index) => <div key={title} className="grid gap-4 py-7 sm:grid-cols-[48px_48px_1fr] sm:items-center sm:gap-6"><span className="font-mono text-xs text-dim">0{index + 1}</span><Icon aria-hidden="true" size={22} className="text-gold-400" /><div className="grid gap-2 md:grid-cols-[.55fr_1fr] md:items-center md:gap-8"><h3 className="text-lg font-semibold text-ink">{title}</h3><p className="text-sm leading-6 text-dim">{copy}</p></div></div>)}</div>
    </section>
    <section id="platform" className="border-y border-edge bg-panel/35"><div className="mx-auto grid max-w-7xl divide-y divide-edge px-5 md:grid-cols-3 md:divide-x md:divide-y-0">{PRODUCTS.map(({ icon: Icon, title, copy, href }) => <Link key={title} href={href} className="group py-9 md:px-8 md:first:pl-0 md:last:pr-0"><div className="flex items-center justify-between"><Icon aria-hidden="true" size={20} className="text-gold-400" /><ArrowUpRight aria-hidden="true" size={16} className="text-dim transition group-hover:text-ink" /></div><h2 className="mt-7 text-xl font-semibold text-ink">{title}</h2><p className="mt-2 text-sm leading-6 text-dim">{copy}</p></Link>)}</div></section>
    <section className="mx-auto max-w-7xl px-5 py-20 sm:py-24" aria-labelledby="included-heading">
      <div className="grid gap-7 border-b border-edge pb-8 lg:grid-cols-[.7fr_1.3fr] lg:items-end">
        <div><p className="ui-label text-gold-400">Platform</p><h2 id="included-heading" className="home-section-title mt-4 font-bold text-ink">Everything included.</h2></div>
        <p className="max-w-2xl text-sm leading-7 text-dim">Open every part of DegenAration from one directory. Each feature uses your account, wallet, and recorded trading history.</p>
      </div>
      <div className="grid md:grid-cols-2 md:gap-x-10">
        {FEATURES.map(({ icon: Icon, title, copy, href }) => (
          <Link key={title} href={href} className="group grid min-h-32 grid-cols-[32px_1fr_20px] gap-4 border-b border-edge py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">
            <Icon aria-hidden="true" size={21} className="mt-0.5 text-gold-400" />
            <div><h3 className="text-base font-semibold text-ink">{title}</h3><p className="mt-2 text-sm leading-6 text-dim">{copy}</p></div>
            <ArrowUpRight aria-hidden="true" size={16} className="mt-1 text-dim transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" />
          </Link>
        ))}
      </div>
    </section>
    <section className="mx-auto max-w-7xl px-5 py-20 sm:py-24"><p className="ui-label text-gold-400">Automation with evidence</p><div className="mt-4 grid gap-8 lg:grid-cols-[1fr_.8fr] lg:items-end"><h2 className="home-section-title max-w-3xl font-bold text-ink">Every signal keeps its risk controls and trading record.</h2><div><p className="text-sm leading-7 text-dim">Source performance, bot versions, route estimates, and portfolio history stay connected. Missing market evidence stops an entry instead of guessing.</p><Link href="/bots" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">Configure a bot <ArrowUpRight aria-hidden="true" size={16} /></Link></div></div></section>
  </main><Footer /></div>;
}
