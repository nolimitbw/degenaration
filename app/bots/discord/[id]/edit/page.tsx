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

export default function EditDiscordBotPage() {
  const params = useParams<{ id: string }>();
  return (
    <AppShell>
      <PageHeader title="Edit Discord bot" description="Changes apply to new trades. Open positions keep the settings they opened with." />
      <ProductTabs items={TABS} active="/bots/manage" />
      <div className="mt-6"><BotBuilder kind="discord" botId={params.id} /></div>
    </AppShell>
  );
}
