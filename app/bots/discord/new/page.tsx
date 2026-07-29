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

export default function NewDiscordBotPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Bots / Discord / New" title="Configure Discord bot" description="Choose a call source, set the budget, then review the safeguards." />
      <ProductTabs items={TABS} active="/bots/discord" />
      <div className="mt-6"><BotBuilder kind="discord" /></div>
    </AppShell>
  );
}
