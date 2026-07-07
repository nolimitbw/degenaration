"use client";
import { useEffect, useState } from "react";
import { getNet, setNet, type Net } from "@/lib/net";
import { useToast } from "@/components/Toast";

export default function NetworkToggle() {
  const [net, setLocal] = useState<Net>("devnet");
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  useEffect(() => { setLocal(getNet()); }, []);
  const choose = (n: Net) => {
    if (n === "mainnet" && net !== "mainnet") { setConfirm(true); return; }
    setNet(n); setLocal(n); toast(`Switched to ${n}`);
  };
  return (
    <>
      <div className="flex items-center gap-1 rounded-md border border-edge bg-void p-0.5 font-mono text-[11px]">
        <button onClick={() => choose("devnet")} className={`rounded px-2 py-1 ${net === "devnet" ? "bg-toxic/20 text-toxic" : "text-dim"}`}>Devnet</button>
        <button onClick={() => choose("mainnet")} className={`rounded px-2 py-1 ${net === "mainnet" ? "bg-hotpink/20 text-hotpink" : "text-dim/60"}`}>Mainnet</button>
      </div>
      {confirm && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-black/70 p-4" onClick={() => setConfirm(false)}>
          <div className="w-full max-w-sm rounded-lg border border-hotpink/40 bg-panel p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-hotpink">Switch to Mainnet?</h3>
            <p className="mt-2 text-sm text-dim">Mainnet uses <b className="text-gray-900">real SOL</b>. Trades cost real money and are irreversible. Only continue if you understand the risk and have tested on devnet first.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirm(false)} className="flex-1 rounded-md border border-edge py-2 text-sm font-bold text-dim">Cancel</button>
              <button onClick={() => { setNet("mainnet"); setLocal("mainnet"); setConfirm(false); toast("Switched to mainnet — real funds", "err"); }} className="flex-1 rounded-md bg-hotpink py-2 text-sm font-bold text-white">I understand, switch</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
