"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import {
  Activity,
  Bot,
  ClipboardList,
  Coins,
  History,
  Link2,
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
import ClientLedger from "@/components/admin/ClientLedger";
import RevenuePanel from "@/components/admin/RevenuePanel";
import type { AdminAction, AdminData, AdminTab } from "@/components/admin/types";

const EMPTY_DATA: AdminData = {
  summary: {},
  product: {},
  applications: [],
  channels: [],
  strategies: [],
  referrals: [],
  payouts: [],
  users: [],
  executions: [],
  scanner: {},
  flags: [],
  events: [],
  discordOwnership: { sources: [], sessions: [], events: [] },
  botConfig: {}
};

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "discord", label: "Discord", icon: ServerCog },
  { id: "kol", label: "KOL", icon: Bot },
  { id: "referrals", label: "Referrals", icon: Link2 },
  { id: "clients", label: "Clients", icon: Users },
  { id: "revenue", label: "Revenue", icon: Coins },
  { id: "payouts", label: "Payouts", icon: WalletCards },
  { id: "operations", label: "Operations", icon: ClipboardList },
  { id: "users", label: "Users", icon: Users },
  { id: "system", label: "System", icon: Settings2 },
  { id: "audit", label: "Audit", icon: History }
] as const;

function mergeResponse(data: AdminData, path: string, payload: any): AdminData {
  if (path.includes("/sources/ownership")) return { ...data, discordOwnership: { sources: payload?.sources || [], sessions: payload?.sessions || [], events: payload?.events || [] } };
  if (path.includes("/summary")) return { ...data, summary: payload?.summary || {} };
  if (path.includes("/product")) return { ...data, product: payload || {} };
  if (path.includes("/applications")) return { ...data, applications: payload?.applications || [] };
  if (path.includes("/channels")) return { ...data, channels: payload?.channels || [] };
  if (path.includes("/kol-strategies")) return { ...data, strategies: payload?.strategies || [] };
  if (path.includes("/referrals")) return { ...data, referrals: payload?.attributions || [] };
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
  onConfirm: (reason: string, inputValue: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [inputValue, setInputValue] = useState("");
  const inputMatches = !action.input?.pattern || new RegExp(action.input.pattern).test(inputValue.trim());
  const inputReady = !action.input?.required || (inputValue.trim().length > 0 && inputMatches);
  const canConfirm = (!action.reasonRequired || reason.trim().length >= 3) && inputReady;
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
            <p className="ui-label text-gold-400">Privileged action</p>
            <h2 id="admin-action-title" className="mt-2 t-section font-semibold text-ink">{action.title}</h2>
          </div>
          <button type="button" onClick={onCancel} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim hover:text-ink" aria-label="Close confirmation">
            <X size={16} />
          </button>
        </header>
        <div className="p-5">
          <p className="t-body leading-6 text-dim">{action.description}</p>
          <label className="field-label mt-5 block" htmlFor="admin-reason">Reason</label>
          <textarea
            id="admin-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="field-control mt-2 min-h-24 w-full resize-y"
            placeholder="Record the operational reason for this decision"
            autoFocus
          />
          {action.input && (
            <>
              <label className="field-label mt-5 block" htmlFor="admin-action-input">{action.input.label}</label>
              <input
                id="admin-action-input"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                className="field-control mt-2 w-full font-mono"
                placeholder={action.input.placeholder}
                required={action.input.required}
              />
              {!inputMatches && inputValue.trim() && <p className="mt-2 t-label text-down">Enter a valid value.</p>}
            </>
          )}
          {action.destructive && (
            <p className="mt-3 rounded-md border border-down/35 bg-down/5 px-3 py-2 t-label leading-5 text-down">
              This changes an active product state. Historical records remain preserved.
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-edge p-4">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 sm:min-h-10 rounded-md border border-edge px-4 t-label font-semibold text-dim hover:text-ink disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim(), inputValue.trim())}
            disabled={!canConfirm || busy}
            className={`min-h-11 sm:min-h-10 rounded-md px-4 t-label font-semibold disabled:opacity-50 ${
              action.destructive ? "bg-down text-white" : "bg-gold-400 text-[#17110c]"
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
    "/api/admin/sources/ownership",
    "/api/admin/kol-strategies",
    "/api/admin/referrals",
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

  // The client ledger and the performance refresh both go through the same signed owner
  // identity as every other admin call; they differ only in throwing rather than returning a
  // result envelope, because the ledger renders its own error and retry states.
  const fetchJson = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const result = await adminFetchJson<T>(path, getAccessToken, identityToken, email, init);
    if (!result.ok) throw new Error(result.error);
    return result.data as T;
  }, [email, getAccessToken, identityToken]);

  const refreshPerformance = useCallback(async (): Promise<number> => {
    const result = await adminFetchJson<{ snapshotsRefreshed?: number }>(
      "/api/admin/performance",
      getAccessToken,
      identityToken,
      email,
      { method: "POST", body: "{}" }
    );
    if (!result.ok) throw new Error(result.error);
    return result.data?.snapshotsRefreshed ?? 0;
  }, [email, getAccessToken, identityToken]);

  async function confirmAction(reason: string, inputValue: string) {
    if (!pendingAction) return;
    setActing(true);
    setNotice(null);
    const body = {
      ...pendingAction.body,
      reason,
      ...(pendingAction.input ? { [pendingAction.input.key]: inputValue } : {})
    };
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
            className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge px-3 t-label font-semibold text-dim transition hover:border-gold-400/50 hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 t-label text-dim">
        <span>{email || "Owner identity"} · signed Google identity required</span>
        <span>{lastSync ? `Last synced ${lastSync.toLocaleTimeString()}` : identityToken ? "Waiting for owner data" : "Waiting for signed identity token"}</span>
      </div>

      {!identityToken && (
        <div className="mt-5 rounded-md border border-gold-400/35 bg-gold-400/5 px-4 py-3 t-label leading-5 text-gold-400">
          Privy has not supplied the signed owner identity token yet. Sign out and use Continue with Google if this state does not clear.
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-5 rounded-md border border-down/35 bg-down/5 px-4 py-3">
          <p className="t-label font-semibold text-down">Some owner data could not be loaded</p>
          {errors.map((error) => <p key={error} className="mt-1 t-label text-down">{error}</p>)}
        </div>
      )}
      {notice && <p className="mt-5 rounded-md border border-up/35 bg-up/5 px-4 py-3 t-label text-up">{notice}</p>}

      <nav className="mt-6 flex max-w-full gap-1 overflow-x-auto border-b border-edge" aria-label="Owner console sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={`relative flex min-h-11 shrink-0 items-center gap-2 px-3 t-label font-medium transition ${
              active === id ? "text-ink" : "text-dim hover:text-ink"
            }`}
          >
            <Icon size={14} className={active === id ? "text-gold-400" : ""} />
            {label}
            {active === id && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-gold-400" />}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {active === "clients" ? (
          // The client ledger loads its own data: it is the only section backed by a
          // different pair of RPCs, and folding it into the twelve-request bulk load would
          // make every other tab wait for it.
          <ClientLedger fetchJson={fetchJson} refreshPerformance={refreshPerformance} />
        ) : active === "revenue" ? (
          // Same reason, plus one of its own: revenue carries the allocation-drift verdict,
          // and a caller only wanting the client table should not have to fetch it.
          <RevenuePanel fetchJson={fetchJson} feeAccount={(data.summary as any)?.feeAccount} />
        ) : loaded ? (
          <OwnerSections active={active} data={data} act={setPendingAction} fetchJson={fetchJson} />
        ) : (
          <LoadingRows count={4} />
        )}
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
