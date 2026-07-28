"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import {
  Activity,
  Bot,
  ClipboardList,
  History,
  RefreshCw,
  ServerCog,
  Settings2,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { adminFetchJson, emailFromPrivyUser, useIsAdmin } from "@/lib/admin";
import { LoadingRows, PageHeader } from "@/components/product/Primitives";
import OwnerSections from "@/components/admin/OwnerSections";
import type { AdminAction, AdminData, AdminTab } from "@/components/admin/types";

const EMPTY_DATA: AdminData = {
  summary: {},
  product: {},
  applications: [],
  channels: [],
  strategies: [],
  payouts: [],
  users: [],
  executions: [],
  scanner: {},
  flags: [],
  events: [],
  botConfig: {}
};

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "discord", label: "Discord", icon: ServerCog },
  { id: "kol", label: "KOL", icon: Bot },
  { id: "payouts", label: "Payouts", icon: WalletCards },
  { id: "operations", label: "Operations", icon: ClipboardList },
  { id: "users", label: "Users", icon: Users },
  { id: "system", label: "System", icon: Settings2 },
  { id: "audit", label: "Audit", icon: History }
] as const;

function mergeResponse(data: AdminData, path: string, payload: any): AdminData {
  if (path.includes("/summary")) return { ...data, summary: payload?.summary || {} };
  if (path.includes("/product")) return { ...data, product: payload || {} };
  if (path.includes("/applications")) return { ...data, applications: payload?.applications || [] };
  if (path.includes("/channels")) return { ...data, channels: payload?.channels || [] };
  if (path.includes("/kol-strategies")) return { ...data, strategies: payload?.strategies || [] };
  if (path.includes("/payouts")) return { ...data, payouts: payload?.payouts || [] };
  if (path.includes("/users")) return { ...data, users: payload?.users || [] };
  if (path.includes("/trades")) return { ...data, executions: payload?.executions || [] };
  if (path.includes("/scanner")) return { ...data, scanner: payload || {} };
  if (path.includes("/system")) return { ...data, flags: payload?.flags || [] };
  if (path.includes("/audit")) return { ...data, events: payload?.events || [] };
  if (path.includes("/api/bot/config")) return { ...data, botConfig: payload || {} };
  return data;
}

function ConfirmDialog({
  action,
  busy,
  onCancel,
  onConfirm
}: {
  action: AdminAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = !action.reasonRequired || reason.trim().length >= 3;
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/75 p-4" role="presentation" onMouseDown={onCancel}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-action-title"
        className="w-full max-w-lg rounded-md border border-edge bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-edge p-5">
          <div>
            <p className="font-mono text-[9px] uppercase text-toxic">Privileged action</p>
            <h2 id="admin-action-title" className="mt-2 text-base font-semibold text-ink">{action.title}</h2>
          </div>
          <button type="button" onClick={onCancel} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label="Close confirmation">
            <X size={16} />
          </button>
        </header>
        <div className="p-5">
          <p className="text-sm leading-6 text-dim">{action.description}</p>
          <label className="field-label mt-5 block" htmlFor="admin-reason">Reason</label>
          <textarea
            id="admin-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="field-control mt-2 min-h-24 w-full resize-y"
            placeholder="Record the operational reason for this decision"
            autoFocus
          />
          {action.destructive && (
            <p className="mt-3 rounded-md border border-down/35 bg-down/5 px-3 py-2 text-xs leading-5 text-down">
              This changes an active product state. Historical records remain preserved.
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-edge p-4">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-10 rounded-md border border-edge px-4 text-xs font-semibold text-dim hover:text-ink disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm || busy}
            className={`min-h-10 rounded-md px-4 text-xs font-semibold disabled:opacity-50 ${
              action.destructive ? "bg-down text-white" : "bg-toxic text-[#17110c]"
            }`}
          >
            {busy ? "Applying..." : "Confirm action"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function OwnerConsole() {
  const { getAccessToken, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { admin } = useIsAdmin();
  const email = emailFromPrivyUser(user);
  const [active, setActive] = useState<AdminTab>("overview");
  const [data, setData] = useState<AdminData>(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [pendingAction, setPendingAction] = useState<AdminAction | null>(null);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const paths = useMemo(() => [
    "/api/admin/summary",
    "/api/admin/product",
    "/api/admin/applications",
    "/api/admin/channels",
    "/api/admin/kol-strategies",
    "/api/admin/payouts",
    "/api/admin/users",
    "/api/admin/trades",
    "/api/admin/scanner",
    "/api/admin/system",
    "/api/admin/audit"
  ], []);

  const load = useCallback(async () => {
    if (!admin) return;
    setRefreshing(true);
    const requests = paths.map(async (path) => ({
      path,
      result: await adminFetchJson<any>(`${path}?t=${Date.now()}`, getAccessToken, identityToken, email)
    }));
    const [responses, botConfig] = await Promise.all([
      Promise.all(requests),
      fetch(`/api/bot/config?t=${Date.now()}`, { cache: "no-store" }).then((response) => response.json()).catch(() => ({}))
    ]);

    let next = { ...EMPTY_DATA };
    const failures: string[] = [];
    for (const { path, result } of responses) {
      if (result.ok) next = mergeResponse(next, path, result.data);
      else failures.push(`${path.split("/").pop()}: ${result.error}`);
    }
    next = mergeResponse(next, "/api/bot/config", botConfig);
    setData(next);
    setErrors(Array.from(new Set(failures)));
    setLoaded(true);
    setRefreshing(false);
    setLastSync(new Date());
  }, [admin, email, getAccessToken, identityToken, paths]);

  useEffect(() => {
    if (admin && identityToken) load();
  }, [admin, identityToken, load]);

  async function confirmAction(reason: string) {
    if (!pendingAction) return;
    setActing(true);
    setNotice(null);
    const body = { ...pendingAction.body, reason };
    const result = await adminFetchJson<any>(
      pendingAction.endpoint,
      getAccessToken,
      identityToken,
      email,
      {
        method: pendingAction.method || "POST",
        body: JSON.stringify(body)
      }
    );
    if (!result.ok) {
      setErrors([result.error]);
      setActing(false);
      return;
    }
    setPendingAction(null);
    setActing(false);
    setNotice(`${pendingAction.title} completed.`);
    await load();
  }

  return (
    <>
      <PageHeader
        eyebrow="Verified owner workspace"
        title="Operations console"
        description="Review Discord sources, moderate KOL strategies, reconcile creator payouts, inspect scanner and execution health, and control audited feature gates."
        actions={
          <button
            type="button"
            onClick={load}
            disabled={refreshing || !identityToken}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-dim transition hover:border-toxic/50 hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-dim">
        <span>{email || "Owner identity"} · signed Google identity required</span>
        <span>{lastSync ? `Last synced ${lastSync.toLocaleTimeString()}` : identityToken ? "Waiting for owner data" : "Waiting for signed identity token"}</span>
      </div>

      {!identityToken && (
        <div className="mt-5 rounded-md border border-toxic/35 bg-toxic/5 px-4 py-3 text-xs leading-5 text-toxic">
          Privy has not supplied the signed owner identity token yet. Sign out and use Continue with Google if this state does not clear.
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-5 rounded-md border border-down/35 bg-down/5 px-4 py-3">
          <p className="text-xs font-semibold text-down">Some owner data could not be loaded</p>
          {errors.map((error) => <p key={error} className="mt-1 font-mono text-[10px] text-down">{error}</p>)}
        </div>
      )}
      {notice && <p className="mt-5 rounded-md border border-up/35 bg-up/5 px-4 py-3 text-xs text-up">{notice}</p>}

      <nav className="mt-6 flex max-w-full gap-1 overflow-x-auto border-b border-edge" aria-label="Owner console sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={`relative flex min-h-11 shrink-0 items-center gap-2 px-3 text-xs font-medium transition ${
              active === id ? "text-ink" : "text-dim hover:text-ink"
            }`}
          >
            <Icon size={14} className={active === id ? "text-toxic" : ""} />
            {label}
            {active === id && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-toxic" />}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {loaded ? <OwnerSections active={active} data={data} act={setPendingAction} /> : <LoadingRows count={4} />}
      </div>

      {pendingAction && (
        <ConfirmDialog
          key={`${pendingAction.endpoint}-${JSON.stringify(pendingAction.body)}`}
          action={pendingAction}
          busy={acting}
          onCancel={() => !acting && setPendingAction(null)}
          onConfirm={confirmAction}
        />
      )}
    </>
  );
}
