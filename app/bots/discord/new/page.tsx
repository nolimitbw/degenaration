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
      <PageHeader title="New Discord bot" description="Pick a server to copy, decide how much it can spend, then set your exits." />
      <ProductTabs items={TABS} active="/bots/discord" />
      <div className="mt-6"><BotBuilder kind="discord" /></div>
    </AppShell>
  );
}
