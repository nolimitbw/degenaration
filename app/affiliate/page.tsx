"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, ServerCog } from "lucide-react";
import AppShell from "@/components/AppShell";
import { getCallSources, type CallSource } from "@/lib/queries";
import { useToast } from "@/components/Toast";

export default function AffiliatePage() {
  const [sources, setSources] = useState<CallSource[] | null>(null);
  const toast = useToast();

  useEffect(() => { getCallSources().then(setSources).catch(() => setSources([])); }, []);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/r/${code}`);
      toast("Referral link copied");
    } catch {
      toast("Could not copy referral link", "err");
    }
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-edge pb-5">
        <div><h1 className="text-2xl font-semibold">Affiliate</h1><p className="mt-1 text-sm text-dim">Referral links assigned to approved Discord servers.</p></div>
        <Link href="/apply" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-edge px-4 py-2 text-sm font-semibold text-ink transition hover:border-toxic"><ServerCog size={17} /> List your server</Link>
      </div>
      <div className="mt-6 grid gap-3">
        {!sources && <p className="py-10 text-center text-sm text-dim">Loading approved servers...</p>}
        {sources?.length === 0 && <div className="border border-edge bg-panel p-8 text-center"><p className="font-semibold">No approved affiliate links yet</p><p className="mt-2 text-sm text-dim">A link appears here after a Discord calls channel is registered and approved.</p></div>}
        {sources?.map((source) => (
          <div key={source.id} className="grid items-center gap-4 border border-edge bg-panel p-4 md:grid-cols-[1fr_auto_auto]">
            <div className="min-w-0"><p className="font-semibold text-ink">{source.name}</p><p className="mt-1 truncate font-mono text-[11px] text-dim">{source.referralCode ? `/r/${source.referralCode}` : "Referral assignment pending"}</p></div>
            {source.publicSlug && <Link href={`/source/${source.publicSlug}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-dim hover:text-ink">Profile <ExternalLink size={14} /></Link>}
            <button onClick={() => source.referralCode && copy(source.referralCode)} disabled={!source.referralCode} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-toxic px-4 text-xs font-semibold text-[#17110c] disabled:cursor-not-allowed disabled:opacity-40"><Copy size={14} /> Copy link</button>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
