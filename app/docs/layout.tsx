import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import Logo from "@/components/Logo";
import DocsNav from "@/components/docs/DocsNav";

export const metadata = {
  title: "DegenAration — Documentation",
  description:
    "How DegenAration turns Discord calls into executed Solana trades: the execution model, the risk controls, the fee structure and the roadmap."
};

/**
 * The documentation shell.
 *
 * One layout, twelve pages. Each section is its own route rather than an anchor on a single
 * scroll, so a reader can be sent straight to the fee model or the roadmap, each page carries
 * its own title and description, and the navigation marks where the reader actually is.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="degen-home min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-edge bg-[color:rgb(var(--void-rgb)/0.86)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label="DegenAration home" className="inline-flex min-h-11 min-w-11 items-center rounded-md">
              <Logo />
            </Link>
            <span aria-hidden="true" className="hidden h-4 w-px bg-[color:var(--rule-strong,var(--rule))] sm:block" />
            <span className="hidden t-meta text-dim sm:block">Documentation</span>
          </div>
          <Link
            href="/bots"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-gold-400 px-4 t-meta font-semibold text-[#17110c] transition-colors duration-150 hover:bg-gold-300"
          >
            Open the app <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[228px_1fr] lg:gap-16 lg:py-14">
        <DocsNav />
        <main id="main-content" tabIndex={-1} className="min-w-0 pb-8">
          {children}
        </main>
      </div>
    </div>
  );
}
