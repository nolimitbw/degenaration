"use client";

import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import BotBuilder from "@/components/product/BotBuilder";
import { PageHeader, ProductTabs } from "@/components/product/Primitives";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

export default function EditKolBotPage() {
  const params = useParams<{ id: string }>();
  return (
    <AppShell>
      <PageHeader eyebrow="Bots / KOL / Edit" title="Edit KOL strategy" description="New settings apply to future signals; existing positions retain their entry snapshot." />
      <ProductTabs items={TABS} active="/bots/manage" />
      <div className="mt-6"><BotBuilder kind="kol" botId={params.id} /></div>
    </AppShell>
  );
}
