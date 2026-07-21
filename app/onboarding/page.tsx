"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Check, LogIn, ShieldAlert, WalletCards } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import AppShell from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { getApprovedGroups, saveProfileLimits, type Group } from "@/lib/queries";
import { getSolanaAddress } from "@/lib/solanaWallet";

const STEPS = ["Risk disclosure", "Account", "Fund wallet", "Choose source", "Done"];

export default function Onboarding() {
  const { ready, authenticated, user, login, getAccessToken } = usePrivy();
  const toast = useToast();
  const wallet = getSolanaAddress(user);
  const [step, setStep] = useState(0);
  const [agree, setAgree] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getApprovedGroups().then(setGroups).catch(() => setGroups([])); }, []);

  async function next() {
    if (step === 0) {
      setSaving(true);
      const token = await getAccessToken();
      const { error } = await saveProfileLimits({ risk_accepted: true }, token);
      setSaving(false);
      if (error) {
        toast("Sign in before accepting the risk disclosure", "err");
        return;
      }
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  const canNext = step === 0 ? agree && authenticated : step === 1 ? Boolean(authenticated && wallet) : true;
  const pickedGroup = groups.find((group) => group.id === picked) ?? null;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-2" aria-label={`Onboarding step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((label, index) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs ${index < step ? "bg-toxic text-[#17110c]" : index === step ? "border-2 border-toxic text-toxic" : "border border-edge text-dim"}`}>{index < step ? <Check size={14} /> : index + 1}</div>
              {index < STEPS.length - 1 && <div className={`h-px flex-1 ${index < step ? "bg-toxic" : "bg-edge"}`} />}
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-edge bg-panel p-6">
          <p className="font-mono text-[10px] uppercase text-toxic">Step {step + 1} of {STEPS.length}</p>
          <h1 className="mt-1 text-xl font-bold">{STEPS[step]}</h1>

          {step === 0 && (
            <div className="mt-4 space-y-4 text-sm text-dim">
              <div className="flex items-start gap-3 rounded-md border border-hotpink/40 bg-hotpink/5 p-4 leading-relaxed text-ink/90"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-hotpink" /><p>Memecoin prices can collapse in seconds. Manual swaps use real Solana mainnet funds and are irreversible. Degenaration is self-directed software, not financial advice.</p></div>
              {!authenticated && <button onClick={login} disabled={!ready} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-xs font-bold transition hover:border-toxic disabled:opacity-50"><LogIn size={15} /> Sign in to continue</button>}
              <label className="flex items-start gap-2"><input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} className="mt-0.5 accent-toxic" /><span>I understand that I can lose my entire trading balance.</span></label>
            </div>
          )}

          {step === 1 && (
            <div className="mt-4">
              {authenticated && wallet ? <div className="rounded-md border border-toxic/40 bg-void p-4"><div className="flex items-center gap-2 font-bold"><WalletCards size={17} className="text-toxic" /> Solana wallet ready</div><code className="mt-2 block truncate font-mono text-xs text-dim">{wallet}</code><p className="mt-2 text-xs text-dim">Wallet keys remain secured by your wallet provider. Delegated access is optional and managed separately.</p></div> : <div className="rounded-md border border-edge bg-void p-4"><p className="text-sm text-dim">Open Privy sign-in to create or link a supported Solana wallet.</p><button onClick={login} disabled={!ready} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-toxic px-4 text-xs font-bold text-[#17110c] disabled:opacity-50"><LogIn size={15} /> Open sign in</button></div>}
            </div>
          )}

          {step === 2 && (
            <div className="mt-4 text-sm text-dim"><p>Review the mainnet deposit address, balance, application limits, and delegation state before placing an order.</p><Link href="/wallet" className="mt-4 flex min-h-12 items-center justify-between rounded-md border border-edge bg-void px-4 font-bold text-ink transition hover:border-toxic"><span>Open Wallet</span><ArrowRight size={16} /></Link></div>
          )}

          {step === 3 && (
            <div className="mt-4"><p className="text-sm text-dim">Choose a measured Discord source to review. Activation and entry limits are configured on the Bots screen.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{groups.length ? groups.map((group) => <button key={group.id} onClick={() => setPicked(group.id)} className={`min-h-12 rounded-md border px-3 text-left text-sm font-bold transition ${picked === group.id ? "border-toxic bg-toxic/10 text-toxic" : "border-edge bg-void text-dim hover:border-toxic"}`}>{group.name}</button>) : <p className="sm:col-span-2 rounded-md border border-edge bg-void p-4 text-sm text-dim">No approved sources are available yet.</p>}</div></div>
          )}

          {step === 4 && (
            <div className="mt-4"><div className="flex items-center gap-2 text-toxic"><Check size={20} /><p className="font-bold">Account setup reviewed</p></div><p className="mt-2 text-sm text-dim">{pickedGroup ? `${pickedGroup.name} is ready for review in Bots.` : "Open the terminal or review available sources in Bots."} No automation was activated during onboarding.</p><div className="mt-5 flex flex-wrap gap-2"><Link href="/terminal" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-toxic px-4 text-xs font-bold text-[#17110c]">Open terminal <ArrowRight size={14} /></Link><Link href="/bots" className="inline-flex min-h-10 items-center rounded-md border border-edge px-4 text-xs font-bold transition hover:border-toxic">Review Bots</Link></div></div>
          )}

          {step < STEPS.length - 1 && <button onClick={next} disabled={!canNext || saving} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-toxic px-4 font-bold text-[#17110c] shadow-toxic transition hover:brightness-110 disabled:opacity-40">{saving ? "Saving" : "Continue"}<ArrowRight size={16} /></button>}
        </div>
      </div>
    </AppShell>
  );
}
