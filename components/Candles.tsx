"use client";

import { useState } from "react";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

const W = 840;
const H = 420;
const TOP = 18;
const RIGHT = 76;
const BOTTOM = 58;
const LEFT = 8;

function priceLabel(value: number) {
  const digits = value < 0.0001 ? 8 : value < 0.01 ? 6 : value < 1 ? 4 : 2;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export default function Candles({ data, className = "h-72 rounded-md border border-edge" }: { data: Candle[]; className?: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (data.length < 2) return <div className={`grid place-items-center bg-void text-sm text-dim ${className}`}>Live candles are unavailable.</div>;

  const rows = data.slice(-120);
  const lo = Math.min(...rows.map((d) => d.l));
  const hi = Math.max(...rows.map((d) => d.h));
  const range = hi - lo || 1;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const volumeMax = Math.max(...rows.map((d) => d.v), 1);
  const candleW = plotW / rows.length;
  const y = (value: number) => TOP + (1 - (value - lo) / range) * plotH;
  const active = hovered == null ? null : rows[hovered];
  const last = rows[rows.length - 1].c;
  const lastY = y(last);

  return (
    <div className={`relative overflow-hidden bg-void ${className}`}>
      {active && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 border border-edge bg-panel/95 px-3 py-2 font-mono text-[9px] text-dim shadow-lg">
          <span className="text-ink">{new Date(active.t).toLocaleString()}</span>
          <span className="ml-3">O {priceLabel(active.o)}</span>
          <span className="ml-2 text-up">H {priceLabel(active.h)}</span>
          <span className="ml-2 text-down">L {priceLabel(active.l)}</span>
          <span className="ml-2 text-ink">C {priceLabel(active.c)}</span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label="Live token candlestick chart"
        onPointerLeave={() => setHovered(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - box.left) / box.width) * W;
          const index = Math.floor((x - LEFT) / candleW);
          setHovered(index >= 0 && index < rows.length ? index : null);
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((part) => {
          const gridY = TOP + plotH * part;
          const value = hi - range * part;
          return (
            <g key={`h-${part}`}>
              <line x1={LEFT} x2={W - RIGHT} y1={gridY} y2={gridY} stroke="rgb(var(--edge-rgb))" strokeOpacity="0.72" strokeWidth="1" />
              <text x={W - RIGHT + 8} y={gridY + 3} fill="rgb(var(--dim-rgb))" fontSize="9" fontFamily="monospace">{priceLabel(value)}</text>
            </g>
          );
        })}
        {[0.2, 0.4, 0.6, 0.8].map((part) => (
          <line key={`v-${part}`} y1={TOP} y2={H - 8} x1={LEFT + plotW * part} x2={LEFT + plotW * part} stroke="rgb(var(--edge-rgb))" strokeOpacity="0.38" strokeWidth="1" />
        ))}
        {rows.map((d, index) => {
          const x = LEFT + index * candleW + candleW / 2;
          const up = d.c >= d.o;
          const color = up ? "rgb(var(--up-rgb))" : "rgb(var(--hotpink-rgb))";
          const bodyTop = y(Math.max(d.o, d.c));
          const bodyBottom = y(Math.min(d.o, d.c));
          const volumeHeight = Math.max(1, (d.v / volumeMax) * (BOTTOM - 18));
          return (
            <g key={`${d.t}-${index}`} opacity={hovered == null || hovered === index ? 1 : 0.72}>
              <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={color} strokeWidth="1" />
              <rect x={LEFT + index * candleW + candleW * 0.16} y={bodyTop} width={Math.max(1, candleW * 0.68)} height={Math.max(1.2, bodyBottom - bodyTop)} fill={color} />
              <rect x={LEFT + index * candleW + candleW * 0.16} y={H - 8 - volumeHeight} width={Math.max(1, candleW * 0.68)} height={volumeHeight} fill={color} opacity="0.28" />
            </g>
          );
        })}
        <line x1={LEFT} x2={W - RIGHT} y1={lastY} y2={lastY} stroke="rgb(var(--toxic-rgb))" strokeOpacity="0.85" strokeDasharray="4 4" strokeWidth="1" />
        <rect x={W - RIGHT + 3} y={lastY - 8} width={RIGHT - 6} height="16" fill="rgb(var(--toxic-rgb))" />
        <text x={W - RIGHT + 8} y={lastY + 3} fill="#17110c" fontSize="9" fontWeight="700" fontFamily="monospace">{priceLabel(last)}</text>
        {hovered != null && (
          <>
            <line x1={LEFT + hovered * candleW + candleW / 2} x2={LEFT + hovered * candleW + candleW / 2} y1={TOP} y2={H - 8} stroke="rgb(var(--ink-rgb))" strokeOpacity="0.35" strokeDasharray="3 3" />
            <line x1={LEFT} x2={W - RIGHT} y1={y(rows[hovered].c)} y2={y(rows[hovered].c)} stroke="rgb(var(--ink-rgb))" strokeOpacity="0.25" strokeDasharray="3 3" />
          </>
        )}
      </svg>
    </div>
  );
}
