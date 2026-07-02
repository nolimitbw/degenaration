export function Chg({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-dim">—</span>;
  return <span className={v >= 0 ? "text-toxic" : "text-hotpink"}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
}
export function Pressure({ b, s }: { b: number; s: number }) {
  const t = (b + s) || 1; const bp = (b / t) * 100;
  return <div className="h-1.5 w-16 overflow-hidden rounded-full bg-hotpink/40" title={`${b} buys / ${s} sells`}><div className="h-full bg-toxic" style={{ width: `${bp}%` }} /></div>;
}
