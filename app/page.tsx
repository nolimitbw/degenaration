import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Footer from "@/components/Footer";
import Link from "next/link";
import { ArrowUpRight, Radio, SlidersHorizontal, ChartNoAxesCombined, Wallet, BookOpen, ShieldCheck } from "lucide-react";

const STEPS = [
  { title: "Find your signal", copy: "Explore Discord sources and KOL strategies. Review the available history before you decide what to follow." },
  { title: "Define your trade", copy: "Choose entry size, filters, profit targets, and stop loss. Set how much capital your bot can use." },
  { title: "Follow the outcome", copy: "Authorize automation from your wallet, then review positions and execution history in your portfolio." }
];

export default function Home() {
  return <div className="degen-home market-home" id="top">
    <main id="main-content" tabIndex={-1}>
    <div className="market-stage"><Nav /><Hero /></div>
    <section className="market-proof" aria-label="Platform capabilities"><span><Radio size={17} aria-hidden="true" /> Source discovery</span><span><SlidersHorizontal size={17} aria-hidden="true" /> Configurable risk</span><span><ChartNoAxesCombined size={17} aria-hidden="true" /> Recorded outcomes</span><span><Wallet size={17} aria-hidden="true" /> Your wallet</span></section>
    <section className="market-section" id="platform">
      <div className="market-section-heading"><p>One connected workspace</p><h2>Built around the trade.</h2><span>From your first signal to your next decision.</span></div>
      <div className="market-products">
        <Link href="/bots/discord" className="market-product market-product-featured"><Radio size={24} aria-hidden="true" /><div><p>Discovery & automation</p><h3>Follow the source.<br />Keep the controls.</h3><p>Explore recorded call outcomes, choose a community, and build a bot around your own trading rules.</p></div><span>Explore Discord sources <ArrowUpRight size={18} aria-hidden="true" /></span></Link>
        <div className="market-product-stack">
          <Link href="/bots/kol" className="market-product"><SlidersHorizontal size={23} aria-hidden="true" /><div><h3>A strategy in your terms.</h3><p>Configure market filters, entry conditions, and exits in one place.</p></div><span>Explore KOL strategies <ArrowUpRight size={18} aria-hidden="true" /></span></Link>
          <Link href="/portfolio" className="market-product"><ChartNoAxesCombined size={23} aria-hidden="true" /><div><h3>The full position picture.</h3><p>Review holdings, executions, fees, and realized results without switching tools.</p></div><span>Open portfolio <ArrowUpRight size={18} aria-hidden="true" /></span></Link>
        </div>
      </div>
    </section>
    <section id="how-it-works" className="market-section market-process"><div className="market-section-heading"><p>How it works</p><h2>Decide once.<br />Execute with a plan.</h2></div><div className="market-steps">{STEPS.map(({title, copy}, index) => <div key={title}><span className="market-step-number">0{index + 1}</span><h3>{title}</h3><p>{copy}</p></div>)}</div></section>
    <section className="market-section market-resources"><div><ShieldCheck size={25} aria-hidden="true" /><h2>Understand what<br />you authorize.</h2><p>Automation needs your permission. Learn how wallet access, risk controls, and performance measurement work before you start.</p><Link href="/docs/custody">Wallet access & custody <ArrowUpRight size={16} aria-hidden="true" /></Link></div><div className="market-resource-links">{[["/docs", "Read the trading guides", "Setup, execution, and measurement."], ["/docs/risk-controls", "Know your risk controls", "Position sizing, exits, and capital limits."], ["/affiliate", "Grow with your community", "Referrals, commissions, and payouts."]].map(([href,title,copy]) => <Link key={href} href={href}><BookOpen size={19} aria-hidden="true" /><span><strong>{title}</strong><small>{copy}</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>)}</div></section>
    <section className="market-closing"><p>DegenAration / Solana automation</p><h2>Make your next move<br />with a plan.</h2><Link href="/bots" className="market-primary">Open trading workspace <ArrowUpRight size={17} aria-hidden="true" /></Link></section>
    </main>
    <Footer />
  </div>;
}
