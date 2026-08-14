import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/**
 * Shared pieces for the documentation, kept deliberately small.
 *
 * Only what genuinely repeats lives here — the page intro, body copy at a readable measure,
 * and the next/previous link. Everything that makes a page recognisable is authored on the
 * page itself: the fee split, the execution pipeline, the message-format gallery and the
 * roadmap are each built once, for one page, and shared with nothing.
 *
 * That is the point. A documentation site where every page is the same component with
 * different strings reads as generated, because it was. Pages here differ in structure
 * because their subjects differ in shape.
 */

export function PageIntro({
  eyebrow,
  title,
  lede
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="border-b border-edge pb-8">
      <p className="ui-label text-gold-400">{eyebrow}</p>
      <h1 className="mt-3 text-[2.1rem] font-semibold leading-[1.06] tracking-[-0.03em] text-ink sm:text-[2.8rem]">
        {title}
      </h1>
      <p className="mt-5 max-w-2xl text-balance t-body leading-8 text-dim">{lede}</p>
    </header>
  );
}

/** Body copy. Long-form prose is the substance of these pages, so the measure is guarded. */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-2xl t-body leading-8 text-dim">{children}</p>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-12 text-[1.4rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-2xl">
      {children}
    </h2>
  );
}

/** A claim worth stopping on. Used sparingly — one or two per page at most. */
export function Pull({ children }: { children: React.ReactNode }) {
  return (
    <p className="my-10 max-w-2xl border-l-2 border-gold-400 pl-5 text-[1.15rem] font-medium leading-8 text-ink sm:text-[1.3rem]">
      {children}
    </p>
  );
}

export function NextPage({ href, label, title }: { href: string; label: string; title: string }) {
  return (
    <Link
      href={href}
      className="mt-16 flex items-center justify-between gap-4 rounded-2xl border border-edge bg-panel p-5 transition-colors duration-150 hover:border-gold-400 sm:p-6"
    >
      <span className="min-w-0">
        <span className="ui-label block">{label}</span>
        <span className="mt-1 block truncate t-body font-medium text-ink">{title}</span>
      </span>
      <ArrowUpRight aria-hidden="true" size={18} className="shrink-0 text-gold-400" />
    </Link>
  );
}
