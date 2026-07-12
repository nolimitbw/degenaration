"use client";
import AppShell from "@/components/AppShell";
import AdminGuard from "@/components/AdminGuard";
import { useCallback, useEffect, useState } from "react";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { adminHeaders, emailFromPrivyUser, useIsAdmin } from "@/lib/admin";

type Channel = {
  id: string; guild_name: string | null; channel_name: string | null; channel_id: string;
  registered_by: string | null; guild_member_count: number | null; status: string; group_id: string | null; created_at: string;
};

export default function AdminChannels() {
  const { getAccessToken, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { admin } = useIsAdmin();
  const email = emailFromPrivyUser(user);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!admin) {
      setLoaded(false);
      return;
    }
    setErr(null);
    const res = await fetch("/api/admin/channels", { cache: "no-store", headers: await adminHeaders(getAccessToken, identityToken, email) })
      .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) }))
      .catch(() => ({ ok: false, status: 0, data: { error: "request failed" } }));
    if (!res.ok || res.data?.error) {
      const reason = res.data?.error || `request failed (${res.status})`;
      setErr(reason === "forbidden" ? "Owner API rejected this session. Sign out and use the owner Google account." : reason);
      setChannels([]);
      setLoaded(true);
      return;
    }
    setChannels(res.data?.channels ?? []);
    setLoaded(true);
    setLastSync(new Date());
  }, [admin, email, getAccessToken, identityToken]);
  useEffect(() => {
    if (!admin) return;
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [admin, load]);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    const res = await fetch("/api/admin/channels", {
      method: "POST",
      headers: await adminHeaders(getAccessToken, identityToken, email),
      body: JSON.stringify({ id, action })
    }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
      .catch(() => ({ ok: false, data: { error: "request failed" } }));
    if (!res.ok || res.data?.error) setErr(res.data?.error || `${action} failed`);
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
        Server owners run <code className="rounded bg-void px-1 font-mono text-toxic">/register</code> in their call
        channel; approve one here and the bot relays its calls to the platform Discord and eligible subscribers.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => load()}
          className="rounded-md border border-edge px-3 py-1.5 text-xs font-bold text-ink hover:border-toxic"
        >
          Refresh
        </button>
        <span className={`font-mono text-[11px] ${loaded ? "text-toxic" : "text-dim"}`}>
          {loaded ? `${channels.length} registered channel${channels.length === 1 ? "" : "s"}` : "loading owner data"}
        </span>
        {lastSync && <span className="font-mono text-[11px] text-dim">synced {lastSync.toLocaleTimeString()}</span>}
      </div>

      {err && <p className="mt-4 rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-xs text-hotpink">{err}</p>}

      <h2 className="mt-8 text-lg font-bold">Pending</h2>
      <div className="mt-3 space-y-3">
        {!loaded && <p className="text-sm text-dim">{email ? "Loading registered channels..." : "Waiting for owner session..."}</p>}
        {loaded && !pending.length && !err && <p className="text-sm text-dim">No channels waiting for approval.</p>}
        {pending.map((c) => (
          <div key={c.id} className="rounded-lg border border-edge bg-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-bold">{c.guild_name || "Discord server"} <span className="font-mono text-xs text-dim">#{c.channel_name}</span></h3>
                <p className="mt-0.5 font-mono text-[11px] text-dim">channel {c.channel_id} · {c.guild_member_count ?? "—"} members · registered by {c.registered_by ?? "—"}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => act(c.id, "approve")} disabled={busy === c.id}
                  className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic disabled:opacity-50">{busy === c.id ? "…" : "Approve"}</button>
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
