"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import {
  ArrowRight,
  Bot,
  ChartNoAxesCombined,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  Users
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { Metric, PageHeader, ProductTabs, StatusPill } from "@/components/product/Primitives";
import DiscordSignalIcon from "@/components/icons/DiscordSignalIcon";
import KolStrategyIcon from "@/components/icons/KolStrategyIcon";
import DegenBotIcon from "@/components/icons/DegenBotIcon";
import RiskShieldIcon from "@/components/icons/RiskShieldIcon";
import { productFetch, type ProductBot } from "@/lib/product-api";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

export default function BotsPage() {
  const { authenticated, getAccessToken } = usePrivy();
  const [bots, setBots] = useState<ProductBot[]>([]);
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [strategyCount, setStrategyCount] = useState<number | null>(null);

  useEffect(() => {
    productFetch<{ sources: unknown[] }>("/api/product/marketplace/discord")
      .then((data) => setSourceCount(data.sources?.length || 0))
      .catch(() => setSourceCount(0));
    productFetch<{ strategies: unknown[] }>("/api/product/marketplace/kol")
      .then((data) => setStrategyCount(data.strategies?.length || 0))
      .catch(() => setStrategyCount(0));
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setBots([]);
      return;
    }
    productFetch<{ bots: ProductBot[] }>("/api/product/bots", { getAccessToken })
      .then((data) => setBots(data.bots || []))
      .catch(() => setBots([]));
  }, [authenticated, getAccessToken]);

  const active = bots.filter((bot) => bot.status === "active").length;

  return (
    <AppShell>
      <PageHeader
        title="Bots"
        description="Automate approved Discord calls or run a community strategy."
        actions={
          <Link href="/bots/manage" className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink transition hover:border-gold-400/60">
            <DegenBotIcon size={16} />
            Manage bots
          </Link>
        }
      />
      <ProductTabs items={TABS} active="/bots" />

      <section className="mt-6 grid gap-4 xl:grid-cols-2" aria-label="Bot products">
        <article className="group overflow-hidden rounded-md border border-edge bg-panel">
          <div className="flex min-h-52 flex-col justify-between border-b border-edge p-6">
            <div className="flex items-start justify-between gap-4">
              <span className="grid h-11 w-11 place-items-center rounded-md border border-gold-400/35 bg-gold-400/10 text-gold-400">
                <DiscordSignalIcon size={21} />
              </span>
              <StatusPill status="verified sources" />
            </div>
            <div className="mt-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gold-400">Discord Bot</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Copy approved call channels with your own risk and exit rules.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-dim">
                Choose an approved server, set exposure, retries, TP/SL, and fail-closed security filters. Source commission is itemized at 0.7%.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-edge py-4">
            <Metric label="Approved sources" value={sourceCount ?? "--"} />
            <Metric label="Creator fee" value="0.70%" />
            <Metric label="Automation" value="Not yet available" detail="Manual trading is live" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-6 py-4">
            <span className="inline-flex items-center gap-2 text-xs text-dim"><RiskShieldIcon size={15} className="text-up" /> Approved channels only</span>
            <Link href="/bots/discord" className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c]">
              Browse sources <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </article>

        <article className="group overflow-hidden rounded-md border border-edge bg-panel">
          <div className="flex min-h-52 flex-col justify-between border-b border-edge p-6">
            <div className="flex items-start justify-between gap-4">
              <span className="grid h-11 w-11 place-items-center rounded-md border border-up/30 bg-up/5 text-up">
                <KolStrategyIcon size={21} />
              </span>
              <StatusPill status="creator strategy" />
            </div>
            <div className="mt-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-up">KOL Bot</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Discover community strategies or publish one of your own.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-dim">
                Configure volatility triggers, DCA, execution limits, scanner presets, and advanced token filters. Publish up to three reviewed strategies.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-edge py-4">
            <Metric label="Live strategies" value={strategyCount ?? "--"} />
            <Metric label="Creator fee" value="0.20%" />
            <Metric label="Creator quota" value="3" detail="Published bots" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-6 py-4">
            <span className="inline-flex items-center gap-2 text-xs text-dim"><Users size={15} className="text-gold-400" /> Versioned subscriber copies</span>
            <Link href="/bots/kol" className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-void">
              Explore strategies <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </article>
      </section>

      <section className="mt-6 border-y border-edge bg-panel/40">
        <div className="grid divide-y divide-edge md:grid-cols-3 md:divide-x md:divide-y-0">
          <Metric label="Your bots" value={authenticated ? bots.length : "--"} detail={authenticated ? "Discord and KOL" : "Connect to view"} />
          <Metric label="Active now" value={authenticated ? active : "--"} tone={active ? "positive" : "default"} detail="Entries remain globally gated" />
          <Metric label="Safety posture" value="Fail closed" detail="Stale or missing required evidence rejects entry" />
        </div>
      </section>
    </AppShell>
  );
}
