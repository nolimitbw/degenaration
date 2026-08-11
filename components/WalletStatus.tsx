"use client";
import { usePrivy } from "@privy-io/react-auth";
import { getSolanaAddress } from "@/lib/solanaWallet";

export default function WalletStatus() {
  const { ready, authenticated, user, login } = usePrivy();
  const address = getSolanaAddress(user);

  if (!ready) {
    return (
      <span className="flex items-center gap-1.5 t-label text-dim">
        <span className="h-1.5 w-1.5 rounded-full bg-dim/60" /> Checking
      </span>
    );
  }
  if (!authenticated) {
    return (
      <button onClick={login} className="flex items-center gap-1.5 t-label text-dim transition hover:text-gold-400">
        <span className="h-1.5 w-1.5 rounded-full bg-dim/60" /> Connect
      </button>
    );
  }
  if (!address) {
    return (
      <span className="flex items-center gap-1.5 t-label text-danger">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" /> Account only
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 t-label text-gold-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400" /> {address.slice(0, 4)}…{address.slice(-4)}
    </span>
  );
}
