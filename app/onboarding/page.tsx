"use client";
import AppShell from "@/components/AppShell";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getApprovedGroups, saveSubscription, saveProfileLimits, type Group } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

const STEPS = ["Risk disclosure", "Your wallet", "Add funds", "Pick groups", "Done"];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [agree, setAgree] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getApprovedGroups().then(setGroups); }, []);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function next() {
    // Persist as the user advances past the relevant steps
    if (step === 0 && agree) {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) await supabase.from("profiles").update({ risk_accepted: true }).eq("id", auth.user.id);
    }
    if (step === 3 && picked.length) {
      setSaving(true);
      for (const id of picked) await saveSubscription({ group_id: id, enabled: true });
      setSaving(false);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const canNext = step === 0 ? agree : true;
  const fallbackGroups = groups;

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs ${
                i < step ? "bg-toxic text-void" : i === step ? "border-2 border-toxic text-toxic" : "border border-edge text-dim"
              }`}>{i < step ? "✓" : i + 1}</div>
              {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-toxic" : "bg-edge"}`} />}
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-edge bg-panel p-6">
          <h1 className="text-xl font-bold">{STEPS[step]}</h1>

          {step === 0 && (
            <div className="mt-4 space-y-4 text-sm text-dim">
              <p className="rounded-md border border-hotpink/40 bg-hotpink/5 p-4 leading-relaxed text-white/90">
                Memecoin trading is extremely high risk. Prices can go to zero in seconds.
                Only trade what you can afford to lose. Degenaration is self-directed software,
                not financial advice, and never holds custody of your funds.
              </p>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 accent-toxic" />
                <span>I understand and accept the risks.</span>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-dim">Choose how you&apos;ll trade. Either way, only you control the keys.</p>
              <div className="rounded-md border border-toxic/50 bg-void p-4">
                <p className="font-bold">Create a Degenaration wallet</p>
                <p className="mt-1 text-xs text-dim">Instant embedded Solana wallet via Privy — secured to your login, we never see the key.</p>
              </div>
              <div className="rounded-md border border-edge bg-void p-4">
                <p className="font-bold">Connect existing wallet</p>
                <p className="mt-1 text-xs text-dim">Phantom / Solflare. Grant trade-only permission with a spend cap.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="mt-4 space-y-3 text-sm text-dim">
              <p>Fund your wallet to start copying calls. On devnet you can use the free faucet.</p>
              <Link href="/wallet" className="block rounded-md border border-edge bg-void p-4 transition hover:border-toxic">
                <span className="font-bold text-white">Open deposit screen →</span>
                <p className="mt-1 text-xs">Address, QR code, and devnet faucet link.</p>
              </Link>
            </div>
          )}

          {step === 3 && (
            <div className="mt-4">
              <p className="text-sm text-dim">Pick at least one call group to copy. You can change this anytime.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {!fallbackGroups.length && <p className="col-span-2 text-sm text-dim">No groups to copy yet — you can add them later once groups are live.</p>}
                {fallbackGroups.map((g) => (
                  <button key={g.id} onClick={() => toggle(g.id)}
                    className={`rounded-md border p-3 text-sm font-bold transition ${
                      picked.includes(g.id) ? "border-toxic bg-toxic/10 text-toxic" : "border-edge text-dim hover:border-cyber"
                    }`}>{g.name}</button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="mt-4 text-center">
              <p className="text-4xl">🚀</p>
              <p className="mt-3 font-bold text-toxic">You&apos;re set up.</p>
              <p className="mt-1 text-sm text-dim">Copying {picked.length || "your"} group(s). Head to your dashboard.</p>
              <Link href="/dashboard" className="mt-5 inline-block rounded-md bg-toxic px-6 py-2.5 font-bold text-void shadow-toxic">
                Go to dashboard →
              </Link>
            </div>
          )}

          {step < 4 && (
            <button onClick={next} disabled={!canNext || saving}
              className="mt-6 w-full rounded-md bg-toxic py-3 font-bold text-void shadow-toxic transition hover:brightness-110 disabled:opacity-40">
              {saving ? "Saving…" : "Continue →"}
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
