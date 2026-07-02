"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function Search() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const t = useRef<any>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (q.length < 2) { setRes([]); return; }
    t.current = setTimeout(async () => {
      const d = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => null);
      setRes(d?.results ?? []); setOpen(true);
    }, 250);
  }, [q]);
  const go = (addr: string) => { setOpen(false); setQ(""); router.push(`/terminal?mint=${addr}`); };
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => res.length && setOpen(true)}
        placeholder="Search token / address…"
        className="w-44 rounded-md border border-edge bg-void px-3 py-1.5 font-mono text-xs outline-none focus:border-toxic sm:w-64" />
      {open && res.length > 0 && (
        <div className="absolute right-0 z-50 mt-1 max-h-80 w-72 overflow-auto rounded-md border border-edge bg-panel shadow-toxic">
          {res.map((r) => (
            <button key={r.address} onClick={() => go(r.address)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-edge/40">
              {r.image ? <img src={r.image} alt="" className="h-6 w-6 rounded-full" /> : <div className="h-6 w-6 rounded-full bg-edge" />}
              <div className="min-w-0"><p className="font-mono text-xs font-bold">{r.symbol}</p><p className="truncate font-mono text-[10px] text-dim">{r.name}</p></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
