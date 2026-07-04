"use client";
import { useIsAdmin } from "@/lib/admin";

// Renders children only on an unlocked owner device. Everyone else sees a plain
// "not found" that is indistinguishable from a route that does not exist.
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { admin, ready } = useIsAdmin();
  if (!ready) return null;
  if (!admin) {
    return (
      <main className="grid-bg flex min-h-screen flex-col items-center justify-center gap-2 px-5 text-center">
        <h1 className="font-mono text-5xl font-bold text-dim">404</h1>
        <p className="text-sm text-dim">This page could not be found.</p>
      </main>
    );
  }
  return <>{children}</>;
}
