"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogIn, ShieldAlert } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";

export default function Login() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (authenticated && ready && !redirecting) {
      setRedirecting(true);
      router.replace("/terminal");
    }
  }, [authenticated, ready, router, redirecting]);

  function continueToPrivy() {
    if (!agree) {
      setMsg("Accept the risk disclosure before continuing.");
      return;
    }
    setMsg(null);
    login();
  }

  return (
    <main className="grid-bg flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 block text-center text-2xl font-bold">
          DEGEN<span className="text-toxic text-glow-toxic">ARATION</span>
        </Link>
        <div className="rounded-lg border border-edge bg-panel p-6">
          <div className="flex items-start gap-3 rounded-md border border-edge bg-void p-4">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-hotpink" />
            <p className="text-xs leading-5 text-dim">Memecoin trading can result in rapid, total loss. Manual swaps use real mainnet funds and are irreversible.</p>
          </div>
          <label className="mt-4 flex items-start gap-2 text-xs text-dim">
            <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} className="mt-0.5 accent-toxic" />
            <span>I understand the risk and want to open the secure sign-in options.</span>
          </label>
          <button onClick={continueToPrivy} disabled={!ready || redirecting} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-toxic px-4 font-bold text-[#17110c] shadow-toxic transition hover:brightness-110 disabled:opacity-50">
            <LogIn size={17} /> {redirecting ? "Opening terminal" : "Continue to sign in"}
          </button>
          <p className="mt-3 text-center font-mono text-[10px] text-dim">Google, email, and supported wallet options appear in the Privy dialog.</p>
          {msg && <p className="mt-4 text-center text-xs text-hotpink">{msg}</p>}
        </div>
      </div>
    </main>
  );
}
