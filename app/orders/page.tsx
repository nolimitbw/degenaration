"use client";
import AppShell from "@/components/AppShell";
import dynamic from "next/dynamic";

// Shell paints instantly; the Privy + trade-execution body loads as a separate chunk.
const OrdersBody = dynamic(() => import("./OrdersBody"), {
  ssr: false,
  loading: () => <p className="text-sm text-dim">Loading orders…</p>
});

export default function Orders() {
  return (
    <AppShell>
      <OrdersBody />
    </AppShell>
  );
}
