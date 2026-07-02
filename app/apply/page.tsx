"use client";
import AppShell from "@/components/AppShell";
import { useState } from "react";
import { submitApplication } from "@/lib/queries";

export default function Apply() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ server_name: "", invite_link: "", owner_handle: "", member_count: "", pitch: "" });

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await submitApplication(form);
    setBusy(false);
    if (error) { setErr("Could not submit yet — run the database schema first, then try again."); return; }
    setSent(true);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">List your Discord server</h1>
        <p className="mt-1 text-sm text-dim">
          Run a calls group? Apply to get listed on Degenaration. Approved groups get a
          copy button next to every call — and your community trades it in seconds.
        </p>

        {sent ? (
          <div className="mt-8 rounded-lg border border-toxic/50 bg-panel p-8 text-center">
            <p className="text-4xl">✓</p>
            <h2 className="mt-3 text-lg font-bold text-toxic">Application received</h2>
            <p className="mt-2 text-sm text-dim">
              We review every server manually. You&apos;ll get a Discord DM with the bot
              invite link if approved.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-4 rounded-lg border border-edge bg-panel p-6">
            {([
              { k: "server_name", label: "Server name", ph: "Alpha Trenches" },
              { k: "invite_link", label: "Discord invite link", ph: "discord.gg/…" },
              { k: "owner_handle", label: "Your Discord username", ph: "caller#0001" },
              { k: "member_count", label: "Member count", ph: "12,000" }
            ] as const).map((f) => (
              <label key={f.k} className="block">
                <span className="font-mono text-[11px] uppercase text-dim">{f.label}</span>
                <input required placeholder={f.ph} value={form[f.k]} onChange={upd(f.k)}
                  className="mt-1 w-full rounded-md border border-edge bg-void px-4 py-3 text-sm outline-none transition focus:border-toxic" />
              </label>
            ))}
            <label className="block">
              <span className="font-mono text-[11px] uppercase text-dim">Why should we list you? (track record, style, proof)</span>
              <textarea rows={4} value={form.pitch} onChange={upd("pitch")}
                className="mt-1 w-full rounded-md border border-edge bg-void px-4 py-3 text-sm outline-none transition focus:border-toxic" />
            </label>
            {err && <p className="text-xs text-hotpink">{err}</p>}
            <button disabled={busy} className="w-full rounded-md bg-toxic py-3 font-bold text-void shadow-toxic transition hover:brightness-110 disabled:opacity-50">
              {busy ? "Submitting…" : "Submit application →"}
            </button>
            <p className="text-center font-mono text-[11px] text-dim">Revenue share available for high-performing groups</p>
          </form>
        )}
      </div>
    </AppShell>
  );
}
