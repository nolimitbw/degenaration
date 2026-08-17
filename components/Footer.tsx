import Link from "next/link";
import Logo from "@/components/Logo";
export default function Footer() {
  return (
    <footer className="relative border-t border-white/10">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="flex flex-wrap items-center justify-between gap-6">
          {/* min-h-11 is 44px, the minimum touch target. These were 16px tall on a phone —
              six links stacked a thumb-width apart, on the page every visitor sees first.
              The gap shrinks to compensate so the row still reads as one group. */}
          <p className="inline-flex min-h-11 items-center text-lg">
            <Logo />
          </p>
          <div className="flex flex-wrap items-center gap-x-6 font-mono text-xs text-haze">
            {[
              ["/docs", "Docs & FAQ"],
              ["/terms", "Terms"],
              ["/privacy", "Privacy"],
              ["/security", "Security"],
              ["/apply", "List your server"],
              ["/onboarding", "Get started"]
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors duration-150 hover:text-starlight"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <p className="mt-8 max-w-3xl text-[12px] leading-relaxed text-haze/70">
          RISK DISCLOSURE: Memecoin trading is extremely high risk. You can lose your entire
          balance. Degenaration is self-directed trading software, not financial advice, and
          never holds custody of user funds. Past performance of any call group does not
          guarantee future results. Trade only what you can afford to lose.
        </p>
      </div>
    </footer>
  );
}
