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

function H(extra) {
  return { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extra };
}

// { channelId: { groupId, groupName } } for every APPROVED call channel.
async function loadApprovedChannels() {
  if (APPROVED_URL && BOT_SECRET) {
    const r = await fetch(APPROVED_URL, { headers: { "x-bot-secret": BOT_SECRET } });
    if (r.ok) {
      const data = await r.json();
      const map = {};
      for (const c of data?.channels || []) map[c.channel_id] = { groupId: c.group_id, groupName: c.guild_name };
      return map;
    }
    console.error(`[bot] approved channel bridge failed (${r.status}); falling back to Supabase`);
  }
  if (!SB || !KEY) throw new Error("approved channel query not configured");
  const r = await fetch(`${SB}/rest/v1/call_channels?status=eq.approved&select=channel_id,group_id,guild_name`, { headers: H() });
  if (!r.ok) throw new Error(`approved channel query failed (${r.status})`);
  const rows = await r.json();
  const map = {};
  for (const c of rows || []) map[c.channel_id] = { groupId: c.group_id, groupName: c.guild_name };
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

module.exports = { loadApprovedChannels, registerChannel, getGuildStatus };
