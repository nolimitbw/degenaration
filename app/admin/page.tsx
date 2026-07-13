"use client";
import AppShell from "@/components/AppShell";
import AdminGuard from "@/components/AdminGuard";
import { useEffect, useState } from "react";
import { type Application } from "@/lib/queries";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { adminFetchJson, emailFromPrivyUser, useIsAdmin } from "@/lib/admin";

type Summary = {
  commissionSol?: number | string;
  tradeCount?: number;
  pendingApplications?: number;
  pendingChannels?: number;
  approvedChannels?: number;
  feeWalletConfigured?: boolean;
  platformFeeBps?: number;
};
const ADMIN_HOME_UI_VERSION = "admin-home-v2";

export default function Admin() {
  const { getAccessToken, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { admin } = useIsAdmin();
  const email = emailFromPrivyUser(user);
  const waitingForOwnerToken = admin && !identityToken;
  const [apps, setApps] = useState<Application[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!admin) return;
    setErr(null);
    const [response, summaryResponse] = await Promise.all([
      adminFetchJson<{ applications?: Application[] }>("/api/admin/applications", getAccessToken, identityToken, email),
      adminFetchJson<{ summary?: Summary }>("/api/admin/summary", getAccessToken, identityToken, email)
    ]);
    if (!response.ok || !summaryResponse.ok) {
      setErr(!response.ok ? response.error : !summaryResponse.ok ? summaryResponse.error : null);
    }
    setApps(response.ok ? response.data.applications ?? [] : []);
    setSummary(summaryResponse.ok ? summaryResponse.data.summary ?? null : null);
    setLoaded(true);
  }
  useEffect(() => { if (admin) load(); }, [admin, email, identityToken]);

  async function approve(a: Application) {
    setBusy(a.id);
    try {
      const res = await adminFetchJson("/api/admin/applications", getAccessToken, identityToken, email, {
        method: "POST",
        body: JSON.stringify({ id: a.id, action: "approve" })
      });
      if (!res.ok) setErr(res.error);
      await load();
    } catch {}
    setBusy(null);
  }
  async function reject(a: Application) {
    setBusy(a.id);
    try {
      const res = await adminFetchJson("/api/admin/applications", getAccessToken, identityToken, email, {
        method: "POST",
        body: JSON.stringify({ id: a.id, action: "reject" })
      });
      if (!res.ok) setErr(res.error);
      await load();
    } catch {}
    setBusy(null);
  }

  const pending = apps.filter((a) => a.status === "pending");
  const decided = apps.filter((a) => a.status !== "pending");
  const commissionSol = Number(summary?.commissionSol || 0);

  return (
    <AdminGuard>
    <AppShell>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Owner dashboard</h1>
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${loaded ? "border-toxic/50 text-toxic" : "border-edge text-dim"}`}>
          {loaded ? "live from DB" : waitingForOwnerToken ? "checking owner" : "loading"}
        </span>
        <span className="rounded border border-toxic/40 bg-toxic/10 px-2 py-1 font-mono text-[10px] text-toxic">{ADMIN_HOME_UI_VERSION}</span>
      </div>
      <p className="mt-1 text-sm text-dim">
        Review call-group applications, approve registered Discord channels, and watch platform commissions from one place.
      </p>

      {err && <p className="mt-4 rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-xs text-hotpink">{err}</p>}
      {waitingForOwnerToken && (
        <p className="mt-4 rounded-md border border-edge bg-panel px-3 py-2 font-mono text-xs text-dim">
          Owner identity token is still settling; the dashboard is also trying the verified owner API session.
        </p>
      )}

      <div className="mt-6 grid gap-3 md:grid-cols-5">
        {[
          ["Pending apps", summary?.pendingApplications ?? pending.length],
          ["Pending channels", summary?.pendingChannels ?? 0],
          ["Approved channels", summary?.approvedChannels ?? 0],
          ["Commissions", `${commissionSol.toFixed(3)} SOL`],
          ["Trades", summary?.tradeCount ?? 0]
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-edge bg-panel p-4">
            <p className="text-[11px] uppercase text-dim">{label}</p>
            <p className="mt-2 font-mono text-xl font-bold text-ink">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={load} disabled={!admin || busy != null} className="rounded-md border border-edge px-4 py-2 text-sm font-bold text-ink hover:border-toxic disabled:opacity-50">Refresh</button>
        <a href="/admin/channels" className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic">Approve registered channels</a>
        <a href="/admin/commissions" className="rounded-md border border-edge px-4 py-2 text-sm font-bold text-ink hover:border-toxic">View commissions</a>
      </div>
      {loaded && summary?.feeWalletConfigured === false && (
        <p className="mt-4 rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-xs text-hotpink">
          Platform commissions are off because production has no PLATFORM_FEE_ACCOUNT configured.
        </p>
      )}

      <h2 className="mt-8 text-lg font-bold">Pending server applications</h2>
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
                  className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic disabled:opacity-50">
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
          <h2 className="mt-8 text-lg font-bold">Decided applications</h2>
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
    </AdminGuard>
  );
}
