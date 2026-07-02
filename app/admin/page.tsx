"use client";
import AppShell from "@/components/AppShell";
import { useEffect, useState } from "react";
import { getApplications, approveApplication, rejectApplication, type Application } from "@/lib/queries";

// demo fallback shown until real applications exist in the DB
const DEMO: Application[] = [
  { id: "d1", server_name: "Alpha Trenches", invite_link: "discord.gg/alphatrenches", owner_handle: "trencher#0001", member_count: "12,400", pitch: "3-month tracked record, 68% win rate on-chain.", status: "pending", created_at: "" },
  { id: "d2", server_name: "Rug Pullers United", invite_link: "discord.gg/rugpull", owner_handle: "sketchy#9999", member_count: "800", pitch: "trust me bro 100x every day", status: "pending", created_at: "" }
];

export default function Admin() {
  const [apps, setApps] = useState<Application[]>(DEMO);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const data = await getApplications();
    if (data.length) { setApps(data); setLive(true); }
  }
  useEffect(() => { load(); }, []);

  async function approve(a: Application) {
    setBusy(a.id);
    if (live) { await approveApplication(a); await load(); }
    else setApps((x) => x.map((y) => (y.id === a.id ? { ...y, status: "approved" } : y)));
    setBusy(null);
  }
  async function reject(a: Application) {
    setBusy(a.id);
    if (live) { await rejectApplication(a.id); await load(); }
    else setApps((x) => x.map((y) => (y.id === a.id ? { ...y, status: "rejected" } : y)));
    setBusy(null);
  }

  const pending = apps.filter((a) => a.status === "pending");
  const decided = apps.filter((a) => a.status !== "pending");

  return (
    <AppShell>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Admin · server approvals</h1>
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${live ? "border-toxic/50 text-toxic" : "border-edge text-dim"}`}>
          {live ? "● live from DB" : "○ demo data"}
        </span>
      </div>
      <p className="mt-1 text-sm text-dim">
        Approve a server → it publishes to the public Calls page and (in production) triggers the bot invite.
      </p>

      <div className="mt-6 flex gap-3 font-mono text-xs">
        <span className="rounded-md border border-edge bg-panel px-3 py-1.5">{pending.length} pending</span>
        <span className="rounded-md border border-edge bg-panel px-3 py-1.5 text-toxic">
          {apps.filter((a) => a.status === "approved").length} approved
        </span>
      </div>

      <h2 className="mt-8 text-lg font-bold">Pending</h2>
      <div className="mt-3 space-y-3">
        {pending.length === 0 && <p className="text-sm text-dim">All caught up.</p>}
        {pending.map((a) => (
          <div key={a.id} className="rounded-lg border border-edge bg-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-bold">{a.server_name}</h3>
                <p className="mt-0.5 font-mono text-xs text-dim">
                  {a.invite_link} · {a.owner_handle} · {a.member_count} members
                </p>
                {a.pitch && <p className="mt-2 max-w-xl text-sm text-dim">&ldquo;{a.pitch}&rdquo;</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => approve(a)} disabled={busy === a.id}
                  className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-void shadow-toxic disabled:opacity-50">
                  {busy === a.id ? "…" : "Approve"}
                </button>
                <button onClick={() => reject(a)} disabled={busy === a.id}
                  className="rounded-md border border-hotpink/60 px-4 py-2 text-sm font-bold text-hotpink hover:bg-hotpink/10 disabled:opacity-50">
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {decided.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-bold">Decided</h2>
          <div className="mt-3 divide-y divide-edge rounded-lg border border-edge bg-panel">
            {decided.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-bold">{a.server_name}</span>
                <span className={`font-mono text-xs ${a.status === "approved" ? "text-toxic" : "text-hotpink"}`}>{a.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
