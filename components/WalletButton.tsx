"use client";
import { usePrivy } from "@privy-io/react-auth";

export default function WalletButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  if (!ready) return <span className="rounded-md border border-edge px-3 py-1.5 font-mono text-xs text-dim">…</span>;
  if (!authenticated)
    return <button onClick={login} className="rounded-md bg-toxic px-3 py-1.5 text-xs font-bold text-white">Connect wallet</button>;
  const sol = (user as any)?.wallet?.address;
  const short = sol ? `${sol.slice(0, 4)}…${sol.slice(-4)}` : ((user as any)?.email?.address ?? "account");
  return <button onClick={logout} className="rounded-md border border-toxic/60 px-3 py-1.5 font-mono text-xs text-toxic">◈ {short}</button>;
}
