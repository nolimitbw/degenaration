"use client";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export default function Candles({ data }: { data: Candle[] }) {
  if (data.length < 2) return <div className="grid h-72 place-items-center rounded-md border border-edge bg-void text-sm text-dim">Load a token to see live candles.</div>;
  const W = 600, H = 260, pad = 4;
  const lo = Math.min(...data.map((d) => d.l)), hi = Math.max(...data.map((d) => d.h));
  const range = hi - lo || 1;
  const cw = (W - pad * 2) / data.length;
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - pad * 2);
  return (
    <div className="h-72 rounded-md border border-edge bg-void p-1">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {data.map((d, i) => {
          const x = pad + i * cw + cw / 2;
          const up = d.c >= d.o;
          const col = up ? "#a3ff12" : "#ff2d78";
          const bt = y(Math.max(d.o, d.c)), bb = y(Math.min(d.o, d.c));
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={col} strokeWidth="1" />
              <rect x={pad + i * cw + cw * 0.15} y={bt} width={cw * 0.7} height={Math.max(1, bb - bt)} fill={col} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
