"use client";
import AppShell from "@/components/AppShell";
import AdminGuard from "@/components/AdminGuard";
import { useCallback, useEffect, useState } from "react";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { adminFetchJson, emailFromPrivyUser, useIsAdmin } from "@/lib/admin";

type Channel = {
  id: string; guild_name: string | null; channel_name: string | null; channel_id: string;
  registered_by: string | null; guild_member_count: number | null; status: string; group_id: string | null; created_at: string;
};
type Summary = { pendingChannels?: number; approvedChannels?: number };
type ChannelsResponse = { channels?: Channel[]; source?: string; normalizedFrom?: string; rpcCount?: number; rpcError?: string };
type BotConfig = { clientId?: string; slashCommandConfigured?: boolean; registrationCommand?: string; registrationBridgeConfigured?: boolean; botBuild?: string };
const ADMIN_CHANNELS_UI_VERSION = "channels-admin-v4";

function withFreshQuery(path: string) {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}t=${Date.now()}`;
}

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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [bot, setBot] = useState<BotConfig | null>(null);

  const load = useCallback(async () => {
    if (!admin) {
      setLoaded(false);
      return;
    }
    if (!identityToken) {
      setErr(null);
      setLoaded(false);
      return;
    }
    setErr(null);
    const [res, summaryRes] = await Promise.all([
      adminFetchJson<ChannelsResponse>(withFreshQuery("/api/admin/channels"), getAccessToken, identityToken, email),
      adminFetchJson<{ summary?: Summary }>(withFreshQuery("/api/admin/summary"), getAccessToken, identityToken, email)
    ]);
    if (!res.ok) {
      setErr(res.error);
      setChannels([]);
      setSource(null);
      setLoaded(true);
      return;
    }
    setChannels(res.data?.channels ?? []);
    setSource([res.data?.source, res.data?.normalizedFrom && `payload:${res.data.normalizedFrom}`, res.data?.rpcError && "rpc fallback"].filter(Boolean).join(" · ") || null);
    setSummary(summaryRes.ok ? summaryRes.data.summary ?? null : null);
    if (!summaryRes.ok) setErr(summaryRes.error);
    setLoaded(true);
    setLastSync(new Date());
  }, [admin, email, getAccessToken, identityToken]);
  useEffect(() => {
    if (!admin) return;
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [admin, load]);
  useEffect(() => {
    fetch(withFreshQuery("/api/bot/config"), { cache: "no-store" }).then((r) => r.json()).then(setBot).catch(() => {});
  }, []);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    const res = await adminFetchJson("/api/admin/channels", getAccessToken, identityToken, email, {
      method: "POST",
      body: JSON.stringify({ id, action })
    });
    if (!res.ok) setErr(res.error || `${action} failed`);
    await load();
    setBusy(null);
  }

  const pending = channels.filter((c) => c.status === "pending");
  const decided = channels.filter((c) => c.status !== "pending");
  const newest = channels[0];
  const waitingForOwnerToken = admin && !identityToken;
  const expectedPending = Number(summary?.pendingChannels ?? pending.length);

  return (
    <AdminGuard>
    <AppShell>
      <h1 className="text-2xl font-bold">Admin · Discord call channels</h1>
      <p className="mt-1 text-sm text-dim">
        Server owners run <code className="rounded bg-void px-1 font-mono text-toxic">/register</code> in their call
        channel; approve one here and the bot relays its calls to the platform Discord and eligible subscribers.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-panel/70 p-3">
        <button
          onClick={() => load()}
          disabled={!admin}
          className="rounded-md border border-edge px-3 py-1.5 text-xs font-bold text-ink hover:border-toxic disabled:opacity-50"
        >
          Refresh
        </button>
        <span className={`font-mono text-[11px] ${loaded ? "text-toxic" : "text-dim"}`}>
          {waitingForOwnerToken ? "verifying owner session" : loaded ? `${channels.length} registered channel${channels.length === 1 ? "" : "s"}` : "loading owner data"}
        </span>
        <span className="rounded border border-toxic/40 bg-toxic/10 px-2 py-1 font-mono text-[10px] text-toxic">
          {ADMIN_CHANNELS_UI_VERSION}
        </span>
        <span className="font-mono text-[10px] text-dim">{source ? source : "owner api pending"}</span>
        {lastSync && <span className="font-mono text-[11px] text-dim">synced {lastSync.toLocaleTimeString()}</span>}
      </div>

      {err && <p className="mt-4 rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-xs text-hotpink">{err}</p>}

      <div className="mt-5 grid gap-3 rounded-lg border border-edge bg-panel p-4 font-mono text-[11px] text-dim md:grid-cols-4">
        <div><span className="text-ink">Bot app</span><br />{bot?.clientId ? `app ${bot.clientId}` : "loading"}</div>
        <div><span className="text-ink">Command</span><br />{bot?.slashCommandConfigured ? `${bot.registrationCommand || "/register"} ready` : "missing slash scope"}</div>
        <div><span className="text-ink">Register bridge</span><br />{bot?.registrationBridgeConfigured ? "online" : "not configured"}</div>
        <div><span className="text-ink">Expected bot build</span><br />{bot?.botBuild || "slash-register-v1"}</div>
      </div>
      {bot && (!bot.slashCommandConfigured || !bot.registrationBridgeConfigured) && (
        <p className="mt-3 rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-xs text-hotpink">
          Discord registration is not fully ready. The invite needs applications.commands and the website needs BOT_SHARED_SECRET before /register can submit channels.
        </p>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-edge bg-panel p-4">
          <p className="font-mono text-[10px] uppercase text-dim">Pending approval</p>
          <p className="mt-2 font-mono text-2xl font-bold text-toxic">{loaded ? expectedPending : "..."}</p>
        </div>
        <div className="rounded-lg border border-edge bg-panel p-4">
          <p className="font-mono text-[10px] uppercase text-dim">Total registrations</p>
          <p className="mt-2 font-mono text-2xl font-bold text-ink">{loaded ? channels.length : "..."}</p>
        </div>
        <div className="rounded-lg border border-edge bg-panel p-4">
          <p className="font-mono text-[10px] uppercase text-dim">Newest channel</p>
          <p className="mt-2 truncate font-mono text-sm font-bold text-ink">{newest ? `${newest.guild_name || "Discord server"} #${newest.channel_name || newest.channel_id}` : loaded ? "None" : "..."}</p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-bold">Pending</h2>
      <div className="mt-3 space-y-3">
        {!loaded && <p className="text-sm text-dim">{email ? "Loading registered channels..." : "Waiting for owner session..."}</p>}
        {waitingForOwnerToken && <p className="text-sm text-dim">Verifying the owner identity token before loading approvals...</p>}
        {loaded && expectedPending > pending.length && !err && (
          <p className="rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-xs text-hotpink">
            Database summary sees {expectedPending} pending channel{expectedPending === 1 ? "" : "s"}, but this page received {pending.length}. API source: {source || "unknown"}. Hard refresh this page, then press Refresh; if it stays here, the deployed admin API is not returning the channel list.
          </p>
        )}
        {loaded && !pending.length && !err && (
          <div className="rounded-lg border border-edge bg-panel p-5">
            <p className="font-bold text-ink">No pending rows reached this browser session.</p>
            <p className="mt-1 text-sm text-dim">
              If someone just ran /register, press Refresh. If this page does not show {ADMIN_CHANNELS_UI_VERSION},
              hard refresh the browser tab because it is still running an old admin bundle.
            </p>
            <p className="mt-3 font-mono text-[11px] text-dim">
              Bot command: {bot?.registrationCommand || "/register"} · bridge {bot?.registrationBridgeConfigured ? "online" : "not configured"} · source {source || "not loaded"}
            </p>
          </div>
        )}
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
