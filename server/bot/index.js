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
const { loadApprovedChannels, registerChannel, getGuildStatus } = require("./store");

const INGEST_URL = process.env.INGEST_URL;              // e.g. https://degenaration.vercel.app/api/ingest-call
const BOT_SECRET = process.env.BOT_SHARED_SECRET;
const REFRESH_MS = Number(process.env.CHANNELS_REFRESH_MS || 30000);
const RELAY_CHANNEL_ID = process.env.RELAY_CHANNEL_ID || "";
const BOT_BUILD = process.env.BOT_BUILD || "source-tools-v2";
const SITE_URL = (process.env.SITE_URL || "https://degenaration.vercel.app").replace(/\/+$/, "");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const REGISTER_COMMAND = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Submit this channel as a Degenaration call source for admin approval.");

const ALPHA_COMMAND = new SlashCommandBuilder()
  .setName("alpha")
  .setDescription("Record a token call in an approved Degenaration channel.")
  .addStringOption((option) => option.setName("token").setDescription("Solana mint or supported token link").setRequired(true));

const DEGEN_COMMAND = new SlashCommandBuilder()
  .setName("degen")
  .setDescription("Manage and inspect this server's Degenaration source.")
  .addSubcommand((command) => command.setName("status").setDescription("Show registration and approval status."))
  .addSubcommand((command) => command.setName("profile").setDescription("Open this server's public performance profile."))
  .addSubcommand((command) => command.setName("referral").setDescription("Get this server's assigned referral link."))
  .addSubcommand((command) => command.setName("callers").setDescription("Show this server's most active recorded callers."))
  .addSubcommand((command) => command.setName("channel-add").setDescription("Submit this channel for approval."));

const ONBOARD_COMMAND = new SlashCommandBuilder()
  .setName("onboard")
  .setDescription("Show the Degenaration server onboarding steps.");

const HELP_COMMAND = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show Degenaration bot commands.");

const COMMANDS = [REGISTER_COMMAND, ALPHA_COMMAND, DEGEN_COMMAND, ONBOARD_COMMAND, HELP_COMMAND];

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

async function relayCall({ caller, channelName, group, call }) {
  if (!/^\d{17,20}$/.test(RELAY_CHANNEL_ID)) return;
  try {
    const channel = await client.channels.fetch(RELAY_CHANNEL_ID);
    if (!channel?.isTextBased?.() || typeof channel.send !== "function") throw new Error("relay channel is not text-based");
    await channel.send({
      allowedMentions: { parse: [] },
      embeds: [{
        color: 0x38bdf8,
        title: `New alpha call - ${group.groupName || "Discord source"}`,
        description: `\`${call.mint}\``,
        url: `https://dexscreener.com/solana/${call.mint}`,
        fields: [
          { name: "Caller", value: caller, inline: true },
          { name: "Channel", value: `#${String(channelName || "calls").slice(0, 80)}`, inline: true },
          { name: "Signal", value: call.confidence, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]
    });
  } catch (e) {
    console.error("[bot] relay failed:", e.message);
  }
}

async function ingestCall({ channelId, channelName, messageId, caller, group, call }) {
  if (!INGEST_URL || !BOT_SECRET) throw new Error("INGEST_URL / BOT_SHARED_SECRET not set");
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot-secret": BOT_SECRET },
    body: JSON.stringify({ channelId, channelName, mint: call.mint, messageId, caller, confidence: call.confidence })
  });
  if (!response.ok) throw new Error(`ingest rejected (${response.status})`);
  await relayCall({ caller, channelName, group, call });
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
    await guild.commands.set(COMMANDS.map((command) => command.toJSON()));
    console.log(`[bot] ${COMMANDS.length} slash commands ready in ${guild.name}`);
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
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  const reply = (content) => interaction.editReply({ content }).catch(() => {});

  if (interaction.commandName === "register" || (interaction.commandName === "degen" && interaction.options.getSubcommand() === "channel-add")) {
    await registerCallChannel({
      guild: interaction.guild,
      channel: interaction.channel,
      member: interaction.member,
      permissions: interaction.memberPermissions,
      user: interaction.user,
      reply
    });
    return;
  }

  if (interaction.commandName === "alpha") {
    const group = approved[interaction.channelId];
    if (!group) { await reply("This channel is not approved yet. A server manager can run /register first."); return; }
    const call = parseCall(interaction.options.getString("token", true));
    if (!call) { await reply("Send one valid Solana mint or a supported token link."); return; }
    try {
      await ingestCall({
        channelId: interaction.channelId,
        channelName: interaction.channel?.name,
        messageId: interaction.id,
        caller: String(interaction.member?.displayName || interaction.user.globalName || interaction.user.username).slice(0, 100),
        group,
        call: { ...call, confidence: "explicit" }
      });
      await reply(`Call recorded: ${call.mint}`);
    } catch (e) {
      console.error("[bot] slash alpha ingest failed:", e.message);
      await reply("The call could not be recorded right now. Try again shortly.");
    }
    return;
  }

  if (interaction.commandName === "onboard") {
    await reply("1. Add Degenaration with bot + applications.commands.\n2. Run /register in the calls channel.\n3. Wait for owner approval.\n4. Post one Solana mint or use /alpha.\n5. Use /degen profile to share the earned record.");
    return;
  }

  if (interaction.commandName === "help") {
    await reply("/register or /degen channel-add - submit this channel\n/alpha token - record an explicit call\n/degen status - approval state\n/degen profile - public performance\n/degen referral - assigned server link\n/degen callers - recorded caller activity\n/onboard - setup steps");
    return;
  }

  if (interaction.commandName !== "degen") return;
  const subcommand = interaction.options.getSubcommand();
  try {
    const status = await getGuildStatus(interaction.guildId);
    if (subcommand === "status") {
      if (!status.channels?.length) { await reply("No channel submitted yet. Run /register in your calls channel."); return; }
      const lines = status.channels.slice(0, 8).map((channel) => `#${channel.channel_name || channel.channel_id}: ${String(channel.status).toUpperCase()}`);
      await reply(`Degenaration status\n${lines.join("\n")}${status.profile?.public_slug ? `\nProfile: ${SITE_URL}/source/${status.profile.public_slug}` : ""}`);
      return;
    }
    if (!status.profile?.public_slug) { await reply("This server does not have an approved public source yet."); return; }
    if (subcommand === "profile") { await reply(`${status.profile.name}: ${SITE_URL}/source/${status.profile.public_slug}`); return; }
    if (subcommand === "referral") { await reply(`${SITE_URL}/r/${status.profile.referral_code}`); return; }
    if (subcommand === "callers") {
      const callers = status.topCallers || [];
      await reply(callers.length
        ? callers.map((caller, index) => `${index + 1}. ${caller.name} - ${caller.calls} call${caller.calls === 1 ? "" : "s"}`).join("\n")
        : "No callers have recorded calls yet.");
    }
  } catch (e) {
    console.error("[bot] command status failed:", e.message);
    await reply("Degenaration status is temporarily unavailable.");
  }
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

  try {
    await ingestCall({
      channelId: msg.channel.id,
      channelName: msg.channel.name,
      messageId: msg.id,
      caller: callerName(msg),
      group,
      call
    });
  } catch (e) {
    console.error("[bot] ingest failed:", e.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
