import FlashValue from "@/components/FlashValue";

export function Chg({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-dim">—</span>;
  return <FlashValue value={v} className={v >= 0 ? "text-up" : "text-danger"}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</FlashValue>;
}
export function Pressure({ b, s }: { b: number; s: number }) {
  const t = (b + s) || 1; const bp = (b / t) * 100;
  return <div className="h-1.5 w-16 overflow-hidden rounded-full bg-danger/40" title={`${b} buys / ${s} sells`}><div className="h-full bg-gold-400 transition-[width] duration-500" style={{ width: `${bp}%` }} /></div>;
}
