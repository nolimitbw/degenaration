import Link from "next/link";
import { ArrowRight, Radio, ShieldCheck, SlidersHorizontal, WalletCards } from "lucide-react";
import Logo from "@/components/Logo";

const FLOW = [
  { icon: Radio, label: "Source", value: "Approved Discord calls", className: "signal-card-blue" },
  { icon: SlidersHorizontal, label: "Risk", value: "Your entry and exit rules", className: "signal-card-violet" },
  { icon: ShieldCheck, label: "Execution", value: "Authorized from your wallet", className: "signal-card-coral" }
];

export default function Hero() {
  return <section className="market-hero" aria-labelledby="hero-heading">
    <div className="market-hero-copy">
      <p className="market-network"><span /> Trading infrastructure for Solana</p>
      <h1 id="hero-heading">Trade the calls<br />you already follow.</h1>
      <p className="market-hero-lede">Connect a source, define the risk, and follow every outcome from one disciplined workspace.</p>
      <div className="market-hero-actions">
        <Link href="/bots" className="market-primary">Open the workspace <ArrowRight size={17} aria-hidden="true" /></Link>
        <Link href="/docs" className="market-secondary">Read how it works</Link>
      </div>
      <p className="market-hero-note">You control the wallet, capital, and trading rules.</p>
    </div>
    <div className="product-scene" aria-label="DegenAration trading workflow preview">
      <div className="product-board">
        <header><Logo /><span>Strategy desk</span><span className="board-status"><i /> Ready to configure</span></header>
        <div className="board-body">
          <aside><span className="active">Overview</span><span>Sources</span><span>Strategies</span><span>Portfolio</span></aside>
          <div className="board-content">
            <div className="board-heading"><div><small>New automation</small><strong>Build a controlled trade flow</strong></div><WalletCards size={21} aria-hidden="true" /></div>
            <div className="signal-flow">
              {FLOW.map(({icon: Icon, label, value, className}) => <div key={label} className={`signal-card ${className}`}><Icon size={18} aria-hidden="true" /><small>{label}</small><strong>{value}</strong></div>)}
            </div>
            <div className="board-controls"><span><i /> Position size</span><span><i /> Take profit</span><span><i /> Stop loss</span></div>
          </div>
        </div>
      </div>
      <div className="scene-shadow" />
    </div>
  </section>;
}
