"use client";
import { useState } from "react";
import { X } from "lucide-react";

// Mainnet-only risk banner. Real funds, real trades — shown until dismissed.
export default function DevnetBanner() {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return (
    <div className="relative z-[80] flex items-center justify-center gap-2 border-b border-down/20 bg-[#1d1415] px-4 py-2 text-center font-mono text-[11px] text-[#dda0a0]">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-down opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-down" /></span>
      <span><b>LIVE MAINNET · real funds.</b> Trades are irreversible and high-risk. Not financial advice. You trade at your own risk.</span>
      <button onClick={() => setShow(false)} aria-label="Dismiss" title="Dismiss" className="ml-1 grid min-h-11 min-w-11 place-items-center rounded-md opacity-70 transition hover:bg-down/10 hover:opacity-100">
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
