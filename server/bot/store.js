/**
 * Bot data access — Supabase REST (service role), zero deps.
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (server-side only).
 */
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://degenaration.vercel.app").replace(/\/+$/, "");
const BOT_SECRET = process.env.BOT_SHARED_SECRET;
const REGISTER_URL = process.env.BOT_REGISTER_URL || (SITE_URL ? `${SITE_URL}/api/bot/register-channel` : "");
const APPROVED_URL = process.env.BOT_APPROVED_CHANNELS_URL || (SITE_URL ? `${SITE_URL}/api/bot/approved-channels` : "");
const STATUS_URL = process.env.BOT_GUILD_STATUS_URL || (SITE_URL ? `${SITE_URL}/api/bot/guild-status` : "");
const PROFILE_URL = process.env.BOT_SYNC_PROFILE_URL || (SITE_URL ? `${SITE_URL}/api/bot/sync-source-profile` : "");

function H(extra) {
  return { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extra };
}

/**
 * `{ channelId: { groupId, groupName, guildId } }` for every ACTIVE approved call channel.
 *
 * `guildId` is carried so the listener can check the guild/channel PAIR before forwarding.
 * Channel snowflakes are globally unique, so the pair check is not about a collision — it is
 * about the registration being stale. `source_ref` is built from the registered guild, and
 * every downstream projection keys on it, so a wrong guild attributes calls to the wrong
 * source with nothing able to notice.
 *
 * THE FALLBACK IS GONE, DELIBERATELY. It queried
 *
 *     call_channels?status=eq.approved
 *
 * which checks strictly LESS than the bridge: no `removed_at`, and no join to approved_groups
 * at all, so a suspended or removed source stayed in the map. A bridge outage therefore WIDENED
 * what the listener watched — the one direction an outage must never move authorization. The
 * caller keeps its last known good map instead, which can only ever be narrower or equal.
 */
async function loadApprovedChannels() {
  if (!APPROVED_URL || !BOT_SECRET) throw new Error("approved channel bridge not configured");
  const r = await fetch(APPROVED_URL, { headers: { "x-bot-secret": BOT_SECRET } });
  if (!r.ok) throw new Error(`approved channel query failed (${r.status})`);
  const data = await r.json();
  const map = {};
  for (const c of data?.channels || []) {
    map[c.channel_id] = {
      groupId: c.group_id,
      groupName: c.guild_name,
      guildId: c.guild_id,
      scannerAcknowledgmentsEnabled: c.scanner_acknowledgments_enabled !== false
    };
  }
  return map;
}

// Server owner ran /register — create a PENDING channel for admin approval (dedup on channel_id).
async function registerChannel({ guildId, guildName, guildMemberCount, channelId, channelName, registeredBy }) {
  if (REGISTER_URL && BOT_SECRET) {
    const response = await fetch(REGISTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": BOT_SECRET },
      body: JSON.stringify({
        guild_id: guildId,
        guild_name: guildName,
        guild_member_count: guildMemberCount,
        channel_id: channelId,
        channel_name: channelName,
        registered_by: registeredBy
      })
    });
    if (response.ok) return;
    console.error(`[bot] register bridge failed (${response.status}); falling back to Supabase`);
  }
  if (!SB || !KEY) throw new Error("channel registration not configured");
  const response = await fetch(`${SB}/rest/v1/call_channels`, {
    method: "POST",
    headers: H({ prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({
      guild_id: guildId, guild_name: guildName, channel_id: channelId,
      channel_name: channelName, guild_member_count: guildMemberCount,
      registered_by: registeredBy, status: "pending"
    })
  });
  if (!response.ok) throw new Error(`channel registration failed (${response.status})`);
}

async function getGuildStatus(guildId) {
  if (!STATUS_URL || !BOT_SECRET) throw new Error("guild status bridge not configured");
  const url = new URL(STATUS_URL);
  url.searchParams.set("guild_id", guildId);
  const response = await fetch(url, { headers: { "x-bot-secret": BOT_SECRET } });
  if (!response.ok) throw new Error(`guild status query failed (${response.status})`);
  return response.json();
}

/**
 * Push a guild's public profile to the marketplace.
 *
 * WHY THIS IS HERE. The marketplace card is required to show the real Discord server avatar
 * rather than generated cover art, and `approved_groups.avatar_url` is where it comes from.
 * This listener never wrote it — only the legacy `degencalls` service did, 56 successful syncs
 * — so retiring that service would have frozen every source's avatar, name and member count at
 * whatever they were on the day it stopped, with nothing raising. The retirement plan recorded
 * that dependency and it was the one duty still uncovered.
 *
 * Everything sent is already public: the guild's name, icon, banner, description, member count
 * and owner display name are visible to anyone who can see the server. No message content, no
 * member list, no invite.
 */
async function syncSourceProfile(guild, { botPresent = true } = {}) {
  if (!PROFILE_URL || !BOT_SECRET) throw new Error("source profile bridge not configured");
  const owner = await guild.fetchOwner?.().catch(() => null);
  const response = await fetch(PROFILE_URL, {
    method: "POST",
    headers: { "x-bot-secret": BOT_SECRET, "content-type": "application/json" },
    body: JSON.stringify({
      guild_id: guild.id,
      guild_name: guild.name ?? null,
      guild_member_count: guild.memberCount ?? null,
      // iconURL/bannerURL return null when the guild has none, which the route accepts. Asking
      // for png keeps the value stable — the default format varies with whether the icon is
      // animated, and a URL that changes shape on every sync defeats the route's validation.
      avatar_url: guild.iconURL?.({ size: 256, extension: "png" }) ?? null,
      banner_url: guild.bannerURL?.({ size: 1024, extension: "png" }) ?? null,
      description: guild.description ?? null,
      owner_display_name: owner?.displayName || owner?.user?.username || null,
      bot_present: botPresent
    })
  });
  if (!response.ok) throw new Error(`source profile sync failed (${response.status})`);
  return response.json().catch(() => ({}));
}

module.exports = { loadApprovedChannels, registerChannel, getGuildStatus, syncSourceProfile };
