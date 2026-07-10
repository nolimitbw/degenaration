"use client";
import { useState } from "react";

// Mainnet-only risk banner. Real funds, real trades — shown until dismissed.
export default function DevnetBanner() {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return (
    <div className="relative z-[80] flex items-center justify-center gap-2 bg-hotpink/15 px-4 py-2 text-center font-mono text-[11px] text-hotpink">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hotpink opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-hotpink" /></span>
      <span><b>LIVE MAINNET · real funds.</b> Trades are irreversible and high-risk. Not financial advice. You trade at your own risk.</span>
      <button onClick={() => setShow(false)} aria-label="Dismiss" className="ml-2 opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}
