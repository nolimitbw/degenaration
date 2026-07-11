"use client";
import { useMemo } from "react";

type Datum = { value: number; label: string };

export default function PortfolioChart({ data, color = "#ff2255" }: { data: Datum[]; color?: string }) {
  const paths = useMemo(() => {
    if (!data.length) return { line: "", area: "" };
    const w = 400, h = 120;
    const max = Math.max(...data.map((d) => d.value), 1);
    const min = Math.min(...data.map((d) => d.value), 0);
    const range = max - min || 1;
    const pad = 4;
    const xs = data.map((_, i) => (i / (data.length - 1)) * (w - pad * 2) + pad);
    const ys = data.map((d) => h - pad - ((d.value - min) / range) * (h - pad * 2));
    const pts = xs.map((x, i) => `${x},${ys[i]}`);
    const area = `M${pts[0]}L${xs.map((x, i) => `${x},${h - pad}`).reverse().join("L")}L${pts[0]}Z`;
    return { line: `M${pts.join("L")}`, area };
  }, [data]);

  if (!data.length) return <div className="h-24 rounded-md bg-edge/40" />;

  return (
    <svg viewBox="0 0 400 120" className="w-full h-24" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pf-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={paths.area} fill="url(#pf-grad)" />
      <path d={paths.line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
