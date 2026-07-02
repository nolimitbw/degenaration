import Link from "next/link";
export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="font-mono text-xs text-toxic">← back</Link>
      <h1 className="mt-4 text-4xl font-bold">Privacy Policy</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-dim">
        <p>We collect the minimum needed to run the service: your account email (via Supabase auth), your public wallet address, your trading settings, and a record of executed trades.</p>
        <p><b className="text-white">We never collect private keys.</b> Keys are held by your wallet provider, not us.</p>
        <p>Data is stored securely with row-level security so you can only access your own records. We do not sell your data.</p>
        <p>On-chain activity (trades, balances) is inherently public on the Solana blockchain.</p>
        <p>You can request deletion of your account data at any time via support.</p>
      </div>
    </main>
  );
}
