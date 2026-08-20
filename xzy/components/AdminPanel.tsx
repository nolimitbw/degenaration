"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiPost } from "@/lib/miniapp";
import { Pill, Notice } from "./Stat";
import type { AdminChannel } from "@/lib/types";

/**
 * Channel review.
 *
 * Approving a channel is what lets its posts start moving other people's money, so the
 * screen leads with what is actually being decided — who listed it, how many members —
 * rather than presenting approval as a routine tap.
 */
export function AdminPanel() {
  const [channels, setChannels] = useState<AdminChannel[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch("/api/admin/channels");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        setChannels([]);
        return;
      }
      setChannels(((await res.json()) as { channels: AdminChannel[] }).channels);
    })();
  }, []);

  async function act(channel: AdminChannel, action: "approve" | "reject" | "unlist") {
    setBusy(channel.id);
    const res = await apiPost("/api/admin/channels", { channelId: channel.id, action });
    setBusy(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not update that channel.");
      return;
    }
    const { status } = (await res.json()) as { status: string };
    setChannels((current) =>
      (current ?? []).map((item) => (item.id === channel.id ? { ...item, status } : item))
    );
  }

  if (channels === null) return <Notice title="Loading" body="Fetching listed channels." />;
  if (error) return <Notice title="Could not load channels" body={error} />;
  if (channels.length === 0) {
    return <Notice title="Nothing listed yet" body="Channels appear here when an owner adds the bot as an admin." />;
  }

  const pending = channels.filter((channel) => channel.status === "pending");
  const rest = channels.filter((channel) => channel.status !== "pending");

  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wider text-faint">Waiting for review · {pending.length}</h2>
          {pending.map((channel) => (
            <Row key={channel.id} channel={channel} busy={busy === channel.id} onAct={act} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-wider text-faint">All channels</h2>
        {rest.map((channel) => (
          <Row key={channel.id} channel={channel} busy={busy === channel.id} onAct={act} />
        ))}
      </section>
    </div>
  );
}

const TONE = {
  approved: "up",
  pending: "gold",
  rejected: "down",
  removed: "neutral"
} as const;

function Row({
  channel,
  busy,
  onAct
}: {
  channel: AdminChannel;
  busy: boolean;
  onAct: (channel: AdminChannel, action: "approve" | "reject" | "unlist") => void;
}) {
  const tone = TONE[channel.status as keyof typeof TONE] ?? "neutral";

  return (
    <article className="rounded-xl border border-edge bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-ink">{channel.title ?? "Untitled"}</p>
            <Pill tone={tone}>{channel.status}</Pill>
          </div>
          <p className="truncate font-mono text-[11px] tabular-nums text-faint">
            {channel.username ? `@${channel.username}` : channel.chatId}
            {typeof channel.memberCount === "number" && ` · ${channel.memberCount.toLocaleString()} members`}
          </p>
          {channel.listedByTgId && (
            <p className="mt-0.5 font-mono text-[11px] text-faint">listed by {channel.listedByTgId}</p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex gap-2">
        {channel.status !== "approved" && (
          <button
            onClick={() => onAct(channel, "approve")}
            disabled={busy}
            className="rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-base disabled:opacity-50"
          >
            {busy ? "…" : "Approve"}
          </button>
        )}
        {channel.status === "approved" && (
          <button
            onClick={() => onAct(channel, "unlist")}
            disabled={busy}
            className="rounded-lg border border-edge px-3 py-1.5 text-sm text-muted disabled:opacity-50"
          >
            Unlist
          </button>
        )}
        {channel.status === "pending" && (
          <button
            onClick={() => onAct(channel, "reject")}
            disabled={busy}
            className="rounded-lg border border-edge px-3 py-1.5 text-sm text-muted disabled:opacity-50"
          >
            Reject
          </button>
        )}
      </div>
    </article>
  );
}
