"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleEmail() {
    setMsg(null);
    if (mode === "signup" && !agree) { setMsg("Please accept the risk disclosure."); return; }
    setBusy(true);
    const fn = mode === "signup"
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password });
    const { error } = await fn;
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    if (mode === "signup") setMsg("Check your email to confirm, then sign in.");
    else router.push("/dashboard");
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` }
    });
  }

  return (
    <main className="grid-bg flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 block text-center text-2xl font-bold">
          DEGEN<span className="text-toxic text-glow-toxic">ARATION</span>
        </Link>
        <div className="rounded-lg border border-edge bg-panel p-6">
          <div className="mb-6 grid grid-cols-2 rounded-md border border-edge p-1 font-mono text-xs">
            {(["signup", "signin"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`rounded py-2 font-bold transition ${mode === m ? "bg-toxic text-void" : "text-dim"}`}>
                {m === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}
              </button>
            ))}
          </div>
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
          <input type="password" placeholder="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-3 w-full rounded-md border border-edge bg-void px-4 py-3 text-sm outline-none transition focus:border-toxic" />
          {mode === "signup" && (
            <label className="mt-4 flex items-start gap-2 text-xs text-dim">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 accent-toxic" />
              I understand memecoin trading is extremely high risk and I can lose my entire balance.
            </label>
          )}
          <button onClick={handleEmail} disabled={busy}
            className="mt-5 w-full rounded-md bg-toxic py-3 font-bold text-void shadow-toxic transition hover:brightness-110 disabled:opacity-50">
            {busy ? "…" : mode === "signup" ? "Create account →" : "Sign in →"}
          </button>
          {msg && <p className="mt-4 text-center text-xs text-hotpink">{msg}</p>}
        </div>
      </div>
    </main>
  );
}
