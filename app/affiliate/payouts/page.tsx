"use client";

import AppShell from "@/components/AppShell";
import AffiliateDashboard from "@/components/product/AffiliateDashboard";

export default function AffiliatePayoutsPage() {
  return <AppShell><AffiliateDashboard initialScope="payouts" /></AppShell>;
}
