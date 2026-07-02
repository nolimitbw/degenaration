"use client";
import AppShell from "@/components/AppShell";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Settings() {
  const [email, setEmail] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setUid(data.user?.id ?? null);
      setJoined(data.user?.created_at ? new Date(data.user.created_at).toLocaleDateString() : null);
    });
  }, []);

  async function changePassword() {
    setMsg(null);
    if (pw.length < 8) { setMsg("Password must be at least 8 characters."); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setMsg(error ? error.message : "✓ Password updated."); setPw("");
  }

  async function enroll2FA() {
    setMsg(null);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) { setMsg(error.message); return; }
    setQr(data.totp.qr_code); setFactorId(data.id);
  }

  async function verify2FA() {
    if (!factorId) return;
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId });
    if (e1) { setMsg(e1.message); return; }
    const { error: e2 } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    setMsg(e2 ? e2.message : "✓ Two-factor authentication enabled."); if (!e2) { setQr(null); setCode(""); }
  }

  async function signOutAll() {
    await supabase.auth.signOut({ scope: "global" });
    setMsg("Signed out of all sessions.");
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-bold">Account settings</h1>

      <div className="mt-6 max-w-2xl space-y-6">
        <section className="rounded-lg border border-edge bg-panel p-5">
          <h2 className="font-bold">Profile</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 font-mono text-sm md:grid-cols-3">
            <div><p className="text-[11px] uppercase text-dim">Email</p><p className="mt-0.5 truncate">{email ?? "—"}</p></div>
            <div><p className="text-[11px] uppercase text-dim">User ID</p><p className="mt-0.5 truncate">{uid?.slice(0, 8) ?? "—"}…</p></div>
            <div><p className="text-[11px] uppercase text-dim">Joined</p><p className="mt-0.5">{joined ?? "—"}</p></div>
          </div>
        </section>

        <section className="rounded-lg border border-edge bg-panel p-5">
          <h2 className="font-bold">Change password</h2>
          <div className="mt-3 flex gap-2">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password"
              className="flex-1 rounded-md border border-edge bg-void px-3 py-2 text-sm outline-none focus:border-toxic" />
            <button onClick={changePassword} className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-void">Update</button>
          </div>
        </section>

        <section className="rounded-lg border border-edge bg-panel p-5">
          <h2 className="font-bold">Two-factor authentication (2FA)</h2>
          <p className="mt-1 text-xs text-dim">Add an authenticator app for an extra layer of security.</p>
          {!qr ? (
            <button onClick={enroll2FA} className="mt-3 rounded-md border border-edge px-4 py-2 text-sm font-bold transition hover:border-toxic hover:text-toxic">Enable 2FA</button>
          ) : (
            <div className="mt-3">
              <img src={qr} alt="2FA QR" className="h-40 w-40 rounded bg-white p-2" />
              <p className="mt-2 text-xs text-dim">Scan with your authenticator, then enter the 6-digit code:</p>
              <div className="mt-2 flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6}
                  className="w-32 rounded-md border border-edge bg-void px-3 py-2 font-mono text-sm outline-none focus:border-toxic" />
                <button onClick={verify2FA} className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-void">Verify</button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-edge bg-panel p-5">
          <h2 className="font-bold">Sessions</h2>
          <p className="mt-1 text-xs text-dim">Sign out everywhere if you suspect unauthorized access.</p>
          <button onClick={signOutAll} className="mt-3 rounded-md border border-hotpink/50 px-4 py-2 text-sm font-bold text-hotpink hover:bg-hotpink/10">Sign out all sessions</button>
        </section>

        {msg && <p className="font-mono text-xs text-toxic">{msg}</p>}
      </div>
    </AppShell>
  );
}
