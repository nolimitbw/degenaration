import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import AppShell from "@/components/AppShell";
import { isMint } from "@/lib/server/guard";
import RiskReport from "./RiskReport";

type Props = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const mint = (await params).mint;
  return { title: isMint(mint) ? `Token risk ${mint.slice(0, 6)}` : "Invalid token" };
}

export default async function TokenRiskPage({ params }: Props) {
  const mint = (await params).mint;
  if (!isMint(mint)) notFound();
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-3">
          <ShieldCheck aria-hidden="true" className="text-toxic" />
          <div><h1 className="text-2xl font-bold">Token risk report</h1><p className="mt-1 break-all font-mono text-[11px] text-dim">{mint}</p></div>
        </div>
        <div className="mt-6"><RiskReport mint={mint} /></div>
      </div>
    </AppShell>
  );
}
