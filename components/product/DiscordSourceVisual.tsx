"use client";

import { useState } from "react";
import { safeDiscordImage } from "@/lib/external-url";

type SourceVisual = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

/**
 * The Discord server's own profile picture is the visual identity (spec §8.2).
 *
 * The previous `DiscordSourceBanner` was removed: it rendered a full-width fake cover
 * from three hardcoded geometric gradients with a "D/A" letter watermark, consuming a
 * 4:1 slice of every card to convey nothing. §8 prohibits artificial cover art and asks
 * for the real server avatar instead.
 */

function initials(name: string) {
  return name.trim().split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "D";
}

const SIZES = {
  sm: "h-10 w-10 text-xs",
  md: "h-14 w-14 text-sm",
  lg: "h-16 w-16 text-base"
} as const;

export function DiscordSourceAvatar({ source, size = "md" }: { source: SourceVisual; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState(false);
  const avatarUrl = safeDiscordImage(source.avatarUrl);
  const dimensions = SIZES[size];

  // A broken remote image must never leave an empty box, so a failed load falls back to
  // the initials treatment rather than rendering nothing (spec §8.2).
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={`${source.name} server icon`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${dimensions} shrink-0 rounded-md border border-edge bg-void object-cover`}
      />
    );
  }

  return (
    <span
      aria-label={`${source.name} server icon`}
      role="img"
      className={`grid ${dimensions} shrink-0 place-items-center rounded-md border border-gold-400/30 bg-gold-400/10 font-mono font-semibold text-gold-300`}
    >
      {initials(source.name)}
    </span>
  );
}

/** Integration health as a dot plus text — never colour alone (spec §5.6, WCAG). */
export function IntegrationHealthDot({ status }: { status?: string | null }) {
  const state = (status || "pending").toLowerCase();
  const tone =
    state === "healthy" || state === "active" || state === "connected" ? "bg-success"
      : state === "degraded" || state === "pending" ? "bg-warning"
        : "bg-danger";
  const label =
    state === "healthy" || state === "active" || state === "connected" ? "Connected"
      : state === "degraded" ? "Degraded"
        : state === "pending" ? "Connecting"
          : "Disconnected";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-dim">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
}
