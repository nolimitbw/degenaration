"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export default function Login() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (authenticated && ready && !redirecting) {
      setRedirecting(true);
      router.replace("/trenches");
    }
  }, [authenticated, ready, router, redirecting]);

  // Privy v2's login() opens the modal configured in Providers.tsx (Google + email + wallet).
  // Passing a { provider } shape is invalid in v2, so both entry points open the same modal.
  function handleGoogle() {
    login();
  }

  function handleEmail() {
    if (!agree) { setMsg("Please accept the risk disclosure."); return; }
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
          <button onClick={handleGoogle}
            className="w-full rounded-md border border-edge bg-void py-3 text-sm font-bold transition hover:border-cyber">
            Continue with Google
          </button>
          <div className="my-4 flex items-center gap-3 text-[11px] font-mono text-dim">
            <span className="h-px flex-1 bg-edge" /> OR <span className="h-px flex-1 bg-edge" />
          </div>
          <input type="email" placeholder="email@degen.gg" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-edge bg-void px-4 py-3 text-sm outline-none transition focus:border-toxic" />
          <label className="mt-4 flex items-start gap-2 text-xs text-dim">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 accent-toxic" />
            I understand memecoin trading is extremely high risk and I can lose my entire balance.
          </label>
          <button onClick={handleEmail} disabled={!email || !agree}
            className="mt-5 w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
            Continue with email →
          </button>
          {msg && <p className="mt-4 text-center text-xs text-hotpink">{msg}</p>}
        </div>
      </div>
    </main>
  );
}
