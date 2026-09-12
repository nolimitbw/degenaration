import Link from "next/link";
import { CheckCircle2, Gauge, KeyRound, RotateCcw, ShieldAlert } from "lucide-react";

const PERMS = [
  { icon: Gauge, title: "Atomic application limits", body: "Supported worker claims reserve max-per-trade and daily spend limits in Postgres before a signature is requested." },
  { icon: RotateCcw, title: "Revocable delegation", body: "Privy delegated access can be revoked from Wallet. Keep it off unless unattended execution is needed." },
  { icon: KeyRound, title: "Provider-secured keys", body: "Wallet keys remain with Privy or your connected wallet provider; Degenaration does not store private keys." },
  { icon: ShieldAlert, title: "Delegation is powerful", body: "The current delegation grant is not a cryptographic trade-only policy. Application checks are a separate server-side control." }
];
const CHECKS = [
  "Liquidity floor (skips illiquid tokens)",
  "Mint authority revoked (no infinite printing)",
  "Freeze authority revoked (can't freeze your tokens)",
  "Independent risk-score screen before supported Discord entries",
  "Maximum price-impact and slippage guardrails",
  "One database winner for each limit or subscriber execution"
];

export default function Security() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="font-mono text-xs text-gold-400">← back</Link>
      <h1 className="mt-4 text-4xl font-bold">Security model</h1>
      <p className="mt-3 text-dim">The controls below reduce execution risk; they do not make memecoin trading or delegated wallet access risk-free.</p>

      <h2 className="mt-10 text-lg font-bold">Wallet and worker boundaries</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PERMS.map((p) => (
          <div key={p.title} className="rounded-lg border border-edge bg-panel p-5">
            <p className="flex items-center gap-2 font-bold text-gold-400"><p.icon size={17} /> {p.title}</p>
            <p className="mt-2 text-sm text-dim">{p.body}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-bold">Every auto-buy is screened</h2>
      <ul className="mt-4 space-y-2">
        {CHECKS.map((c) => (
          <li key={c} className="flex items-start gap-2 rounded-md border border-edge bg-panel px-4 py-3 text-sm text-dim">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-gold-400" /> {c}
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg font-bold">Audit roadmap</h2>
      <div className="mt-4 rounded-lg border border-info/40 bg-info/5 p-5 text-sm text-dim">
        <p><span className="rounded-full border border-info/50 px-2 py-0.5 text-[12px] text-info">NOT AUDITED</span> An independent third-party review has not been completed. Manual swaps use <b className="text-danger">Solana Mainnet with real funds</b>. Bots do not place trades on their own yet.</p>
      </div>

      <p className="mt-8 text-[12px] text-dim">Rate-limited APIs · input validation · no private keys stored · RLS-protected database.</p>
    </main>
  );
}
