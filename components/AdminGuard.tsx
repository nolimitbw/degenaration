"use client";
import { useIsAdmin } from "@/lib/admin";
import { usePrivy } from "@privy-io/react-auth";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { admin, ready, email } = useIsAdmin();
  const { authenticated, login, logout } = usePrivy();
  if (!ready) return null;
  if (!admin) {
    return (
      <main className="grid-bg flex min-h-screen flex-col items-center justify-center gap-2 px-5 text-center">
        <h1 className="text-2xl font-bold">Owner dashboard</h1>
        <p className="max-w-md text-sm text-dim">
          {authenticated
            ? `Signed in as ${email || "another account"}. Use the owner Google account to open this dashboard.`
            : "Sign in with the owner Google account to open this dashboard."}
        </p>
        <button onClick={() => authenticated ? logout() : login()} className="mt-4 rounded-md bg-toxic px-5 py-2 text-sm font-bold text-[#17110c] shadow-toxic">
          {authenticated ? "Sign out and switch account" : "Sign in"}
        </button>
      </main>
    );
  }
  return <>{children}</>;
}
