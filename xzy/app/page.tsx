"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiDelete, getWebApp, getInitData, haptic } from "@/lib/miniapp";
import { CopySetup } from "@/components/CopySetup";
import type { Me, ChannelRow, Subscription, Wallet, Position } from "@/lib/types";

type Tab = "channels" | "positions";

type Phase =
  | { name: "loading" }
  | { name: "outside-telegram" }
  | { name: "unauthorized"; reason: string }
  | { name: "ready" };

export default function Home() {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [tab, setTab] = useState<Tab>("channels");
  const [editing, setEditing] = useState<ChannelRow | null>(null);

  const load = useCallback(async () => {
    const meRes = await apiFetch("/api/me");
    if (!meRes.ok) {
      const body = (await meRes.json().catch(() => null)) as { error?: string } | null;
      setPhase({ name: "unauthorized", reason: body?.error ?? `HTTP ${meRes.status}` });
      return;
    }
    setMe((await meRes.json()) as Me);

    // The wallet is created on first read, so this call is also onboarding.
    const [walletRes, channelsRes, subsRes, positionsRes] = await Promise.all([
      apiFetch("/api/wallet"),
      apiFetch("/api/channels"),
      apiFetch("/api/subscriptions"),
      apiFetch("/api/positions")
    ]);

    if (walletRes.ok) setWallet((await walletRes.json()) as Wallet);
    if (channelsRes.ok) setChannels(((await channelsRes.json()) as { channels: ChannelRow[] }).channels);
    if (subsRes.ok) setSubscriptions(((await subsRes.json()) as { subscriptions: Subscription[] }).subscriptions);
    if (positionsRes.ok) setPositions(((await positionsRes.json()) as { positions: Position[] }).positions);

    setPhase({ name: "ready" });
  }, []);

  useEffect(() => {
    const webApp = getWebApp();
    webApp?.ready?.();
    webApp?.expand?.();
    webApp?.setHeaderColor?.("#080808");
    webApp?.setBackgroundColor?.("#080808");

    if (!getInitData()) {
      setPhase({ name: "outside-telegram" });
      return;
    }
    void load();
  }, [load]);

  const subscriptionFor = (channelId: string) => subscriptions.find((sub) => sub.channelId === channelId) ?? null;

  if (phase.name === "loading") return <Shell><Notice title="Loading" body="Checking your Telegram session." /></Shell>;

  if (phase.name === "outside-telegram") {
    return (
      <Shell>
        <Notice
          title="Open this inside Telegram"
          body="Xzy signs you in through Telegram, so this page only works when opened from the bot."
        />
      </Shell>
    );
  }

  if (phase.name === "unauthorized") {
    return (
      <Shell>
        <Notice
          title="Could not verify your session"
          body={`Telegram's signature did not check out (${phase.reason}). Close the app and reopen it from the bot.`}
        />
      </Shell>
    );
  }

  if (editing) {
    return (
      <Shell>
        <CopySetup
          channel={editing}
          existing={subscriptionFor(editing.id)}
          onCancel={() => setEditing(null)}
          onSaved={(subscription) => {
            setSubscriptions((current) => [
              subscription,
              ...current.filter((item) => item.channelId !== subscription.channelId)
            ]);
            setEditing(null);
            haptic("medium");
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <WalletCard wallet={wallet} />

      <nav className="flex gap-1 rounded-xl border border-edge bg-surface p-1">
        <TabButton active={tab === "channels"} onClick={() => setTab("channels")}>
          Channels
        </TabButton>
        <TabButton active={tab === "positions"} onClick={() => setTab("positions")}>
          Positions
        </TabButton>
      </nav>

      {tab === "channels" ? (
        <Channels
          channels={channels}
          subscriptions={subscriptions}
          onPick={(channel) => {
            haptic();
            setEditing(channel);
          }}
          onStop={async (subscription) => {
            await apiDelete(`/api/subscriptions?id=${encodeURIComponent(subscription.id)}`);
            setSubscriptions((current) => current.filter((item) => item.id !== subscription.id));
          }}
        />
      ) : (
        <Positions positions={positions} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-5 py-6">
      <h1 className="font-mono text-2xl font-semibold tracking-tight text-gold">Xzy</h1>
      {children}
      <footer className="mt-auto border-t border-edge pt-4">
        <p className="text-xs leading-relaxed text-faint">
          Copy trading memecoins loses money for most people who try it. Xzy does not vet the
          tokens a channel posts, and a listed channel is not a recommendation.
        </p>
      </footer>
    </main>
  );
}

function WalletCard({ wallet }: { wallet: Wallet | null }) {
  const [copied, setCopied] = useState(false);
  if (!wallet) return <div className="h-20 rounded-xl border border-edge bg-surface" />;

  return (
    <section className="rounded-xl border border-edge bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-faint">Balance</span>
        {!wallet.live && (
          <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gold">
            Simulation
          </span>
        )}
      </div>
      <p className="mt-1 font-mono text-2xl text-ink">
        {wallet.balanceSol === null ? "—" : wallet.balanceSol.toFixed(4)} <span className="text-sm text-muted">SOL</span>
      </p>
      <button
        onClick={async () => {
          await navigator.clipboard?.writeText(wallet.address).catch(() => {});
          setCopied(true);
          haptic();
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-2 w-full truncate rounded-lg border border-edge bg-surface2 px-2 py-1.5 text-left font-mono text-xs text-muted"
      >
        {copied ? "Address copied" : wallet.address}
      </button>
      <p className="mt-1.5 text-xs text-faint">Deposit SOL to this address to fund your copies.</p>
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-surface2 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Channels({
  channels,
  subscriptions,
  onPick,
  onStop
}: {
  channels: ChannelRow[];
  subscriptions: Subscription[];
  onPick: (channel: ChannelRow) => void;
  onStop: (subscription: Subscription) => void;
}) {
  if (channels.length === 0) {
    return (
      <Notice
        title="No channels available yet"
        body="Channels appear here once their owner adds the bot as an admin and the listing is reviewed."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {channels.map((channel) => {
        const subscription = subscriptions.find((item) => item.channelId === channel.id) ?? null;
        return (
          <article key={channel.id} className="rounded-xl border border-edge bg-surface px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{channel.title ?? "Untitled channel"}</p>
                {channel.username && <p className="truncate text-xs text-faint">@{channel.username}</p>}
              </div>
              <button
                onClick={() => onPick(channel)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                  subscription ? "border border-edge text-muted" : "bg-gold text-base"
                }`}
              >
                {subscription ? "Edit" : "Copy"}
              </button>
            </div>

            {subscription && (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge pt-2.5 font-mono text-xs text-muted">
                <span>{subscription.perTradeSol} SOL / call</span>
                <span className="text-faint">·</span>
                <span>max {subscription.maxDailySol}/day</span>
                {subscription.takeProfits.length > 0 && (
                  <>
                    <span className="text-faint">·</span>
                    <span className="text-up">
                      TP {subscription.takeProfits.map((level) => `+${level.gainPct}%`).join(" / ")}
                    </span>
                  </>
                )}
                {subscription.stopLossPct !== null && (
                  <>
                    <span className="text-faint">·</span>
                    <span className="text-down">SL −{subscription.stopLossPct}%</span>
                  </>
                )}
                <button onClick={() => onStop(subscription)} className="ml-auto text-faint hover:text-down">
                  Stop
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Positions({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return <Notice title="No positions yet" body="Copies from the channels you follow will show up here." />;
  }

  return (
    <div className="flex flex-col gap-2">
      {positions.map((position) => {
        const label = position.symbol ?? `${position.mint.slice(0, 4)}…${position.mint.slice(-4)}`;
        const up = (position.changePct ?? 0) >= 0;
        return (
          <article key={position.id} className="rounded-xl border border-edge bg-surface px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate font-medium text-ink">{label}</p>
              {/* Null change renders as an em dash, never as 0% — an unpriced position is
                  unknown, not flat. */}
              <span className={`shrink-0 font-mono text-sm ${position.changePct === null ? "text-faint" : up ? "text-up" : "text-down"}`}>
                {position.changePct === null ? "—" : `${up ? "+" : ""}${position.changePct.toFixed(1)}%`}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted">
              <span>{position.amountSol} SOL in</span>
              {position.realizedSol > 0 && <span className="text-up">{position.realizedSol.toFixed(4)} SOL out</span>}
              <span className="text-faint">
                {position.status === "open" ? `${position.remainingPct.toFixed(0)}% held` : position.status}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface px-4 py-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}
