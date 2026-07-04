/**
 * DEGENARATION Discord Bot — call listener.
 *
 * How a group owner integrates:
 *  1. Admin invites the bot with the OAuth link (Read Messages + Message Content).
 *  2. The server owner types `!register` in the channel they post calls in.
 *  3. That channel shows up as PENDING in the site Admin panel; the owner approves it.
 *  4. From then on the bot forwards every call in that channel to the site (/api/ingest-call),
 *     which records it and the 24/7 worker mirrors it to that group's subscribers.
 *
 * The bot reads messages ONLY in APPROVED channels (loaded from the DB, refreshed live).
 */
require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");
const { parseCall } = require("./parser");
const { loadApprovedChannels, registerChannel } = require("./store");

const INGEST_URL = process.env.INGEST_URL;              // e.g. https://degenaration.vercel.app/api/ingest-call
const BOT_SECRET = process.env.BOT_SHARED_SECRET;
const REFRESH_MS = Number(process.env.CHANNELS_REFRESH_MS || 30000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Approved channels, refreshed from the DB so newly-approved servers work with no redeploy.
let approved = {};
async function refresh() {
  try { approved = await loadApprovedChannels(); }
  catch (e) { console.error("[bot] channel refresh failed:", e.message); }
}

client.once("ready", async () => {
  console.log(`[bot] logged in as ${client.user.tag}`);
  await refresh();
  console.log(`[bot] watching ${Object.keys(approved).length} approved channel(s)`);
  setInterval(refresh, REFRESH_MS);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  // Owner self-registration: `!register` in the channel they want watched.
  if (msg.content.trim().toLowerCase() === "!register") {
    const canManage = msg.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
    if (!canManage) { msg.reply("Only a server manager can register a call channel.").catch(() => {}); return; }
    try {
      await registerChannel({
        guildId: msg.guild.id, guildName: msg.guild.name,
        channelId: msg.channel.id, channelName: msg.channel.name,
        registeredBy: `${msg.author.username} (${msg.author.id})`
      });
      msg.reply("Channel submitted. It will start copying calls once Degenaration approves it.").catch(() => {});
    } catch (e) {
      console.error("[bot] register failed:", e.message);
      msg.reply("Could not register right now — try again shortly.").catch(() => {});
    }
    return;
  }

  // Otherwise: only act in APPROVED call channels.
  const group = approved[msg.channel.id];
  if (!group) return;

  const call = parseCall(msg.content);
  if (!call) return;
  console.log(`[call] ${group.groupName || group.groupId}: ${call.mint} (${call.confidence})`);

  if (!INGEST_URL || !BOT_SECRET) { console.error("[bot] INGEST_URL / BOT_SHARED_SECRET not set"); return; }
  try {
    const r = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": BOT_SECRET },
      body: JSON.stringify({ channelId: msg.channel.id, mint: call.mint, raw: msg.content.slice(0, 500), messageId: msg.id })
    });
    if (!r.ok) console.error(`[bot] ingest rejected (${r.status})`);
  } catch (e) {
    console.error("[bot] ingest failed:", e.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
