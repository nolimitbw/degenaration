import Link from "next/link";

const FAQ = [
  { q: "What is Degenaration?", a: "An on-chain Solana trading terminal that lets you discover tokens, follow ranked alpha call groups, track top wallets, and auto-trade — all non-custodially. Your keys never leave your control." },
  { q: "Is it custodial? Who holds my funds?", a: "You do. Your wallet is either an embedded wallet secured to your login or your own Phantom/Solflare. The platform receives only a trade-only, spend-capped, revocable permission — it can never withdraw your funds." },
  { q: "How does auto-trading work?", a: "You subscribe to vetted Discord call groups or tracked wallets and set your rules (position size, take-profit ladder, stop-loss, slippage, daily loss cap). When a call fires, the engine rug-checks the token, then executes the swap from your wallet within your limits." },
  { q: "What does it cost?", a: "Free to join. A flat 2% fee is taken on-chain on each trade in and out (including partials), only when you actually trade. No subscription." },
  { q: "Is this live or testnet?", a: "The app is live on Solana devnet for safe testing. Do not deposit real funds yet — mainnet with real trading launches after a security review and legal sign-off." },
  { q: "How are call groups ranked?", a: "By real on-chain performance — total return, hit rate, median return and best call — not screenshots. See the Alpha leaderboard." },
  { q: "Is it safe?", a: "Non-custodial by design, with rug-checks (liquidity, mint/freeze authority, honeypot), rate-limited APIs, input validation, and no private keys stored anywhere. An independent security audit is planned before mainnet." }
];

export default function Docs() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="font-mono text-xs text-toxic">← back</Link>
      <h1 className="mt-4 text-4xl font-bold">Docs & FAQ</h1>
      <div className="mt-8 space-y-6">
        {FAQ.map((f) => (
          <div key={f.q} className="rounded-lg border border-edge bg-panel p-5">
            <h2 className="font-bold text-white">{f.q}</h2>
            <p className="mt-2 text-sm leading-relaxed text-dim">{f.a}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
