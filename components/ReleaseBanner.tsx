"use client";
import { useState } from "react";
import { X } from "lucide-react";

export default function ReleaseBanner() {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return (
    <div className="relative z-[80] flex items-center justify-center gap-2 border-b border-gold-400/20 bg-[#191613] px-4 py-2 text-center font-mono text-[11px] text-[#c9aa88]">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-50" /><span className="relative inline-flex h-2 w-2 rounded-full bg-gold-400" /></span>
      <span><b>SOLANA MAINNET.</b> You confirm every transaction in your own wallet. Automated trading and payouts are not yet available.</span>
      <button onClick={() => setShow(false)} aria-label="Dismiss" title="Dismiss" className="ml-1 grid min-h-11 min-w-11 place-items-center rounded-md opacity-70 transition hover:bg-gold-400/10 hover:opacity-100">
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
