import Link from "next/link";
export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="font-mono text-xs text-toxic">← back</Link>
      <h1 className="mt-4 text-4xl font-bold">Terms of Service</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-dim">
        <p>Degenaration is self-directed, non-custodial trading software. It is not a broker, exchange, custodian, or financial advisor. By using the service you agree to the following.</p>
        <p><b className="text-ink">High risk.</b> Trading memecoins is extremely high risk. Prices can go to zero within seconds. You may lose your entire balance. Only trade what you can afford to lose.</p>
        <p><b className="text-ink">Not financial advice.</b> Nothing on this platform is investment, legal, or tax advice. Call-group performance and rankings are historical and do not guarantee future results.</p>
        <p><b className="text-ink">Wallet access.</b> Wallet keys remain with your wallet provider. Manual trades require your signature. Optional delegated access may allow the configured worker to request signatures while you are offline; application limits reduce execution risk but do not narrow the underlying wallet grant. Revoke delegation when it is not needed.</p>
        <p><b className="text-ink">Fees.</b> When platform fees are configured, the fee is shown before you sign a trade. You are responsible for network fees and taxes in your jurisdiction.</p>
        <p><b className="text-ink">No warranty.</b> The service is provided "as is" without warranties. To the maximum extent permitted by law, Degenaration is not liable for any trading losses.</p>
        <p>This service runs on Solana mainnet with real funds; all trades are final and irreversible. A finalized ToS reviewed for your jurisdiction will be published in due course.</p>
      </div>
    </main>
  );
}
