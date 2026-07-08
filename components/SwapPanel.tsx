"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSendTransaction } from "@privy-io/react-auth/solana";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { supabase } from "@/lib/supabase";
import { getRpc, getNet } from "@/lib/net";
import { getSolanaAddress } from "@/lib/solanaWallet";

const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

type Status = "idle" | "quoting" | "signing" | "done" | "error";

/**
 * Live swap — full non-custodial loop on mainnet: fetch a real Jupiter swap tx from
 * /api/swap, then sign AND send it with the user's Privy embedded wallet. The platform
 * never holds keys — the user's wallet signs every transaction.
 */
export default function SwapPanel() {
  const { authenticated, user, login } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const [amount, setAmount] = useState(0.01);
  const [status, setStatus] = useState<Status>("idle");
  const [sig, setSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pubkey = getSolanaAddress(user);

  async function run() {
    if (!authenticated || !pubkey) { login(); return; }
    setErr(null); setSig(null);
    try {
      setStatus("quoting");
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({ inputMint: SOL, outputMint: BONK, amount: Math.floor(amount * 1e9), userPublicKey: pubkey })
      }).then((r) => r.json());
      if (res.error || !res.swapTransaction) throw new Error(res.error || "could not build swap");

      const raw = Uint8Array.from(atob(res.swapTransaction), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(raw);

      setStatus("signing");
      const connection = new Connection(getRpc(), "confirmed");
      const receipt: any = await sendTransaction({ transaction: tx, connection });

      setSig(receipt?.signature ?? null);
      setStatus("done");
    } catch (e: any) {
      setErr(e.message || "signing cancelled"); setStatus("error");
    }
  }

  const busy = status === "quoting" || status === "signing";

  return (
    <div className="rounded-lg border border-edge bg-panel p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-bold">Live swap</h2>
        <span className="rounded-full border border-hotpink/50 px-2 py-0.5 font-mono text-[11px] text-hotpink">mainnet</span>
      </div>
      <p className="mt-1 text-xs text-dim">
        Real Jupiter swap, signed and sent by your own wallet. Non-custodial end to end.
      </p>
      <label className="mt-4 block">
        <span className="font-mono text-[11px] uppercase text-dim">Amount (SOL) → BONK</span>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(+e.target.value)}
          className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
      </label>
      <button onClick={run} disabled={busy || amount <= 0}
        className="mt-4 w-full rounded-md bg-toxic py-2.5 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
        {status === "quoting" ? "Building swap…" : status === "signing" ? "Sign in your wallet…" : authenticated ? "Swap & sign" : "Connect wallet"}
      </button>
      {status === "done" && (
        <p className="mt-3 break-all font-mono text-[11px] text-toxic">
          ✓ Sent{sig ? <> — <a href={`https://explorer.solana.com/tx/${sig}`} target="_blank" rel="noreferrer" className="underline">{sig.slice(0, 12)}…</a></> : ""}
        </p>
      )}
      {status === "error" && <p className="mt-3 font-mono text-[11px] text-hotpink">{err}</p>}
    </div>
  );
}
