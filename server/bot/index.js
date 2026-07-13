/**
 * DEGENARATION Discord Bot — call listener.
 *
 * How a group owner integrates:
 *  1. Admin invites the bot with the OAuth link (Read Messages + Message Content).
 *  2. The server owner runs `/register` in the channel they post calls in.
 *  3. That channel shows up as PENDING in the site Admin panel; the owner approves it.
 *  4. From then on the bot forwards every call in that channel to the site (/api/ingest-call),
 *     which records it and the 24/7 worker mirrors it to that group's subscribers.
 *
 * The bot reads messages ONLY in APPROVED channels (loaded from the DB, refreshed live).
 */
require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder } = require("discord.js");
const { parseCall } = require("./parser");
const { loadApprovedChannels, registerChannel } = require("./store");

const INGEST_URL = process.env.INGEST_URL;              // e.g. https://degenaration.vercel.app/api/ingest-call
const BOT_SECRET = process.env.BOT_SHARED_SECRET;
const REFRESH_MS = Number(process.env.CHANNELS_REFRESH_MS || 30000);
const RELAY_CHANNEL_ID = process.env.RELAY_CHANNEL_ID || "";
const BOT_BUILD = process.env.BOT_BUILD || "slash-register-v1";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const REGISTER_COMMAND = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Submit this channel as a Degenaration call source for admin approval.");

// Approved channels, refreshed from the DB so newly-approved servers work with no redeploy.
let approved = {};
async function refresh() {
  try { approved = await loadApprovedChannels(); }
  catch (e) { console.error("[bot] channel refresh failed:", e.message); }
}

function callerName(msg) {
  return String(msg.member?.displayName || msg.author.globalName || msg.author.username || "Discord caller").slice(0, 100);
}

function canManageGuild(member, permissions) {
  const source = permissions || member?.permissions;
  if (typeof source?.has === "function") return source.has(PermissionsBitField.Flags.ManageGuild);
  try { return new PermissionsBitField(BigInt(source || 0)).has(PermissionsBitField.Flags.ManageGuild); }
  catch { return false; }
}

async function relayCall(msg, group, call) {
  if (!/^\d{17,20}$/.test(RELAY_CHANNEL_ID)) return;
  try {
    const channel = await client.channels.fetch(RELAY_CHANNEL_ID);
    if (!channel?.isTextBased?.() || typeof channel.send !== "function") throw new Error("relay channel is not text-based");
    await channel.send({
      allowedMentions: { parse: [] },
      embeds: [{
        color: 0xa3ff12,
        title: `New alpha call - ${group.groupName || "Discord source"}`,
        description: `\`${call.mint}\``,
        url: `https://dexscreener.com/solana/${call.mint}`,
        fields: [
          { name: "Caller", value: callerName(msg), inline: true },
          { name: "Channel", value: `#${String(msg.channel.name || "calls").slice(0, 80)}`, inline: true },
          { name: "Signal", value: call.confidence, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]
    });
  } catch (e) {
    console.error("[bot] relay failed:", e.message);
  }
}

async function registerCallChannel({ guild, channel, member, permissions, user, reply }) {
  if (!channel?.id || !channel?.name) {
    await reply("Run /register inside the Discord channel where calls are posted.");
    return;
  }
  const canManage = canManageGuild(member, permissions);
  if (!canManage) {
    await reply("Only a server manager can register a call channel.");
    return;
  }
  try {
    await registerChannel({
      guildId: guild.id,
      guildName: guild.name,
      guildMemberCount: guild.memberCount,
      channelId: channel.id,
      channelName: channel.name,
      registeredBy: user.username
    });
    await reply("Channel submitted. It will start copying calls once Degenaration approves it.");
  } catch (e) {
    console.error("[bot] register failed:", e.message);
    await reply("Could not register right now — try again shortly.");
  }
}

async function syncRegisterCommand(guild) {
  try {
    await guild.commands.set([REGISTER_COMMAND.toJSON()]);
    console.log(`[bot] slash command ready in ${guild.name}`);
  } catch (e) {
    console.error(`[bot] slash command sync failed for ${guild.name}:`, e.message);
  }
}

client.once("ready", async () => {
  console.log(`[bot] logged in as ${client.user.tag}`);
  console.log(`[bot] build ${BOT_BUILD}`);
  await Promise.allSettled(client.guilds.cache.map((guild) => syncRegisterCommand(guild)));
  await refresh();
  console.log(`[bot] watching ${Object.keys(approved).length} approved channel(s)`);
  setInterval(refresh, REFRESH_MS);
});

client.on("guildCreate", (guild) => {
  syncRegisterCommand(guild);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "register" || !interaction.guild) return;
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  await registerCallChannel({
    guild: interaction.guild,
    channel: interaction.channel,
    member: interaction.member,
    permissions: interaction.memberPermissions,
    user: interaction.user,
    reply: (content) => interaction.editReply({ content }).catch(() => {})
  });
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  // Legacy fallback: `!register` in the channel they want watched.
  if (msg.content.trim().toLowerCase() === "!register") {
    await registerCallChannel({
      guild: msg.guild,
      channel: msg.channel,
      member: msg.member,
      user: msg.author,
      reply: (content) => msg.reply(content).catch(() => {})
    });
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
      body: JSON.stringify({
        channelId: msg.channel.id, channelName: msg.channel.name, mint: call.mint,
        messageId: msg.id, caller: callerName(msg), confidence: call.confidence
      })
    });
    if (!r.ok) { console.error(`[bot] ingest rejected (${r.status})`); return; }
    await relayCall(msg, group, call);
  } catch (e) {
    console.error("[bot] ingest failed:", e.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
