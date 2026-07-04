"use client";
import { useEffect, useState } from "react";
import { getNet } from "@/lib/net";

export default function RiskBanner() {
  const [show, setShow] = useState(true);
  const [net, setNet] = useState("mainnet");
  useEffect(() => { setNet(getNet()); }, []);
  if (!show) return null;
  const mainnet = net === "mainnet";
  return (
    <div className={`relative z-[80] flex items-center justify-center gap-2 px-4 py-2 text-center font-mono text-[11px] ${mainnet ? "bg-hotpink/15 text-hotpink" : "bg-cyber/15 text-cyber"}`}>
      <span className="relative flex h-2 w-2"><span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${mainnet ? "bg-hotpink" : "bg-cyber"}`} /><span className={`relative inline-flex h-2 w-2 rounded-full ${mainnet ? "bg-hotpink" : "bg-cyber"}`} /></span>
      {mainnet
        ? <span><b>LIVE MAINNET · real funds.</b> Trades are irreversible and high-risk. Not financial advice. You trade at your own risk.</span>
        : <span><b>DEVNET · test mode.</b> Using test SOL. Switch to Mainnet in the header to trade for real.</span>}
      <button onClick={() => setShow(false)} aria-label="Dismiss" className="ml-2 opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}
