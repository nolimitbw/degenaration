"use client";
import AppShell from "@/components/AppShell";
import AdminGuard from "@/components/AdminGuard";
import { useCallback, useEffect, useState } from "react";
import { getAdminKey } from "@/lib/admin";

type Channel = {
  id: string; guild_name: string | null; channel_name: string | null; channel_id: string;
  registered_by: string | null; status: string; group_id: string | null; created_at: string;
};

export default function AdminChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const res = await fetch("/api/admin/channels", { headers: { "x-admin-key": getAdminKey() } })
      .then((r) => r.json()).catch(() => ({ error: "request failed" }));
    if (res.error) { setErr(res.error === "unauthorized" ? "Set NEXT_PUBLIC_ADMIN_KEY + ADMIN_KEY to the same value, then re-unlock." : res.error); setLoaded(true); return; }
    setChannels(res.channels ?? []); setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    await fetch("/api/admin/channels", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": getAdminKey() },
      body: JSON.stringify({ id, action })
    }).catch(() => {});
    await load();
    setBusy(null);
  }

  const pending = channels.filter((c) => c.status === "pending");
  const decided = channels.filter((c) => c.status !== "pending");

  return (
    <AdminGuard>
    <AppShell>
      <h1 className="text-2xl font-bold">Admin · Discord call channels</h1>
      <p className="mt-1 text-sm text-dim">
        Server owners run <code className="rounded bg-void px-1 font-mono text-toxic">!register</code> in their call
        channel; approve one here and the bot starts forwarding its calls into autotrading.
      </p>

      {err && <p className="mt-4 rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-xs text-hotpink">{err}</p>}

      <h2 className="mt-8 text-lg font-bold">Pending</h2>
      <div className="mt-3 space-y-3">
        {loaded && !pending.length && <p className="text-sm text-dim">No channels waiting for approval.</p>}
        {pending.map((c) => (
          <div key={c.id} className="rounded-lg border border-edge bg-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-bold">{c.guild_name || "Discord server"} <span className="font-mono text-xs text-dim">#{c.channel_name}</span></h3>
                <p className="mt-0.5 font-mono text-[11px] text-dim">channel {c.channel_id} · registered by {c.registered_by ?? "—"}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => act(c.id, "approve")} disabled={busy === c.id}
                  className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-void shadow-toxic disabled:opacity-50">{busy === c.id ? "…" : "Approve"}</button>
                <button onClick={() => act(c.id, "reject")} disabled={busy === c.id}
                  className="rounded-md border border-hotpink/60 px-4 py-2 text-sm font-bold text-hotpink hover:bg-hotpink/10 disabled:opacity-50">Reject</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {decided.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-bold">Decided</h2>
          <div className="mt-3 divide-y divide-edge rounded-lg border border-edge bg-panel">
            {decided.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-bold">{c.guild_name || "Discord server"} <span className="font-mono text-xs text-dim">#{c.channel_name}</span></span>
                <span className={`font-mono text-xs ${c.status === "approved" ? "text-toxic" : "text-hotpink"}`}>{c.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
    </AdminGuard>
  );
}
