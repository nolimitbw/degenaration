"use client";

import AdminGuard from "@/components/AdminGuard";
import AppShell from "@/components/AppShell";
import OwnerConsole from "@/components/admin/OwnerConsole";

export default function AdminPage() {
  return (
    <AdminGuard>
      <AppShell>
        <OwnerConsole />
      </AppShell>
    </AdminGuard>
  );
}
