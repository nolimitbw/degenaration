"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { Check, Link2, Loader2, ServerCog, ShieldCheck } from "lucide-react";
import AppShell from "@/components/AppShell";
import { productFetch } from "@/lib/product-api";

type LinkSession = {
  sessionId: string;
  status: string;
  expiresAt: string;
  discordUsername: string | null;
  sourceName: string | null;
  sourceEligible: boolean;
  state: string;
};

export default function DiscordOwnerLinkPage() {
  const params = useParams<{ session: string }>();
  const { ready, authenticated, login, linkDiscord, user, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [session, setSession] = useState<LinkSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [complete, setComplete] = useState<{ sourceClaimed: boolean; claimStatus?: string; discordUsername?: string | null } | null>(null);
  const [error, setError] = useState("");
  const discordLinked = Boolean((user as any)?.discord || (user as any)?.linkedAccounts?.some((account: any) => account?.type === "discord_oauth"));

  useEffect(() => {
    if (!ready || !authenticated || !discordLinked || !identityToken || !params.session) return;
    setLoading(true);
    setError("");
    productFetch<LinkSession>(
      `/api/product/discord-ownership?session=${encodeURIComponent(params.session)}`,
      { getAccessToken, identityToken }
    )
      .then(setSession)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "This owner link is unavailable."))
      .finally(() => setLoading(false));
  }, [authenticated, discordLinked, getAccessToken, identityToken, params.session, ready]);

  async function confirm() {
    if (!session) return;
    setCompleting(true);
    setError("");
    try {
      const result = await productFetch<{ sourceClaimed: boolean; claimStatus?: string; discordUsername?: string | null }>(
        "/api/product/discord-ownership",
        { getAccessToken, identityToken },
        {
          method: "POST",
          headers: { "x-discord-link-state": session.state },
          body: JSON.stringify({ sessionId: session.sessionId })
        }
      );
      setComplete(result);
      setSession(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ownership could not be connected.");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl py-8 sm:py-14">
        <div className="rounded-md border border-edge bg-panel">
          <header className="border-b border-edge p-5 sm:p-7">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-400">Verified source ownership</p>
            <h1 className="mt-3 text-xl font-semibold text-ink">Connect Discord</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-dim">Match the Discord manager who created this link to one signed-in DegenAration account.</p>
          </header>

          <div className="p-5 sm:p-7">
            {!ready || loading ? (
              <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-dim"><Loader2 className="animate-spin text-gold-400" size={18} /> Verifying link</div>
            ) : complete ? (
              <div className="py-6 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-up/10 text-up"><Check size={22} /></span>
                <h2 className="mt-4 text-base font-semibold text-ink">Discord connected</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-dim">
                  {complete.sourceClaimed
                    ? "The eligible source is now managed by this account. Future confirmed creator commission can credit only this verified owner."
                    : complete.claimStatus === "admin-resolution-required"
                      ? "Your Discord identity is connected, but this source already has an owner. An admin must resolve the ownership history before future commission attribution changes."
                      : "Your Discord identity is connected. No eligible approved source was available to claim; finish source approval, then run /connect discord again."}
                </p>
                <Link href="/affiliate?tab=discord" className="mt-6 inline-flex min-h-11 items-center rounded-md bg-gold-400 px-5 text-sm font-semibold text-[#17110c]">Open owner dashboard</Link>
              </div>
            ) : !authenticated ? (
              <OwnerStep icon={<ShieldCheck size={20} />} title="Sign in to DegenAration" detail="The account you sign in with will become the source owner only after the Discord identity also matches.">
                <button type="button" onClick={login} className="min-h-11 rounded-md bg-gold-400 px-5 text-sm font-semibold text-[#17110c]">Sign in</button>
              </OwnerStep>
            ) : !discordLinked ? (
              <OwnerStep icon={<Link2 size={20} />} title="Verify the same Discord account" detail="Privy will add a signed Discord identity to this DegenAration account. A username entered in a form is never trusted.">
                <button type="button" onClick={() => linkDiscord()} className="min-h-11 rounded-md bg-gold-400 px-5 text-sm font-semibold text-[#17110c]">Connect Discord</button>
              </OwnerStep>
            ) : session ? (
              <div>
                <div className="grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2">
                  <Summary label="Discord account" value={session.discordUsername ? `@${session.discordUsername}` : "Verified Discord identity"} />
                  <Summary label="Source" value={session.sourceName || "No approved source yet"} />
                  <Summary label="Permission proof" value="Manage Server verified" />
                  <Summary label="Link expires" value={new Date(session.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} />
                </div>
                <div className="mt-5 flex items-start gap-3 rounded-md border border-edge bg-void p-4">
                  <ServerCog className="mt-0.5 shrink-0 text-gold-400" size={18} />
                  <p className="text-xs leading-5 text-dim">Confirming creates an immutable audit event. Existing ownership by another account is never replaced silently and requires admin dispute resolution.</p>
                </div>
                <button type="button" onClick={confirm} disabled={completing} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-gold-400 px-5 text-sm font-semibold text-[#17110c] disabled:opacity-50">
                  {completing && <Loader2 className="animate-spin" size={15} />}
                  Confirm ownership link
                </button>
              </div>
            ) : null}

            {error && <div className="mt-5 rounded-md border border-down/30 bg-down/5 p-4 text-xs leading-5 text-down">{error}</div>}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function OwnerStep({ icon, title, detail, children }: { icon: React.ReactNode; title: string; detail: string; children: React.ReactNode }) {
  return <div className="py-6 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gold-400/10 text-gold-400">{icon}</span><h2 className="mt-4 text-base font-semibold text-ink">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-dim">{detail}</p><div className="mt-6">{children}</div></div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="bg-panel p-4"><p className="field-label">{label}</p><p className="mt-2 text-xs font-semibold text-ink">{value}</p></div>;
}
