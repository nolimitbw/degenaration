"use client";

import Link from "next/link";
import { ChevronRight, CircleAlert, type LucideIcon } from "lucide-react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 border-b border-edge pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-toxic">{eyebrow}</p>}
        <h1 className="mt-2 text-2xl font-semibold text-ink lg:text-[28px]">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-dim">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function ProductTabs({ items, active }: { items: Array<{ href: string; label: string; count?: number }>; active: string }) {
  return (
    <nav className="mt-5 grid max-w-full grid-cols-4 border-b border-edge sm:flex sm:gap-1 sm:overflow-x-auto" aria-label="Bots navigation">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`relative flex min-h-11 min-w-0 items-center justify-center gap-1 px-1 text-center text-xs font-medium whitespace-nowrap transition sm:shrink-0 sm:gap-2 sm:px-4 sm:text-sm ${
            active === item.href ? "text-ink" : "text-dim hover:text-ink"
          }`}
        >
          {item.label}
          {item.count != null && <span className="rounded-sm bg-edge px-1.5 py-0.5 font-mono text-[9px] text-dim">{item.count}</span>}
          {active === item.href && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-toxic" />}
        </Link>
      ))}
    </nav>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone = "default"
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneClass = tone === "positive" ? "text-up" : tone === "negative" ? "text-down" : tone === "warning" ? "text-toxic" : "text-ink";
  return (
    <div className="min-w-0 border-l border-edge px-4 first:border-l-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-dim">{label}</p>
      <p className={`mt-2 truncate font-mono text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {detail && <p className="mt-1 truncate text-[11px] text-dim">{detail}</p>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const color = ["active", "approved", "supported", "confirmed", "succeeded", "healthy"].includes(normalized)
    ? "border-up/35 bg-up/5 text-up"
    : ["error", "failed", "rejected", "removed", "dead-letter", "unavailable"].includes(normalized)
      ? "border-down/35 bg-down/5 text-down"
      : ["pending", "reviewing", "processing", "planned", "degraded"].includes(normalized)
        ? "border-toxic/35 bg-toxic/5 text-toxic"
        : "border-edge bg-void text-dim";
  return (
    <span className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-2 font-mono text-[9px] uppercase ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.replaceAll("-", " ")}
    </span>
  );
}

export function EmptyState({
  icon: Icon = CircleAlert,
  title,
  description,
  action
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-64 place-items-center border border-dashed border-edge bg-panel/35 p-8 text-center">
      <div className="max-w-md">
        <Icon aria-hidden="true" size={24} className="mx-auto text-toxic" />
        <h2 className="mt-4 text-sm font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-dim">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-toxic transition hover:text-cyber">
      {children}
      <ChevronRight aria-hidden="true" size={15} />
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
    <div className="inline-flex min-h-10 overflow-hidden rounded-md border border-edge bg-void p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`min-w-14 rounded-sm px-3 text-xs font-medium transition ${
            value === option.value ? "bg-toxic text-[#17110c]" : "text-dim hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-md border border-edge bg-panel" />
      ))}
    </div>
  );
}
