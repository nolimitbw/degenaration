import Link from "next/link";
import Logo from "@/components/Logo";
export default function Footer() {
  return (
    <footer className="relative border-t border-white/10">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <p className="text-lg">
            <Logo />
          </p>
          <div className="flex flex-wrap gap-6 font-mono text-xs text-haze">
            <Link href="/docs" className="hover:text-starlight">Docs & FAQ</Link>
            <Link href="/terms" className="hover:text-starlight">Terms</Link>
            <Link href="/privacy" className="hover:text-starlight">Privacy</Link>
            <Link href="/security" className="hover:text-starlight">Security</Link>
            <Link href="/apply" className="hover:text-starlight">List your server</Link>
            <Link href="/onboarding" className="hover:text-starlight">Get started</Link>
          </div>
        </div>
        <p className="mt-8 max-w-3xl font-mono text-[11px] leading-relaxed text-haze/70">
          RISK DISCLOSURE: Memecoin trading is extremely high risk. You can lose your entire
          balance. Degenaration is self-directed trading software, not financial advice, and
          never holds custody of user funds. Past performance of any call group does not
          guarantee future results. Trade only what you can afford to lose.
        </p>
      </div>
    </footer>
  );
}
