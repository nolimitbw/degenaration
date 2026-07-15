"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Report = {
  mint: string;
  ok: boolean;
  reasons: string[];
  liquidityUsd: number | null;
  pairUrl: string | null;
  riskScore: number | null;
  authoritiesVerified: boolean;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  providerRisks: Array<{ name: string; level: string; description: string | null }>;
};

export default function RiskReport({ mint }: { mint: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/rugcheck?mint=${encodeURIComponent(mint)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Risk check failed");
        setReport(data);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Risk check failed"));
  }, [mint]);

  if (error) return <State title="Report unavailable" detail={error} tone="warn" />;
  if (!report) return <State title="Running live checks" detail="Checking liquidity, Rugcheck signals, and Solana mint authorities." tone="loading" />;

  return (
    <div className="space-y-6">
      <div className={`rounded-md border p-5 ${report.ok ? "border-up/35 bg-up/5" : "border-hotpink/35 bg-hotpink/5"}`}>
        <div className="flex items-start gap-3">
          {report.ok ? <CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-up" /> : <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0 text-hotpink" />}
          <div>
            <h2 className="font-bold">{report.ok ? "No blocking signal found" : "Risk gate blocked"}</h2>
            <p className="mt-1 text-sm leading-6 text-dim">
              {report.ok ? "The token passed the checks currently required by Degenaration." : "One or more live checks failed. Automated buys remain blocked."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2 lg:grid-cols-4">
        <Check label="Liquidity" value={report.liquidityUsd == null ? "Unavailable" : `$${Math.round(report.liquidityUsd).toLocaleString()}`} pass={report.liquidityUsd != null && report.liquidityUsd >= 10_000} />
        <Check label="Risk score" value={report.riskScore == null ? "Unavailable" : `${report.riskScore}/100`} pass={report.riskScore != null && report.riskScore <= 60} />
        <Check label="Mint authority" value={report.mintAuthorityRevoked == null ? "Unverified" : report.mintAuthorityRevoked ? "Revoked" : "Active"} pass={report.mintAuthorityRevoked === true} />
        <Check label="Freeze authority" value={report.freezeAuthorityRevoked == null ? "Unverified" : report.freezeAuthorityRevoked ? "Revoked" : "Active"} pass={report.freezeAuthorityRevoked === true} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-bold">Blocking reasons</h2>
          <div className="mt-3 rounded-md border border-edge bg-panel">
            {report.reasons.length ? report.reasons.map((reason) => (
              <div key={reason} className="flex items-start gap-2 border-b border-edge px-4 py-3 text-sm last:border-b-0">
                <AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-hotpink" /> {reason}
              </div>
            )) : <p className="px-4 py-5 text-sm text-dim">No blocking reasons were returned.</p>}
          </div>
        </section>
        <section>
          <h2 className="text-sm font-bold">Provider signals</h2>
          <div className="mt-3 rounded-md border border-edge bg-panel">
            {report.providerRisks.length ? report.providerRisks.slice(0, 8).map((risk, index) => (
              <div key={`${risk.name}-${index}`} className="border-b border-edge px-4 py-3 last:border-b-0">
                <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{risk.name}</p><span className="font-mono text-[10px] uppercase text-dim">{risk.level}</span></div>
                {risk.description && <p className="mt-1 text-xs leading-5 text-dim">{risk.description}</p>}
              </div>
            )) : <p className="px-4 py-5 text-sm text-dim">No additional provider warnings were returned.</p>}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/terminal?mint=${mint}`} className="inline-flex min-h-11 items-center rounded-md bg-toxic px-4 text-sm font-semibold text-[#031018]">Open terminal</Link>
        {report.pairUrl && <a href={report.pairUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold hover:border-toxic/60">Open market <ExternalLink aria-hidden="true" size={15} /></a>}
      </div>
      <p className="font-mono text-[10px] leading-5 text-dim">A passing report is not a guarantee of safety or future performance. Checks are live and can change between requests.</p>
    </div>
  );
}

function Check({ label, value, pass }: { label: string; value: string; pass: boolean }) {
  return <div className="bg-panel p-4 sm:border-r sm:border-edge sm:last:border-r-0"><p className="font-mono text-[10px] uppercase text-dim">{label}</p><p className={`mt-2 text-lg font-bold ${pass ? "text-up" : "text-hotpink"}`}>{value}</p></div>;
}

function State({ title, detail, tone }: { title: string; detail: string; tone: "warn" | "loading" }) {
  return <div className="flex min-h-56 items-center justify-center rounded-md border border-edge bg-panel/40 p-6 text-center"><div>{tone === "loading" ? <LoaderCircle aria-hidden="true" className="mx-auto animate-spin text-toxic" /> : <AlertTriangle aria-hidden="true" className="mx-auto text-hotpink" />}<p className="mt-3 font-bold">{title}</p><p className="mt-1 text-sm text-dim">{detail}</p></div></div>;
}
