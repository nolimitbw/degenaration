"use client";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export default function Candles({ data, className = "h-72 rounded-md border border-edge" }: { data: Candle[]; className?: string }) {
  if (data.length < 2) return <div className={`grid place-items-center bg-void text-sm text-dim ${className}`}>Live candles are unavailable.</div>;
  const W = 600, H = 260, pad = 4;
  const lo = Math.min(...data.map((d) => d.l)), hi = Math.max(...data.map((d) => d.h));
  const range = hi - lo || 1;
  const cw = (W - pad * 2) / data.length;
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - pad * 2);
  const last = data[data.length - 1].c;
  return (
    <div className={`overflow-hidden bg-void p-1 ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {[0.2, 0.4, 0.6, 0.8].map((part) => (
          <line key={part} x1="0" x2={W} y1={H * part} y2={H * part} stroke="rgb(var(--edge-rgb))" strokeOpacity="0.72" strokeWidth="1" />
        ))}
        {[0.2, 0.4, 0.6, 0.8].map((part) => (
          <line key={part} y1="0" y2={H} x1={W * part} x2={W * part} stroke="rgb(var(--edge-rgb))" strokeOpacity="0.45" strokeWidth="1" />
        ))}
        {data.map((d, i) => {
          const x = pad + i * cw + cw / 2;
          const up = d.c >= d.o;
          const col = up ? "rgb(var(--up-rgb))" : "rgb(var(--hotpink-rgb))";
          const bt = y(Math.max(d.o, d.c)), bb = y(Math.min(d.o, d.c));
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={col} strokeWidth="1" />
              <rect x={pad + i * cw + cw * 0.15} y={bt} width={cw * 0.7} height={Math.max(1, bb - bt)} fill={col} />
            </g>
          );
        })}
        <line x1="0" x2={W} y1={y(last)} y2={y(last)} stroke="rgb(var(--toxic-rgb))" strokeOpacity="0.75" strokeDasharray="4 4" strokeWidth="1" />
      </svg>
    </div>
  );
}
