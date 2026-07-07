"use client";
import AppShell from "@/components/AppShell";
import { useEffect, useState } from "react";

type Alert = { id: string; mint: string; label: string; kind: "above" | "below"; target: number; fired?: boolean };

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [mint, setMint] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"above" | "below">("above");
  const [target, setTarget] = useState(0);

  useEffect(() => {
    const s = typeof window !== "undefined" ? localStorage.getItem("degen_alerts") : null;
    setAlerts(s ? JSON.parse(s) : []);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("degen_alerts", JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    const check = async () => {
      if (!alerts.length) return;
      const res = await fetch("/api/checkalerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alerts }) }).then(r => r.json()).catch(() => null);
      if (res?.triggered?.length) {
        setAlerts(a => a.map(x => res.triggered.includes(x.id) ? { ...x, fired: true } : x));
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          res.triggered.forEach((id: string) => {
            const al = alerts.find(x => x.id === id);
            if (al) new Notification("Degenaration alert", { body: `${al.label} is ${al.kind} $${al.target}` });
          });
        }
      }
    };
    const iv = setInterval(check, 20000); check();
    return () => clearInterval(iv);
  }, [alerts]);

  const add = () => {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || target <= 0) return;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
    setAlerts(a => [...a, { id: crypto.randomUUID(), mint, label: label || mint.slice(0, 6), kind, target }]);
    setMint(""); setLabel(""); setTarget(0);
  };

  return (
    <AppShell>
      <h1 className="text-2xl font-bold">Price alerts <span className="font-mono text-xs text-toxic">live</span></h1>
      <p className="mt-1 text-sm text-dim">Get a browser notification when a token crosses your target. Checked live every 20s.</p>

      <div className="mt-5 flex flex-wrap gap-2">
        <input value={mint} onChange={e => setMint(e.target.value)} placeholder="Token mint" className="flex-1 min-w-[200px] rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" className="w-28 rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <select value={kind} onChange={e => setKind(e.target.value as any)} className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs">
          <option value="above">above</option><option value="below">below</option>
        </select>
        <input type="number" step="any" value={target || ""} onChange={e => setTarget(+e.target.value)} placeholder="$ price" className="w-28 rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <button onClick={add} className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic">+ Alert</button>
      </div>

      <div className="mt-6 space-y-2">
        {!alerts.length && <p className="text-sm text-dim">No alerts yet.</p>}
        {alerts.map(a => (
          <div key={a.id} className={`flex items-center justify-between rounded-lg border p-4 ${a.fired ? "border-toxic/60 bg-toxic/5" : "border-edge bg-panel"}`}>
            <div>
              <p className="font-bold">{a.label} <span className="font-mono text-xs text-dim">{a.kind} ${a.target}</span></p>
              <p className="font-mono text-[11px] text-dim">{a.mint.slice(0, 12)}…</p>
            </div>
            <div className="flex items-center gap-3">
              {a.fired && <span className="rounded border border-toxic/50 px-2 py-0.5 font-mono text-[11px] text-toxic">TRIGGERED</span>}
              <button onClick={() => setAlerts(x => x.filter(y => y.id !== a.id))} className="font-mono text-[11px] text-hotpink hover:underline">remove</button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
