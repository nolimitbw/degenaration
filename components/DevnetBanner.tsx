"use client";
import { useState } from "react";
import { X } from "lucide-react";

export default function DevnetBanner() {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return (
    <div className="relative z-[80] flex items-center justify-center gap-2 border-b border-toxic/20 bg-[#191613] px-4 py-2 text-center font-mono text-[11px] text-[#c9aa88]">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-toxic opacity-50" /><span className="relative inline-flex h-2 w-2 rounded-full bg-toxic" /></span>
      <span><b>PAPER AUTOMATION.</b> Mainnet bot entries and automated payouts are disabled. Market data remains live.</span>
      <button onClick={() => setShow(false)} aria-label="Dismiss" title="Dismiss" className="ml-1 grid min-h-11 min-w-11 place-items-center rounded-md opacity-70 transition hover:bg-toxic/10 hover:opacity-100">
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
