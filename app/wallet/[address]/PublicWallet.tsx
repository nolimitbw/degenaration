"use client";

import { AlertTriangle, ArrowUpRight, LoaderCircle, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Position = {
  mint: string;
  amount: number;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  valueUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
};

type Portfolio = {
  address: string;
  sol: number;
  solPrice: number;
  solChange24h: number | null;
  solUsd: number;
  positions: Position[];
  tokenUsd: number;
  totalUsd: number;
  count: number;
  partial: boolean;
  warning: string | null;
};

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 });

function priceMovePnl(value: number, percent: number | null) {
  if (percent == null || !Number.isFinite(percent) || percent <= -99.99) return 0;
  const prior = value / (1 + percent / 100);
  return value - prior;
}

export default function PublicWallet({ address }: { address: string }) {
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portfolio?address=${encodeURIComponent(address)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Wallet lookup failed");
        setData(payload);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Wallet lookup failed"));
  }, [address]);

  const pnl24h = useMemo(() => {
    if (!data) return 0;
    return priceMovePnl(data.solUsd, data.solChange24h)
      + data.positions.reduce((sum, position) => sum + priceMovePnl(position.valueUsd || 0, position.change24h), 0);
  }, [data]);

  if (error) return <State error={error} />;
  if (!data) return <State />;

  return (
    <div>
      {data.partial && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-amber-300" />
          <div><p className="font-semibold">Partial wallet data</p><p className="mt-0.5 text-xs leading-5 text-dim">{data.warning} Refresh shortly to retry the live read.</p></div>
        </div>
      )}
      <div className="grid overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Portfolio value" value={usd(data.totalUsd)} detail={`${data.count} priced token${data.count === 1 ? "" : "s"}`} />
        <Card label="24h price-move P&L" value={`${pnl24h >= 0 ? "+" : ""}${usd(pnl24h)}`} detail="Estimate on current balances" tone={pnl24h >= 0 ? "up" : "down"} />
        <Card label="SOL balance" value={`${data.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`} detail={usd(data.solUsd)} />
        <Card label="Token value" value={usd(data.tokenUsd)} detail="Dust and unpriced spam excluded" />
      </div>

      <div className="mt-6 overflow-x-auto rounded-md border border-edge">
        {data.positions.length ? (
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-panel font-mono text-[10px] uppercase text-dim"><tr><th className="px-4 py-3">Asset</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">24h</th><th className="px-4 py-3">Actions</th></tr></thead>
            <tbody>
              {data.positions.map((position) => (
                <tr key={position.mint} className="border-t border-edge text-sm">
                  <td className="px-4 py-3"><p className="font-semibold text-ink">{position.symbol || "Unknown"}</p><p className="mt-0.5 font-mono text-[10px] text-dim">{position.mint.slice(0, 6)}...{position.mint.slice(-4)}</p></td>
                  <td className="px-4 py-3 font-mono text-xs text-dim">{position.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="px-4 py-3 font-mono text-xs">{position.priceUsd == null ? "-" : usd(position.priceUsd)}</td>
                  <td className="px-4 py-3 font-mono text-xs font-bold">{usd(position.valueUsd || 0)}</td>
                  <td className={`px-4 py-3 font-mono text-xs font-bold ${(position.change24h || 0) >= 0 ? "text-up" : "text-hotpink"}`}>{position.change24h == null ? "-" : `${position.change24h >= 0 ? "+" : ""}${position.change24h.toFixed(1)}%`}</td>
                  <td className="px-4 py-3"><div className="flex gap-3 font-mono text-[11px]"><Link href={`/terminal?mint=${position.mint}`} className="text-toxic hover:underline">Trade</Link><Link href={`/risk/${position.mint}`} className="text-dim hover:text-ink">Risk</Link></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid min-h-48 place-items-center bg-panel/30 px-6 text-center"><div><WalletCards aria-hidden="true" className="mx-auto text-dim" /><p className="mt-3 font-semibold">No priced token balances</p><p className="mt-1 text-sm text-dim">This wallet currently has only SOL, dust, or unpriced assets.</p></div></div>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 font-mono text-[10px] leading-5 text-dim">
        <ShieldCheck aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-cyber" />
        The 24h figure estimates price movement on the wallet&apos;s current balances. It is not realized trade P&L and does not account for transfers or intraday balance changes.
      </div>
      <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold hover:border-toxic/60">Verify on Solscan <ArrowUpRight aria-hidden="true" size={15} /></a>
    </div>
  );
}

function Card({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "up" | "down" }) {
  return <div className="bg-panel p-4 sm:border-r sm:border-edge sm:last:border-r-0"><p className="font-mono text-[10px] uppercase text-dim">{label}</p><p className={`mt-2 text-xl font-bold ${tone === "up" ? "text-up" : tone === "down" ? "text-hotpink" : "text-ink"}`}>{value}</p><p className="mt-1 font-mono text-[10px] text-dim">{detail}</p></div>;
}

function State({ error }: { error?: string }) {
  return <div className="grid min-h-56 place-items-center rounded-md border border-edge bg-panel/40 p-6 text-center"><div>{error ? <AlertTriangle aria-hidden="true" className="mx-auto text-hotpink" /> : <LoaderCircle aria-hidden="true" className="mx-auto animate-spin text-toxic" />}<p className="mt-3 font-bold">{error ? "Wallet unavailable" : "Loading on-chain wallet"}</p><p className="mt-1 text-sm text-dim">{error || "Reading balances and live market prices."}</p></div></div>;
}
