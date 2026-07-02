import Link from "next/link";

const PERMS = [
  { icon: "✓", title: "Trade-only", body: "The engine can only swap tokens. It cannot transfer or withdraw your funds — ever." },
  { icon: "✓", title: "Spend-capped", body: "You set a max per trade and a daily cap. The engine can never exceed them." },
  { icon: "✓", title: "Revocable", body: "Revoke the trade permission with one click in your Wallet, any time." },
  { icon: "✓", title: "No stored keys", body: "Private keys stay with your wallet provider. We never see or store them." }
];
const CHECKS = [
  "Liquidity floor (skips illiquid tokens)",
  "Mint authority revoked (no infinite printing)",
  "Freeze authority revoked (can't freeze your tokens)",
  "Honeypot / risk-score screen before every auto-buy",
  "Max price-impact and slippage guardrails",
  "Trade simulation shown before anything executes"
];

export default function Security() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="font-mono text-xs text-toxic">← back</Link>
      <h1 className="mt-4 text-4xl font-bold">Security & non-custodial by design</h1>
      <p className="mt-3 text-dim">Your keys, your coins. Here is exactly what the platform can and cannot do.</p>

      <h2 className="mt-10 text-lg font-bold">What permission the bot gets</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PERMS.map((p) => (
          <div key={p.title} className="rounded-lg border border-edge bg-panel p-5">
            <p className="font-bold text-toxic">{p.icon} {p.title}</p>
            <p className="mt-2 text-sm text-dim">{p.body}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-bold">Every auto-buy is screened</h2>
      <ul className="mt-4 space-y-2">
        {CHECKS.map((c) => (
          <li key={c} className="flex items-start gap-2 rounded-md border border-edge bg-panel px-4 py-3 text-sm text-dim">
            <span className="text-toxic">✓</span> {c}
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg font-bold">Audit roadmap</h2>
      <div className="mt-4 rounded-lg border border-cyber/40 bg-cyber/5 p-5 text-sm text-dim">
        <p><span className="rounded-full border border-cyber/50 px-2 py-0.5 font-mono text-[11px] text-cyber">PLANNED</span> An independent third-party security review of the trading engine and permission model is scheduled before mainnet launch. Until then the app runs on <b className="text-hotpink">Solana devnet</b> for safe testing — do not deposit real funds.</p>
      </div>

      <p className="mt-8 font-mono text-[11px] text-dim">Rate-limited APIs · input validation · no private keys stored · RLS-protected database.</p>
    </main>
  );
}
