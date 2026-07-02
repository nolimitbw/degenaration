/**
 * DEGENARATION Discord Bot — call listener
 * Invite-only: server owners add this bot after admin approval.
 * Reads messages ONLY in channels registered as call channels.
 */
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { parseCall } = require("./parser");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Approved call channels: { channelId: { groupId, groupName } }
// In production this comes from the database (admin approval panel).
const APPROVED_CHANNELS = JSON.parse(process.env.APPROVED_CHANNELS || "{}");

client.on("ready", () => {
  console.log(`[bot] logged in as ${client.user.tag}`);
  console.log(`[bot] watching ${Object.keys(APPROVED_CHANNELS).length} approved channel(s)`);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  const group = APPROVED_CHANNELS[msg.channel.id];
  if (!group) return; // not an approved call channel — ignore entirely

  const call = parseCall(msg.content);
  if (!call) return;

  console.log(`[call] ${group.groupName}: ${call.mint} (${call.confidence})`);

  // Forward to trading engine — engine does rug-check + per-user execution
  try {
    await fetch(process.env.ENGINE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": process.env.BOT_SHARED_SECRET
      },
      body: JSON.stringify({
        groupId: group.groupId,
        mint: call.mint,
        raw: msg.content.slice(0, 500),
        messageId: msg.id,
        ts: Date.now()
      })
    });
  } catch (e) {
    console.error("[bot] engine webhook failed:", e.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
