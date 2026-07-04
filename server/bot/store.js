/**
 * Bot data access — Supabase REST (service role), zero deps.
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (server-side only).
 */
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

function H(extra) {
  return { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extra };
}

// { channelId: { groupId, groupName } } for every APPROVED call channel.
async function loadApprovedChannels() {
  const r = await fetch(`${SB}/rest/v1/call_channels?status=eq.approved&select=channel_id,group_id,guild_name`, { headers: H() });
  const rows = await r.json();
  const map = {};
  for (const c of rows || []) map[c.channel_id] = { groupId: c.group_id, groupName: c.guild_name };
  return map;
}

// Server owner ran /register — create a PENDING channel for admin approval (dedup on channel_id).
async function registerChannel({ guildId, guildName, channelId, channelName, registeredBy }) {
  return fetch(`${SB}/rest/v1/call_channels`, {
    method: "POST",
    headers: H({ prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({
      guild_id: guildId, guild_name: guildName, channel_id: channelId,
      channel_name: channelName, registered_by: registeredBy, status: "pending"
    })
  });
}

module.exports = { loadApprovedChannels, registerChannel };
