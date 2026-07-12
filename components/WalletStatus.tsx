"use client";
import { usePrivy } from "@privy-io/react-auth";
import { getSolanaAddress } from "@/lib/solanaWallet";

export default function WalletStatus() {
  const { ready, authenticated, user, login } = usePrivy();
  const address = getSolanaAddress(user);

  if (!ready) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-dim">
        <span className="h-1.5 w-1.5 rounded-full bg-dim/60" /> Checking
      </span>
    );
  }
  if (!authenticated) {
    return (
      <button onClick={login} className="flex items-center gap-1.5 font-mono text-[11px] text-dim transition hover:text-toxic">
        <span className="h-1.5 w-1.5 rounded-full bg-dim/60" /> Connect
      </button>
    );
  }
  if (!address) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-hotpink">
        <span className="h-1.5 w-1.5 rounded-full bg-hotpink" /> Account only
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-toxic">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-toxic" /> {address.slice(0, 4)}…{address.slice(-4)}
    </span>
  );
}
