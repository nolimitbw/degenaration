import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WalletCards } from "lucide-react";
import AppShell from "@/components/AppShell";
import { isMint } from "@/lib/server/guard";
import PublicWallet from "./PublicWallet";

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const address = (await params).address;
  return { title: isMint(address) ? `Wallet ${address.slice(0, 6)}` : "Invalid wallet" };
}

export default async function PublicWalletPage({ params }: Props) {
  const address = (await params).address;
  if (!isMint(address)) notFound();
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-3"><WalletCards aria-hidden="true" className="text-toxic" /><div><h1 className="text-2xl font-bold">Public wallet P&amp;L</h1><p className="mt-1 break-all font-mono text-[11px] text-dim">{address}</p></div></div>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-dim">A wallet-free view of current balances and estimated 24-hour price movement. No sign-in or wallet connection is required.</p>
        <div className="mt-6"><PublicWallet address={address} /></div>
      </div>
    </AppShell>
  );
}
