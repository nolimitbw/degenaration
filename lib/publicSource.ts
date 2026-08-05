import "server-only";
import { createServerClient } from "@supabase/ssr";
import { currentMultiple, peakMultiple, sourceMetrics, type PerformanceCall } from "@/lib/callPerformance";

const SOURCE_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;

export type PublicSource = {
  id: string;
  name: string;
  members: string | null;
  tag: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  ownerDisplayName: string | null;
  integrationHealth: string;
  profileSyncedAt: string | null;
  discordInviteUrl: string | null;
  publicSlug: string;
  referralCode: string;
  createdAt: string;
  metrics: ReturnType<typeof sourceMetrics>;
  recentCalls: Array<{
    id: string;
    mint: string | null;
    symbol: string | null;
    caller: string | null;
    calledAt: string | null;
    peakX: number | null;
    currentX: number | null;
    // The immutable call-time snapshot. Recorded when the call was journaled and never
    // recomputed, so a reader can see the number the call was made at rather than a figure
    // derived from today's price.
    calledPriceUsd: number | null;
    calledMcapUsd: number | null;
    calledLiquidityUsd: number | null;
  }>;
};

/**
 * A recorded figure, or null.
 *
 * Zero is returned as null on purpose: `called_price_usd = 0` means the enrichment found no
 * pair, not that the token was worth nothing, and rendering "$0.00" as a call price would be
 * a fabricated number rather than an absent one.
 */
function numeric(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
}

export async function getPublicSource(slug: string): Promise<PublicSource | null> {
  if (!SOURCE_KEY.test(slug)) return null;
  const supa = client();
  if (!supa) return null;

  const { data: group, error } = await supa
    .from("approved_groups")
    .select("id,name,members,tag,bio,discord_description,avatar_url,banner_url,owner_display_name,integration_health,profile_synced_at,discord_invite_url,public_slug,referral_code,created_at")
    .eq("active", true)
    .eq("marketplace_visible", true)
    .eq("verification_status", "approved")
    .is("removed_at", null)
    .is("suspended_at", null)
    .eq("public_slug", slug)
    .maybeSingle();
  if (error || !group?.public_slug || !group?.referral_code) return null;

  // called_liquidity_usd joins the primary list only. legacyFields is the fallback for a
  // schema that predates the price columns, so adding a newer column there would make the
  // fallback fail for exactly the rows it exists to rescue.
  const fields = "id,group_id,group_name,caller,mint,symbol,called_mcap,peak_mcap,latest_mcap,called_price_usd,peak_price_usd,latest_price_usd,called_liquidity_usd,called_at";
  const legacyFields = "id,group_id,group_name,caller,mint,symbol,called_mcap,peak_mcap,called_at";
  const primary = await supa.from("calls").select(fields).eq("group_id", group.id).order("called_at", { ascending: false }).limit(1000);
  const fallback = primary.error
    ? await supa.from("calls").select(legacyFields).eq("group_id", group.id).order("called_at", { ascending: false }).limit(1000)
    : null;
  const calls = ((fallback?.data ?? primary.data ?? []) as unknown) as PerformanceCall[];

  return {
    id: group.id,
    name: group.name,
    members: group.members,
    tag: group.tag,
    bio: group.bio || group.discord_description || "Approved Discord source building a measured call history on DegenAration.",
    avatarUrl: group.avatar_url,
    bannerUrl: group.banner_url,
    ownerDisplayName: group.owner_display_name,
    integrationHealth: group.integration_health,
    profileSyncedAt: group.profile_synced_at,
    discordInviteUrl: group.discord_invite_url,
    publicSlug: group.public_slug,
    referralCode: group.referral_code,
    createdAt: group.created_at,
    metrics: sourceMetrics(calls),
    recentCalls: calls.slice(0, 20).map((call) => ({
      id: call.id,
      mint: call.mint ?? null,
      symbol: call.symbol ?? null,
      caller: call.caller ?? null,
      calledAt: call.called_at ?? null,
      peakX: peakMultiple(call),
      currentX: currentMultiple(call),
      calledPriceUsd: numeric(call.called_price_usd),
      calledMcapUsd: numeric(call.called_mcap),
      calledLiquidityUsd: numeric((call as { called_liquidity_usd?: unknown }).called_liquidity_usd)
    }))
  };
}

export async function getSourceSlugByReferral(code: string): Promise<string | null> {
  if (!/^dg[a-f0-9]{10}$/.test(code)) return null;
  const supa = client();
  if (!supa) return null;
  const { data } = await supa
    .from("approved_groups")
    .select("public_slug")
    .eq("active", true)
    .eq("referral_code", code)
    .maybeSingle();
  return data?.public_slug ?? null;
}
