import Link from "next/link";
export default function Footer() {
  return (
    <footer className="border-t border-edge bg-void">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <p className="text-lg font-bold">
            DEGEN<span className="text-toxic">ARATION</span>
          </p>
          <div className="flex gap-6 font-mono text-xs text-dim">
            <Link href="/docs" className="hover:text-white">Docs & FAQ</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/security" className="hover:text-white">Security</Link>
            <Link href="/apply" className="hover:text-white">List your server</Link>
            <Link href="/onboarding" className="hover:text-white">Get started</Link>
          </div>
        </div>
        <p className="mt-8 max-w-3xl font-mono text-[11px] leading-relaxed text-dim/70">
          RISK DISCLOSURE: Memecoin trading is extremely high risk. You can lose your entire
          balance. Degenaration is self-directed trading software, not financial advice, and
          never holds custody of user funds. Past performance of any call group does not
          guarantee future results. Trade only what you can afford to lose.
        </p>
      </div>
    </footer>
  );
}
