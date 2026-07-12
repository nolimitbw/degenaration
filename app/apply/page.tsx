"use client";
import AppShell from "@/components/AppShell";
import { useState } from "react";
import { submitApplication } from "@/lib/queries";

// Keep this client id aligned with the DISCORD_BOT_TOKEN application.
const BOT_CLIENT_ID = "1525315046303858748";

// Override per-deploy with NEXT_PUBLIC_DISCORD_BOT_INVITE if the canonical Discord app id ever changes.
// permissions=68608 = View Channels + Send Messages + Read Message History.
const BOT_INVITE = process.env.NEXT_PUBLIC_DISCORD_BOT_INVITE ||
  `https://discord.com/oauth2/authorize?client_id=${BOT_CLIENT_ID}&permissions=68608&scope=bot%20applications.commands`;

export default function Apply() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ server_name: "", invite_link: "", owner_handle: "", member_count: "", pitch: "" });

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = {
      server_name: form.server_name.trim(),
      invite_link: form.invite_link.trim(),
      owner_handle: form.owner_handle.trim(),
      member_count: form.member_count.trim(),
      pitch: form.pitch.trim()
    };
    if (!trimmed.server_name || trimmed.server_name.length > 100) { setErr("Server name is required (max 100 chars)"); return; }
    if (!trimmed.invite_link || trimmed.invite_link.length > 200) { setErr("Valid invite link is required"); return; }
    if (!trimmed.owner_handle || trimmed.owner_handle.length > 100) { setErr("Your Discord username is required"); return; }
    setBusy(true); setErr(null);
    const { error } = await submitApplication(trimmed);
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
          measurable source profile, and traders can choose their own rules for following it.
        </p>
        <div className="mt-6 rounded-lg border border-toxic/30 bg-toxic/5 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-ink">Add the active Degenaration bot</h2>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                Server managers can add the bot, then run <code className="rounded bg-void px-1.5 py-0.5 font-mono text-toxic">!register</code> in a calls channel. New channels stay pending until approval.
              </p>
            </div>
            <a href={BOT_INVITE} target="_blank" rel="noreferrer" className="shrink-0 rounded-md bg-toxic px-4 py-2 text-center text-sm font-bold text-white transition hover:brightness-110">
              Add bot
            </a>
          </div>
        </div>

        {sent ? (
          <div className="mt-8 rounded-lg border border-toxic/50 bg-panel p-8">
            <p className="text-center text-4xl">✓</p>
            <h2 className="mt-3 text-center text-lg font-bold text-toxic">Application received</h2>
            <p className="mt-2 text-center text-sm text-dim">
              We review every server manually. Once approved, add our bot and register your
              calls channel:
            </p>
            <ol className="mx-auto mt-5 max-w-md space-y-3 text-sm text-dim">
              <li><b className="text-ink">1.</b> Add the Degenaration bot to your server (read-only — it only watches messages):
                <a href={BOT_INVITE} target="_blank" rel="noreferrer" className="mt-2 block rounded-md bg-toxic px-4 py-2 text-center font-bold text-white transition hover:brightness-110">Add bot to my server →</a>
              </li>
              <li><b className="text-ink">2.</b> In the channel where you post calls, type <code className="rounded bg-void px-1.5 py-0.5 font-mono text-toxic">!register</code>. The bot confirms.</li>
              <li><b className="text-ink">3.</b> We review the channel. Once approved, qualifying calls are recorded so your source can build a public performance record.</li>
            </ol>
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
            <button disabled={busy} className="w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
              {busy ? "Submitting…" : "Submit application →"}
            </button>
            <p className="text-center font-mono text-[11px] text-dim">Revenue share available for high-performing groups</p>
          </form>
        )}
      </div>
    </AppShell>
  );
}
