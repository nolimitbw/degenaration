export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-dim">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-toxic" />
      {label ?? "Loading…"}
    </div>
  );
}
export function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-edge bg-panel/40 py-12 text-center">
      <p className="text-sm font-bold text-dim">{title}</p>
      {sub && <p className="mt-1 font-mono text-[11px] text-dim/70">{sub}</p>}
    </div>
  );
}
