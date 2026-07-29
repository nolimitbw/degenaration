import { safeDiscordImage } from "@/lib/external-url";

type SourceVisual = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
};

const FALLBACKS = [
  {
    backgroundColor: "#151515",
    backgroundImage:
      "linear-gradient(135deg, transparent 0 54%, rgba(185,139,93,.2) 54% 55%, transparent 55%), linear-gradient(45deg, rgba(255,255,255,.045) 25%, transparent 25% 75%, rgba(255,255,255,.045) 75%)"
  },
  {
    backgroundColor: "#111312",
    backgroundImage:
      "linear-gradient(120deg, rgba(185,139,93,.16) 0 18%, transparent 18% 72%, rgba(255,255,255,.04) 72%), linear-gradient(30deg, transparent 0 48%, rgba(185,139,93,.12) 48% 50%, transparent 50%)"
  },
  {
    backgroundColor: "#171513",
    backgroundImage:
      "linear-gradient(150deg, transparent 0 42%, rgba(185,139,93,.18) 42% 43%, transparent 43%), linear-gradient(60deg, rgba(255,255,255,.04) 0 20%, transparent 20% 80%, rgba(255,255,255,.04) 80%)"
  }
] as const;

function initials(name: string) {
  return name.trim().split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "D";
}

function patternIndex(source: SourceVisual) {
  return Array.from(source.id || source.name).reduce((total, character) => total + character.charCodeAt(0), 0) % FALLBACKS.length;
}

export function DiscordSourceBanner({ source, compact = false }: { source: SourceVisual; compact?: boolean }) {
  const bannerUrl = safeDiscordImage(source.bannerUrl);

  return (
    <div
      className={`relative isolate overflow-hidden border-b border-edge ${compact ? "aspect-[4/1]" : "aspect-[3/1]"}`}
      style={bannerUrl ? undefined : FALLBACKS[patternIndex(source)]}
      aria-label={bannerUrl ? `${source.name} server banner` : `${source.name} branded banner`}
      role="img"
    >
      {bannerUrl && <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,8,.75),transparent_68%)]" />
      <div className="absolute inset-y-0 left-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center border border-toxic/45 bg-[#111]/85 font-mono text-xs font-bold text-toxic">
          {initials(source.name)}
        </span>
        <span className="hidden font-mono text-[9px] uppercase text-white/70 sm:block">Verified Discord source</span>
      </div>
      <span className="absolute right-4 top-3 font-mono text-xs font-bold text-white/35">D/A</span>
    </div>
  );
}

export function DiscordSourceAvatar({ source, size = "md" }: { source: SourceVisual; size?: "sm" | "md" | "lg" }) {
  const avatarUrl = safeDiscordImage(source.avatarUrl);
  const dimensions = size === "lg" ? "h-16 w-16 text-base" : size === "sm" ? "h-10 w-10 text-xs" : "h-12 w-12 text-sm";

  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className={`${dimensions} shrink-0 rounded-md border border-edge object-cover`} />;
  }
  return (
    <span className={`grid ${dimensions} shrink-0 place-items-center rounded-md border border-toxic/35 bg-toxic/10 font-mono font-semibold text-toxic`}>
      {initials(source.name)}
    </span>
  );
}
