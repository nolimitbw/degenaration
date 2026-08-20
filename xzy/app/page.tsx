"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiDelete, getWebApp, getInitData, haptic } from "@/lib/miniapp";
import { CopySetup } from "@/components/CopySetup";
import { ChannelCard } from "@/components/ChannelCard";
import { AdminPanel } from "@/components/AdminPanel";
import { Metric, Pill, Notice, formatPct } from "@/components/Stat";
import type { Me, ChannelRow, Subscription, Wallet, Position } from "@/lib/types";

type Tab = "channels" | "positions" | "review";

type Phase =
  | { name: "loading" }
  | { name: "outside-telegram" }
  | { name: "unauthorized"; reason: string }
  | { name: "ready" };

export default function Home() {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [me, setMe] = useState<Me | null>(null);
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

    // The wallet endpoint creates one on first read, so this call is also onboarding.
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

  if (phase.name === "loading") {
    return (
      <Shell>
        <Notice title="Loading" body="Checking your Telegram session." />
      </Shell>
    );
  }

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
          existing={subscriptions.find((sub) => sub.channelId === editing.id) ?? null}
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

  const open = positions.filter((position) => position.status === "open");

  return (
    <Shell>
      <WalletCard wallet={wallet} positions={open} />

      <nav className="flex gap-1 rounded-xl border border-edge bg-surface p-1">
        <TabButton active={tab === "channels"} onClick={() => setTab("channels")}>
          Channels
        </TabButton>
        <TabButton active={tab === "positions"} onClick={() => setTab("positions")}>
          Positions{open.length > 0 && ` · ${open.length}`}
        </TabButton>
        {me?.isAdmin && (
          <TabButton active={tab === "review"} onClick={() => setTab("review")}>
            Review
          </TabButton>
        )}
      </nav>

      {tab === "channels" && (
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
      )}

      {tab === "positions" && <Positions positions={positions} />}
      {tab === "review" && me?.isAdmin && <AdminPanel />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-5 pb-6 pt-5">
      <h1 className="font-mono text-xl font-semibold tracking-tight text-gold">Xzy</h1>
      {children}
      <footer className="mt-auto border-t border-edge pt-4">
        <p className="text-[11px] leading-relaxed text-faint">
          Copy trading memecoins loses money for most people who try it. Xzy does not vet the
          tokens a channel posts, and a listed channel is not a recommendation.
        </p>
      </footer>
    </main>
  );
}

function WalletCard({ wallet, positions }: { wallet: Wallet | null; positions: Position[] }) {
  const [copied, setCopied] = useState(false);
  if (!wallet) return <div className="h-28 animate-pulse rounded-xl border border-edge bg-surface" />;

  // Only positions we could actually price contribute. An unpriced one is excluded rather
  // than counted flat, so the total never quietly understates a move.
  const priced = positions.filter((position) => position.changePct !== null);
  const openSol = positions.reduce((sum, position) => sum + position.amountSol, 0);

  return (
    <section className="rounded-xl border border-edge bg-surface px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-faint">Wallet</span>
        {!wallet.live && <Pill tone="gold">Simulation</Pill>}
      </div>

      <p className="mt-1 font-mono text-3xl tabular-nums text-ink">
        {wallet.balanceSol === null ? "—" : wallet.balanceSol.toFixed(4)}
        <span className="ml-1.5 text-sm text-muted">SOL</span>
      </p>

      {positions.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-edge pt-3">
          <Metric label="Open" value={String(positions.length)} />
          <Metric label="Deployed" value={`${openSol.toFixed(3)}`} />
          <Metric
            label="Unpriced"
            value={String(positions.length - priced.length)}
            tone={positions.length - priced.length > 0 ? "down" : "neutral"}
          />
        </div>
      )}

      <button
        onClick={async () => {
          await navigator.clipboard?.writeText(wallet.address).catch(() => {});
          setCopied(true);
          haptic();
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-3 w-full truncate rounded-lg border border-edge bg-surface2 px-2.5 py-2 text-left font-mono text-[11px] text-muted transition-colors hover:border-goldDim"
      >
        {copied ? "Address copied" : wallet.address}
      </button>
      <p className="mt-1.5 text-[11px] text-faint">Deposit SOL here to fund your copies.</p>
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
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
        body="Channels appear here once their owner adds the bot as an admin and the listing is reviewed. Send /list to the bot to list your own."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {channels.map((channel) => {
        const subscription = subscriptions.find((item) => item.channelId === channel.id) ?? null;
        return (
          <ChannelCard
            key={channel.id}
            channel={channel}
            subscription={subscription}
            onPick={() => onPick(channel)}
            onStop={() => subscription && onStop(subscription)}
          />
        );
      })}
    </div>
  );
}

function Positions({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return <Notice title="No positions yet" body="Copies from the channels you follow show up here." />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {positions.map((position) => {
        const label = position.symbol ?? `${position.mint.slice(0, 4)}…${position.mint.slice(-4)}`;
        const up = (position.changePct ?? 0) >= 0;
        const closed = position.status !== "open";

        return (
          <article key={position.id} className="rounded-xl border border-edge bg-surface px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate font-medium text-ink">{label}</h3>
                {closed && <Pill>{position.status}</Pill>}
              </div>
              <span
                className={`shrink-0 font-mono text-base tabular-nums ${
                  position.changePct === null ? "text-faint" : up ? "text-up" : "text-down"
                }`}
              >
                {formatPct(position.changePct, true) ?? "—"}
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-3 border-t border-edge pt-2.5">
              <Metric label="In" value={`${position.amountSol} SOL`} />
              <Metric
                label="Out"
                value={position.realizedSol > 0 ? `${position.realizedSol.toFixed(4)} SOL` : null}
                tone="up"
              />
              <Metric label="Held" value={`${position.remainingPct.toFixed(0)}%`} />
            </div>

            {/* Remaining size as a bar: how much of the position is still exposed reads
                faster than a percentage when scanning a list. */}
            {!closed && (
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface2">
                <div
                  className="h-full rounded-full bg-gold transition-all"
                  style={{ width: `${Math.max(2, Math.min(100, position.remainingPct))}%` }}
                />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
