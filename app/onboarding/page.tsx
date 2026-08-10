"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Check, LogIn, ShieldAlert, WalletCards } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import AppShell from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { saveProfileLimits } from "@/lib/queries";
import { getSolanaAddress } from "@/lib/solanaWallet";

// Three steps, not five. "Fund wallet" and "Choose source" were pages of their own wearing
// wizard chrome -- a step whose only content is a link out is filler, and filler is what makes
// setup feel long. Funding and source selection now happen where they actually live, reached
// from the finish screen. Spec section A: minimal, not overwhelming.
const STEPS = ["Risk disclosure", "Wallet", "Ready"];

export default function Onboarding() {
  const { ready, authenticated, user, login, getAccessToken } = usePrivy();
  const toast = useToast();
  const wallet = getSolanaAddress(user);
  const [step, setStep] = useState(0);
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);

  async function next() {
    if (step === 0) {
      setSaving(true);
      const token = await getAccessToken();
      const { error } = await saveProfileLimits({ risk_accepted: true }, token);
      setSaving(false);
      if (error) {
        // Was "Sign in before accepting the risk disclosure", which is misleading: this branch
        // is reached by an already-authenticated user whose save failed server-side. Telling
        // someone to do the thing they have already done is worse than saying nothing.
        toast(authenticated
          ? "Could not save your acknowledgement. Try again."
          : "Sign in to continue.", "err");
        return;
      }
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  const canNext = step === 0 ? agree && authenticated : Boolean(authenticated && wallet);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-2" aria-label={`Onboarding step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((label, index) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs ${index < step ? "bg-gold-400 text-[#17110c]" : index === step ? "border-2 border-gold-400 text-gold-400" : "border border-edge text-dim"}`}>{index < step ? <Check size={14} /> : index + 1}</div>
              {index < STEPS.length - 1 && <div className={`h-px flex-1 ${index < step ? "bg-gold-400" : "bg-edge"}`} />}
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-edge bg-panel p-6">
          <p className="ui-label text-gold-400">Step {step + 1} of {STEPS.length}</p>
          <h1 className="mt-1 text-xl font-bold">{STEPS[step]}</h1>

          {step === 0 && (
            <div className="mt-4 space-y-4 text-sm text-dim">
              <div className="flex items-start gap-3 rounded-md border border-danger/40 bg-danger/5 p-4 leading-relaxed text-ink/90"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-danger" /><p>Memecoin prices can collapse in seconds. Manual swaps use real Solana mainnet funds and are irreversible. Degenaration is self-directed software, not financial advice.</p></div>
              {!authenticated && <button onClick={login} disabled={!ready} className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-xs font-bold transition hover:border-gold-400 disabled:opacity-50"><LogIn size={15} /> Sign in to continue</button>}
              <label className="flex min-h-11 items-start gap-2 sm:min-h-0"><input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} className="mt-0.5 accent-gold-400" /><span>I understand that I can lose my entire trading balance.</span></label>
            </div>
          )}

          {step === 1 && (
            <div className="mt-4">
              {authenticated && wallet ? <div className="rounded-md border border-gold-400/40 bg-void p-4"><div className="flex items-center gap-2 font-bold"><WalletCards size={17} className="text-gold-400" /> Solana wallet ready</div><code className="mt-2 block truncate font-mono text-xs text-dim">{wallet}</code><p className="mt-2 text-xs text-dim">Wallet keys remain secured by your wallet provider. Delegated access is optional and managed separately.</p></div> : <div className="rounded-md border border-edge bg-void p-4"><p className="text-sm text-dim">Open Privy sign-in to create or link a supported Solana wallet.</p><button onClick={login} disabled={!ready} className="mt-3 inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md bg-gold-400 px-4 text-xs font-bold text-[#17110c] disabled:opacity-50"><LogIn size={15} /> Open sign in</button></div>}
            </div>
          )}

          {step === 2 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-gold-400"><Check size={20} /><p className="font-bold">You&apos;re set up</p></div>
              <p className="mt-2 text-sm text-dim">Fund your wallet and pick a source when you&apos;re ready. Nothing runs on its own until you activate a bot.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/bots" className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md bg-gold-400 px-4 text-xs font-bold text-[#17110c]">Browse bots <ArrowRight size={14} /></Link>
                <Link href="/wallet" className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md border border-edge px-4 text-xs font-bold transition hover:border-gold-400">Fund wallet</Link>
              </div>
            </div>
          )}

          {step < STEPS.length - 1 && <button onClick={next} disabled={!canNext || saving} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-gold-400 px-4 font-bold text-[#17110c] shadow-gold transition hover:brightness-110 disabled:opacity-40">{saving ? "Saving" : "Continue"}<ArrowRight size={16} /></button>}
        </div>
      </div>
    </AppShell>
  );
}
