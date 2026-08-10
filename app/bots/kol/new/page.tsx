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
      <PageHeader title="New KOL strategy" description="Set what to buy, when to sell, and how much to risk." />
      <ProductTabs items={TABS} active="/bots/kol" />
      <div className="mt-6"><BotBuilder kind="kol" /></div>
    </AppShell>
  );
}
