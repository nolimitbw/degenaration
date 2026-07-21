import Link from "next/link";

const FAQ = [
  { q: "What is Degenaration?", a: "A Solana market terminal for live token research, measured Discord call sources, wallet tracking, wallet-signed swaps, and persistent limit-order preparation." },
  { q: "Who holds my funds?", a: "Your wallet provider does. Manual swaps require your wallet signature. Optional Privy delegation can let the configured worker request signatures while you are offline; it is powerful, revocable access and is not itself a cryptographic trade-only policy." },
  { q: "How does automation work?", a: "Before supported limit or Discord entry work is claimed, the database atomically checks the saved wallet, max-per-trade limit, source cap, and wallet daily cap. Automated signing remains disabled until the published devnet release gates pass. Wallet-copy and automated position exits are currently paused." },
  { q: "What does it cost?", a: "Free to join. When the platform fee wallet is configured, the execution fee is shown in the trade preview before you sign. If fees are off, the terminal says so." },
  { q: "Is this live or testnet?", a: "Manual wallet-signed swaps use Solana mainnet and real funds. Trades are irreversible. The unattended worker remains signing-disabled while automation is verified." },
  { q: "How are call groups ranked?", a: "From ingested call timestamps and live market measurements such as measured-call count, hit rate, median peak, average peak, and best call. Sparse profiles remain marked as measuring instead of showing invented results." },
  { q: "Is it safe?", a: "No memecoin trading system is safe from loss. Degenaration adds provider timeouts, input validation, token checks, atomic execution claims, spend reservations, and revocable delegation, but provider, contract, wallet, and market risk remain. An independent security review has not yet been completed." }
];

export default function Docs() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="font-mono text-xs text-toxic">← back</Link>
      <h1 className="mt-4 text-4xl font-bold">Docs & FAQ</h1>
      <div className="mt-8 space-y-6">
        {FAQ.map((f) => (
          <div key={f.q} className="rounded-lg border border-edge bg-panel p-5">
            <h2 className="font-bold text-ink">{f.q}</h2>
            <p className="mt-2 text-sm leading-relaxed text-dim">{f.a}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
