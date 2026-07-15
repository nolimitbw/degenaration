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
  }>;
};

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
    .select("id,name,members,tag,bio,avatar_url,discord_invite_url,public_slug,referral_code,created_at")
    .eq("active", true)
    .eq("public_slug", slug)
    .maybeSingle();
  if (error || !group?.public_slug || !group?.referral_code) return null;

  const fields = "id,group_id,group_name,caller,mint,symbol,called_mcap,peak_mcap,latest_mcap,called_price_usd,peak_price_usd,latest_price_usd,called_at";
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
    bio: group.bio,
    avatarUrl: group.avatar_url,
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
      currentX: currentMultiple(call)
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
