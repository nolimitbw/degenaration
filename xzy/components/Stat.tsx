/**
 * Shared display primitives.
 *
 * The rule these all encode: an unknown is an em dash, never a zero. A channel with no
 * measured calls and a channel that lost money on every call must not look the same.
 */

export function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string | null;
  tone?: "neutral" | "up" | "down" | "gold";
}) {
  const toneClass =
    value === null
      ? "text-faint"
      : tone === "up"
        ? "text-up"
        : tone === "down"
          ? "text-down"
          : tone === "gold"
            ? "text-gold"
            : "text-ink";

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${toneClass}`}>{value ?? "—"}</span>
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "up" | "down" | "gold" }) {
  const tones = {
    neutral: "bg-surface2 text-muted",
    up: "bg-up/15 text-up",
    down: "bg-down/15 text-down",
    gold: "bg-gold/15 text-gold"
  } as const;
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface px-4 py-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/** Formats a peak multiple the way a trader reads it: 3.4x, not 340%. */
export function formatX(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value.toFixed(value >= 10 ? 0 : 1)}x`;
}

export function formatPct(value: number | null | undefined, signed = false): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
