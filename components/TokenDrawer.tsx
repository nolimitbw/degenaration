"use client";
import { useEffect, useState } from "react";
import { fmtNum, fmtAge } from "@/lib/queries";
import { getNet } from "@/lib/net";
import { usePrivy } from "@privy-io/react-auth";
import { useSendTransaction } from "@privy-io/react-auth/solana";
import { executeBuy as extensionBuy } from "@/lib/execute";
import { supabase } from "@/lib/supabase";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { getRpc } from "@/lib/net";
import { useToast } from "@/components/Toast";

const SOL = "So11111111111111111111111111111111111111112";
const PRESETS = [0.1, 0.5, 1, 2];

export default function TokenDrawer({ token, onClose }: { token: any | null; onClose: () => void }) {
  const { authenticated, user } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const embeddedAddr = (user as any)?.wallet?.address as string | undefined;
  const toast = useToast();
  const [price, setPrice] = useState<any>(null);
  const [rug, setRug] = useState<any>(null);
  const [conc, setConc] = useState<number | null>(null);
  const [amount, setAmount] = useState(0.5);
  const [slippage, setSlippage] = useState(3);
  const [sim, setSim] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSim(null); setPrice(null); setRug(null); setConc(null);
    if (!token) return;
    const mint = token.address;
    fetch(`/api/price?mint=${mint}`).then((r) => r.json()).then(setPrice).catch(() => {});
    fetch(`/api/rugcheck?mint=${mint}`).then((r) => r.json()).then(setRug).catch(() => {});
    fetch(`/api/holders?mint=${mint}&net=${getNet()}`).then((r) => r.json()).then((d) => {
      const top = (d?.holders ?? []).slice(0, 10).reduce((s: number, h: any) => s + (h.pct || 0), 0);
      setConc(top || null);
    }).catch(() => {});
  }, [token]);

  if (!token) return null;

  async function doSim() {
    setBusy(true);
    const r = await fetch(`/api/simulate?in=${SOL}&out=${token.address}&amount=${Math.floor(amount * 1e9)}&slippageBps=${slippage * 100}`).then((x) => x.json()).catch(() => null);
    setSim(r); setBusy(false);
  }

  async function doBuy() {
    setBusy(true);
    if (embeddedAddr && authenticated) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/swap", {
          method: "POST",
          headers: { "content-type": "application/json", ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ inputMint: SOL, outputMint: token.address, amount: Math.floor(amount * 1e9), userPublicKey: embeddedAddr, slippageBps: slippage * 100, net: getNet() })
        }).then((r) => r.json());
        if (res.error || !res.swapTransaction) { toast(res.error || "Could not build swap", "err"); setBusy(false); return; }
        const raw = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(raw);
        const connection = new Connection(getRpc(), "confirmed");
        const receipt: any = await sendTransaction({ transaction: tx, connection });
        const sig = receipt?.signature ?? null;
        if (sig) { toast("Trade sent — " + sig.slice(0, 8)); onClose(); }
        else toast("Signing cancelled", "err");
      } catch (e: any) {
        toast(e.message || "Signing failed", "err");
      }
    } else {
      const r = await extensionBuy({ mint: token.address, solAmount: amount, slippageBps: slippage * 100, priceUsd: price?.priceUsd, symbol: token.symbol });
      if (r.ok) { toast("Trade sent — " + (r.sig?.slice(0, 8) ?? "")); onClose(); }
      else toast(r.error || "Trade failed", "err");
    }
    setBusy(false);
  }

  const socials = price?.socials ?? token.socials ?? [];
  const websites = price?.websites ?? [];

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/60" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto border-l border-edge bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {token.image ? <img src={token.image} alt="" className="h-10 w-10 rounded-full" /> : <div className="grid h-10 w-10 place-items-center rounded-full bg-edge font-mono text-xs">{token.symbol?.slice(0, 2)}</div>}
            <div>
              <p className="flex items-center gap-1 font-mono font-bold">{token.symbol}{(token.ageMs != null && token.ageMs < 3600000) && <span className="rounded bg-hotpink/20 px-1 text-[9px] text-hotpink">new</span>}</p>
              <p className="font-mono text-[11px] text-dim">{token.name} · {fmtAge(token.ageMs)}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-dim hover:text-white">✕</button>
        </div>

        {/* links */}
        {(socials.length > 0 || websites.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px]">
            {websites.slice(0, 2).map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer" className="rounded border border-edge px-2 py-0.5 text-cyber hover:border-cyber">site ↗</a>)}
            {socials.slice(0, 3).map((s: any) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="rounded border border-edge px-2 py-0.5 text-cyber hover:border-cyber">{s.type} ↗</a>)}
            <a href={`https://solscan.io/token/${token.address}`} target="_blank" rel="noreferrer" className="rounded border border-edge px-2 py-0.5 text-dim hover:border-cyber hover:text-cyber">solscan ↗</a>
          </div>
        )}

        {/* chart */}
        <div className="mt-4">
          {price?.pairAddress ? (
            <iframe key={price.pairAddress} src={`https://dexscreener.com/${price.chainId || "solana"}/${price.pairAddress}?embed=1&theme=dark&trades=0&info=0`} className="h-64 w-full rounded-md border border-edge" title="chart" />
          ) : (
            <div className="grid h-64 place-items-center rounded-md border border-edge bg-void text-sm text-dim">Loading chart…</div>
          )}
        </div>

        {/* stats */}
        <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-[11px]">
          <div><p className="text-dim">Price</p><p className="text-white">{price?.priceUsd ? `$${price.priceUsd}` : fmtNum(token.priceUsd)}</p></div>
          <div><p className="text-dim">MC / FDV</p><p className="text-white">{fmtNum(price?.fdv ?? token.marketCap)}</p></div>
          <div><p className="text-dim">Liq</p><p className="text-white">{fmtNum(price?.liquidityUsd ?? token.liquidityUsd)}</p></div>
          <div><p className="text-dim">24h Vol</p><p className="text-white">{fmtNum(price?.volume24h ?? token.vol24h)}</p></div>
          <div><p className="text-dim">24h</p><p className={(price?.change24h ?? 0) >= 0 ? "text-toxic" : "text-hotpink"}>{price?.change24h != null ? `${price.change24h >= 0 ? "+" : ""}${Number(price.change24h).toFixed(1)}%` : "—"}</p></div>
          <div><p className="text-dim">Buys/Sells</p><p><span className="text-toxic">{price?.buys24h ?? "—"}</span><span className="text-dim">/</span><span className="text-hotpink">{price?.sells24h ?? "—"}</span></p></div>
        </div>

        {/* security profile */}
        <div className="mt-4 rounded-lg border border-edge bg-void p-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase text-dim">Security</p>
            {rug ? (
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${rug.ok ? "bg-toxic/20 text-toxic" : "bg-hotpink/20 text-hotpink"}`}>{rug.ok ? "PASSED" : "RISKS FOUND"}</span>
            ) : <span className="font-mono text-[10px] text-dim">checking…</span>}
          </div>
          {rug && !rug.ok && (rug.reasons?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-1">
              {rug.reasons.map((r: string) => <li key={r} className="flex items-start gap-1 font-mono text-[10px] text-hotpink">⚠ <span>{r}</span></li>)}
            </ul>
          )}
          {rug?.ok && <p className="mt-1 font-mono text-[10px] text-dim">Mint & freeze checks clear, liquidity present. Always DYOR.</p>}
          <div className="mt-2 flex justify-between border-t border-edge pt-2 font-mono text-[10px]">
            <span className="text-dim">Top 10 holders</span>
            <span className={conc != null && conc > 50 ? "text-hotpink" : "text-white"}>{conc != null ? `${conc.toFixed(1)}%` : "—"}</span>
          </div>
        </div>

        {/* buy form */}
        <div className="mt-4 rounded-lg border border-edge bg-void p-4">
          <label className="block">
            <span className="font-mono text-[11px] uppercase text-dim">Amount (SOL)</span>
            <input type="number" step="0.1" value={amount} onChange={(e) => setAmount(+e.target.value)} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 font-mono outline-none focus:border-toxic" />
          </label>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {PRESETS.map((a) => <button key={a} onClick={() => setAmount(a)} className="rounded border border-edge py-1.5 font-mono text-xs text-dim transition hover:border-toxic hover:text-toxic">{a}</button>)}
          </div>
          <label className="mt-3 block">
            <span className="font-mono text-[11px] uppercase text-dim">Max slippage %</span>
            <input type="number" value={slippage} onChange={(e) => setSlippage(+e.target.value)} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 font-mono outline-none focus:border-cyber" />
          </label>
          {sim && !sim.error && (
            <div className="mt-3 space-y-1 rounded-md border border-edge bg-panel px-3 py-2 font-mono text-[11px]">
              <div className="flex justify-between"><span className="text-dim">Est. receive</span><span className="text-toxic">{price?.priceUsd && price?.solPrice ? (amount * price.solPrice / price.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 2 }) : (sim.outAmount/1e6).toLocaleString()} {token.symbol}</span></div>
              <div className="flex justify-between"><span className="text-dim">Price impact</span><span className={sim.priceImpactPct>10?"text-hotpink":""}>{sim.priceImpactPct.toFixed(2)}%</span></div>
              <div className="flex justify-between"><span className="text-dim">Fee (2%)</span><span>{sim.feeSol.toFixed(4)} SOL</span></div>
            </div>
          )}
          {sim?.error && <p className="mt-2 font-mono text-[11px] text-hotpink">{sim.error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={doSim} disabled={busy} className="rounded-md border border-edge py-2.5 text-sm font-bold text-dim transition hover:border-toxic hover:text-toxic disabled:opacity-50">{busy ? "…" : "Simulate"}</button>
            <button onClick={doBuy} disabled={busy} className="rounded-md bg-toxic py-2.5 text-sm font-bold text-void shadow-toxic transition hover:brightness-110 disabled:opacity-50">Buy</button>
          </div>
          <p className="mt-2 text-center font-mono text-[10px] text-dim">Non-custodial · your wallet signs · 2% fee on-chain</p>
        </div>
      </div>
    </div>
  );
}
