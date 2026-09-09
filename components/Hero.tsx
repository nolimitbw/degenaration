import Link from "next/link";
import { ArrowUpRight, Radio, SlidersHorizontal, ScanLine } from "lucide-react";
import Logo from "@/components/Logo";

export default function Hero() {
  return <section className="market-hero" aria-labelledby="hero-heading">
    <div className="market-hero-copy">
      <p className="market-network"><span /> Built for Solana</p>
      <h1 id="hero-heading">Your conviction.<br />Your execution.</h1>
      <p className="market-hero-lede">Turn the sources you follow into a strategy you control.<br className="hidden sm:block" /> Automate entries, define your exits, and track the outcome.</p>
      <div className="market-hero-actions"><Link href="/bots" className="market-primary">Explore trading bots <ArrowUpRight size={17} aria-hidden="true" /></Link><Link href="#how-it-works" className="market-secondary">See how it works</Link></div>
    </div>
    <div className="market-orbit" aria-hidden="true"><div className="market-orbit-ring" /><div className="market-orbit-sphere"><Logo compact className="market-orbit-logo" /></div></div>
    <Link href="/bots/discord" className="market-float market-float-left"><Radio size={19} aria-hidden="true" /><span><small>Discover your next source</small><strong>Discord call tracking</strong></span><ArrowUpRight size={16} aria-hidden="true" /></Link>
    <Link href="/docs/risk-controls" className="market-float market-float-right"><SlidersHorizontal size={19} aria-hidden="true" /><span><small>Define your exposure</small><strong>Your rules. Every entry.</strong></span><ArrowUpRight size={16} aria-hidden="true" /></Link>
    <div className="market-hero-bottom"><ScanLine size={16} aria-hidden="true" /><span>Signals, execution, and portfolio. One workspace.</span></div>
  </section>;
}
