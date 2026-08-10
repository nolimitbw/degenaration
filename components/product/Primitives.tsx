"use client";

import Link from "next/link";
import { ChevronRight, CircleAlert, type LucideIcon } from "lucide-react";

/**
 * The shared surface vocabulary.
 *
 * Structure here comes from rules and spacing, not from boxes. The previous version wrapped
 * every group in `rounded-md border border-edge bg-panel`, so a screen was boxes inside boxes
 * inside boxes and nothing could be more important than anything else. A ledger rules its
 * columns; it does not draw a border around each entry.
 *
 * Gold is spent on one thing per screen: the action the user came to take. Everything that
 * used to be gold by default — icons, dots, tab underlines, section headings, links — is ink
 * or muted now, so the accent means "act here" rather than "this is decorated".
 */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  /**
   * Retained for callers that pass a genuine parent context (a bot's source, a client's name).
   * It is NOT a place for a restatement of the section — the shell already says where you are,
   * and an eyebrow that repeats it is the filler FINAL_LAUNCH_SPEC section 6.1 rules out.
   */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 pb-5 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
      <div className="min-w-0">
        {eyebrow && <p className="ui-label mb-1.5 truncate">{eyebrow}</p>}
        <h1 className="text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink lg:text-[34px]">
          {title}
        </h1>
        {description && <p className="mt-2 max-w-xl text-[15px] leading-6 text-dim">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function ProductTabs({ items, active }: { items: Array<{ href: string; label: string; count?: number }>; active: string }) {
  return (
    <nav
      className="-mx-4 grid grid-cols-4 border-y border-[color:var(--rule)] px-4 sm:mx-0 sm:flex sm:gap-7 sm:border-t-0 sm:px-0"
      aria-label="Section"
    >
      {items.map((item) => {
        const current = active === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`relative flex min-h-12 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap px-1 text-center text-[13px] transition sm:justify-start sm:px-0 sm:text-sm ${
              current ? "font-medium text-ink" : "text-dim hover:text-ink"
            }`}
          >
            <span className="truncate">{item.label}</span>
            {item.count != null && (
              <span className="ui-figure shrink-0 rounded-sm bg-[color:var(--rule)] px-1.5 py-px text-[11px] text-dim">{item.count}</span>
            )}
            {/* Ink, not gold. The tab you are on is a fact about where you are, not an action. */}
            {current && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * One figure and its name. Number first and at reading size — a balance should be legible
 * without leaning in, and the old 9px-label-over-18px-value pairing put the caption and the
 * money within a hair of each other.
 *
 * Compose these inside a `.rail` for the ledger band; they carry no chrome of their own.
 */
export function Metric({
  label,
  value,
  detail,
  hint,
  tone = "default"
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  /**
   * What the number actually measures, for a label too short to say it. Rendered as the tile's
   * title rather than as visible copy so a dense row stays dense — the progressive-disclosure
   * rule in FINAL_LAUNCH_SPEC section 6.3.
   */
  hint?: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneClass =
    tone === "positive" ? "text-up" : tone === "negative" ? "text-down" : tone === "warning" ? "text-gold-400" : "text-ink";
  return (
    <div className="min-w-0" title={hint}>
      <p className={`ui-figure truncate text-[22px] leading-none lg:text-[25px] ${toneClass}`}>{value}</p>
      <p className="ui-label mt-2 truncate">{label}</p>
      {detail && <p className="mt-1 truncate text-[11px] text-[color:var(--text-muted)]">{detail}</p>}
    </div>
  );
}

/**
 * A value the system does not have. Never rendered as 0 — reporting zero measured calls for a
 * source we have not measured states the opposite of the truth — and never as `--`, which
 * reads as a rendering failure rather than an honest absence.
 */
export function Absent() {
  return <span className="ui-absent" title="Not measured yet">—</span>;
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = ["active", "approved", "supported", "confirmed", "succeeded", "healthy"].includes(normalized)
    ? "text-up"
    : ["error", "failed", "rejected", "removed", "dead-letter", "unavailable"].includes(normalized)
      ? "text-down"
      : ["pending", "reviewing", "processing", "planned", "degraded"].includes(normalized)
        ? "text-gold-400"
        : "text-dim";
  const label = status.replaceAll("-", " ");
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] ${tone}`}>
      <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-current" />
      <span className="first-letter:uppercase">{label}</span>
    </span>
  );
}

/**
 * An empty screen is an invitation to act, not a notice that something is missing. The dashed
 * border and 256px minimum made absence look like breakage and left a hole in the page; this
 * states the situation and offers the next move.
 */
export function EmptyState({
  icon: Icon = CircleAlert,
  title,
  description,
  action,
  compact = false
}: {
  /**
   * A Lucide icon OR one of the original DegenAration glyphs under components/icons. Those are
   * plain function components rather than forwardRef exotics, so typing this as LucideIcon
   * alone rejected the product's own iconography in favour of generic symbols — exactly
   * backwards for a design system whose point is that the glyphs are ours.
   */
  icon?: LucideIcon | React.ComponentType<{ size?: number; className?: string; title?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "px-1 py-8" : "px-1 py-14"}>
      <div className="max-w-sm">
        <Icon aria-hidden="true" size={18} className="text-[color:var(--text-muted)]" />
        <h2 className="mt-3 text-[15px] font-medium text-ink">{title}</h2>
        <p className="mt-1.5 text-[13px] leading-5 text-dim">{description}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-ink transition hover:text-gold-400 sm:min-h-10">
      {children}
      <ChevronRight aria-hidden="true" size={14} className="text-[color:var(--text-muted)]" />
    </Link>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <div className="inline-flex min-h-11 items-center gap-px rounded-md border border-[color:var(--rule)] p-1 sm:min-h-9" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          /* 44px at touch sizes. The period switches are the most-tapped control on the
             marketplace, and 36px put every one of them under the minimum. */
          className={`min-h-11 min-w-12 rounded px-3 text-[13px] transition sm:min-h-7 ${
            value === option.value ? "bg-[color:var(--rule-strong)] font-medium text-ink" : "text-dim hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Skeletons resemble the rows they replace, so the page does not reflow when data lands. */
export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-[color:var(--rule)] px-1 py-4 last:border-b-0">
          <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-[color:var(--rule)]" />
          <div className="h-3 w-40 animate-pulse rounded-sm bg-[color:var(--rule)]" />
          <div className="ml-auto h-3 w-16 animate-pulse rounded-sm bg-[color:var(--rule)]" />
        </div>
      ))}
    </div>
  );
}
