"use client";

import dynamic from "next/dynamic";
import AppShell from "@/components/AppShell";

const DashboardBody = dynamic(() => import("../dashboard/DashboardBody"), { ssr: false });

export default function TradesPage() {
  return <AppShell><DashboardBody view="trades" /></AppShell>;
}
