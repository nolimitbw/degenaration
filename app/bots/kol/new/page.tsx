"use client";

import AppShell from "@/components/AppShell";
import BotBuilder from "@/components/product/BotBuilder";
import { PageHeader, ProductTabs } from "@/components/product/Primitives";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

export default function NewKolBotPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Bots / KOL / New" title="Build KOL strategy" description="Define scanner logic, volatility triggers, DCA, exits, and fail-closed evidence requirements." />
      <ProductTabs items={TABS} active="/bots/kol" />
      <div className="mt-6"><BotBuilder kind="kol" /></div>
    </AppShell>
  );
}
