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
const http = require("http");
const { Client, GatewayIntentBits, Partials, PermissionsBitField, SlashCommandBuilder } = require("discord.js");
const { parseCall, parseMessage } = require("./parser");
const {
  loadApprovedChannels, registerChannel, getGuildStatus, syncSourceProfile, createOwnerLink,
  getHistoryBackfillState, saveHistoryBackfillState
} = require("./store");
const { classifyDeliveryFailure, nextBackoffMs, buildIngestPayload, DeadLetterQueue } = require("./ingest");
const { createMessageHandlers, IngestedMessages } = require("./handlers");
const { buildRuntimeHealth } = require("./runtime-health");
const { backfillApprovedChannels } = require("./history-backfill");
const {
  scannerAcknowledgmentsEnabled,
  isFreshAcceptedIngest,
  buildScannerAcknowledgment
} = require("./acknowledgment");

const INGEST_URL = process.env.INGEST_URL;              // e.g. https://degenaration.vercel.app/api/ingest-call
const BOT_SECRET = process.env.BOT_SHARED_SECRET;
const REFRESH_MS = Number(process.env.CHANNELS_REFRESH_MS || 30000);
const RELAY_CHANNEL_ID = process.env.RELAY_CHANNEL_ID || "";
const BOT_BUILD = process.env.BOT_BUILD || "source-tools-v2";
const SITE_URL = (process.env.SITE_URL || "https://degenaration.vercel.app").replace(/\/+$/, "");
const SCANNER_ACKNOWLEDGMENTS = process.env.SCANNER_ACKNOWLEDGMENTS;
const HEALTH_PORT = Number(process.env.BOT_HEALTH_PORT || process.env.PORT || 10001);
const HEALTH_HOST = process.env.HEALTH_HOST || "0.0.0.0";
const HISTORY_BACKFILL_ENABLED = process.env.HISTORY_BACKFILL_ENABLED !== "off";
const HISTORY_BACKFILL_MAX_MESSAGES = Math.max(100, Number(process.env.HISTORY_BACKFILL_MAX_MESSAGES || 50000));

const INGEST_ATTEMPTS = Math.max(1, Number(process.env.INGEST_MAX_ATTEMPTS || 5));
// Declared with the other configuration rather than beside its setInterval: the ready handler
// reads it, and although that runs after module evaluation, depending on temporal-dead-zone
// ordering for a constant is a footgun for whoever moves this code next.
const PROFILE_SYNC_MS = Number(process.env.BOT_PROFILE_SYNC_MS || 21600000); // 6h

/**
 * Which of several candidate addresses is the tradable token, or null when that is not
 * knowable. Exactly one candidate having a Solana market is not a guess — a wallet address,
 * a pool id and a transaction signature all have none.
 *
 * DexScreener is already the price source for every accepted call, so this adds no new
 * dependency. A provider failure resolves nothing and the parser's refusal stands.
 */
async function resolveTradable(addresses) {
  const tradable = [];
  for (const address of addresses) {
    const payload = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      signal: AbortSignal.timeout(6_000)
    }).then((r) => r.json()).catch(() => null);
    const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
    // baseToken, not either side: a quote-side match would make wSOL or USDC "tradable" for
    // every call that happens to mention them.
    if (pairs.some((pair) => pair?.chainId === "solana" && pair?.baseToken?.address === address)) {
      tradable.push(address);
    }
    if (tradable.length > 1) return null; // genuinely ambiguous; stop paying for lookups
  }
  return tradable.length === 1 ? tradable[0] : null;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  // Without partials, discord.js drops MESSAGE_UPDATE and MESSAGE_DELETE for any message it
  // does not already hold in cache — which is every message posted before this process
  // started, and every message evicted since. Automated call bots edit their embed seconds
  // after posting (price, market cap and liquidity settle, or a "migrated" badge appears),
  // so the edit that completes a call is exactly the event most likely to arrive uncached.
  //
  // Partials.Message is what lets that event through at all; Channel and Reaction are
  // included because discord.js requires the owning structures to be partial-capable for the
  // message partial to resolve.
  partials: [Partials.Message, Partials.Channel]
});

const deadLetters = new DeadLetterQueue();

/** Message IDs this process successfully ingested; see handlers.js. */
const ingestedMessages = new IngestedMessages();

/**
 * One line per event: a text prefix, then the JSON payload.
 *
 * The prefix is not decoration. This previously wrote bare `JSON.stringify(...)`, and Railway
 * parses a log line that is valid JSON into structured attributes — which leaves the line's
 * `message` field EMPTY. Every structured event this process emitted therefore rendered as a
 * blank line in the log viewer and matched no text search, so the listener looked completely
 * silent for a week while it was in fact logging. Diagnosing an ingestion fault against a log
 * that swallows exactly the lines you need is not possible, and that is most of why E-2 took
 * as long as it did.
 *
 * `[bot] <event> {...}` keeps the line human-readable and greppable, and the JSON after it
 * stays machine-parseable.
 */
function log(event, fields = {}) {
  console.log(`[bot] ${event} ${JSON.stringify({ ts: new Date().toISOString(), ...fields })}`);
}

/**
 * Ingestion freshness, per approved channel.
 *
 * Answers the question a source owner actually asks — "is the bot seeing my calls?" —
 * which neither the marketplace nor the admin console can answer, because both read the
 * journal and a bot that detects nothing writes nothing to it. Absence of data there is
 * indistinguishable from a quiet channel; this distinguishes them.
 */
const freshness = new Map();
function noteFreshness(channelId, field) {
  const entry = freshness.get(channelId) || {};
  entry[field] = new Date().toISOString();
  freshness.set(channelId, entry);
}
const since = (iso) => {
  if (!iso) return "never";
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const REGISTER_COMMAND = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Submit this channel as a Degenaration call source for admin approval.");

const ALPHA_COMMAND = new SlashCommandBuilder()
  .setName("alpha")
  .setDescription("Record a token call in an approved Degenaration channel.")
  .addStringOption((option) => option.setName("token").setDescription("Solana mint or supported token link").setRequired(true));

// /degen channel-add was removed: it did exactly what /register does, and the handler
// routed both to the same function. Two published ways to perform one action is the
// overlap spec 15.2 prohibits.
const DEGEN_COMMAND = new SlashCommandBuilder()
  .setName("degen")
  .setDescription("Manage and inspect this server's Degenaration source.")
  .addSubcommand((command) => command.setName("status").setDescription("Show registration and approval status."))
  .addSubcommand((command) => command.setName("profile").setDescription("Open this server's public performance profile."))
  .addSubcommand((command) => command.setName("referral").setDescription("Get this server's assigned referral link."))
  .addSubcommand((command) => command.setName("callers").setDescription("Show this server's most active recorded callers."));

const TEST_CALL_COMMAND = new SlashCommandBuilder()
  .setName("test-call")
  .setDescription("Check that Degenaration can parse a token link. Never places a trade.")
  .addStringOption((option) => option.setName("token").setDescription("Solana mint or supported token link").setRequired(true));

const ONBOARD_COMMAND = new SlashCommandBuilder()
  .setName("onboard")
  .setDescription("Show the Degenaration server onboarding steps.");

const HELP_COMMAND = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show Degenaration bot commands.");

const CONNECT_COMMAND = new SlashCommandBuilder()
  .setName("connect")
  .setDescription("Securely connect a server owner to Degenaration.")
  .addSubcommand((command) => command.setName("discord").setDescription("Link this server to your signed-in Degenaration account."));

const COMMANDS = [REGISTER_COMMAND, ALPHA_COMMAND, DEGEN_COMMAND, TEST_CALL_COMMAND, ONBOARD_COMMAND, HELP_COMMAND, CONNECT_COMMAND];

// Approved channels, refreshed from the DB so newly-approved servers work with no redeploy.
let approved = {};
const runtimeHealth = {
  approvedRefresh: { lastSuccessAt: null, lastError: null },
  commands: { lastSuccessAt: null, lastError: null },
  registration: { attempts: 0, succeeded: 0, failed: 0, lastSuccessAt: null, lastFailureAt: null },
  historyBackfill: {
    enabled: HISTORY_BACKFILL_ENABLED,
    running: false,
    completedChannels: 0,
    messagesScanned: 0,
    lastSuccessAt: null,
    lastError: null
  }
};
async function refresh() {
  try {
    approved = await loadApprovedChannels();
    runtimeHealth.approvedRefresh.lastSuccessAt = new Date().toISOString();
    runtimeHealth.approvedRefresh.lastError = null;
  }
  catch (e) {
    runtimeHealth.approvedRefresh.lastError = String(e.message).slice(0, 160);
    console.error("[bot] channel refresh failed:", e.message);
  }
}

let backfillPromise = null;
function startHistoryBackfill() {
  if (!HISTORY_BACKFILL_ENABLED || backfillPromise) return backfillPromise;
  runtimeHealth.historyBackfill.running = true;
  runtimeHealth.historyBackfill.lastError = null;
  backfillPromise = backfillApprovedChannels({
    client,
    approvedChannels: approved,
    getState: getHistoryBackfillState,
    saveState: saveHistoryBackfillState,
    ingestMessage: (message) => listener.onHistoricalMessage(message),
    maxMessagesPerChannel: HISTORY_BACKFILL_MAX_MESSAGES,
    log
  }).then((summary) => {
    runtimeHealth.historyBackfill.completedChannels = summary.completedChannels;
    runtimeHealth.historyBackfill.messagesScanned += summary.messagesScanned;
    runtimeHealth.historyBackfill.lastSuccessAt = new Date().toISOString();
  }).catch((error) => {
    runtimeHealth.historyBackfill.lastError = String(error?.message || error).slice(0, 160);
    log("history.backfill.failed", { error: runtimeHealth.historyBackfill.lastError });
  }).finally(() => {
    runtimeHealth.historyBackfill.running = false;
    backfillPromise = null;
  });
  return backfillPromise;
}

/**
 * Keep every guild's public profile current.
 *
 * Counted rather than assumed successful: a marketplace avatar that silently stopped updating
 * is indistinguishable from one that never changes, so the heartbeat reports the tally and a
 * failure names the guild.
 */
const profileSync = { attempts: 0, succeeded: 0, failed: 0, lastError: null };
async function syncAllProfiles() {
  const guilds = [...(client.guilds?.cache?.values?.() ?? [])];
  for (const guild of guilds) {
    profileSync.attempts += 1;
    try {
      await syncSourceProfile(guild);
      profileSync.succeeded += 1;
    } catch (e) {
      profileSync.failed += 1;
      profileSync.lastError = e.message;
      log("profile.sync.failed", { guildId: guild.id, error: e.message });
    }
  }
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

/** One delivery attempt. Separated so the retry loop can classify the outcome uniformly. */
async function postIngest(payload) {
  try {
    const response = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": BOT_SECRET },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (e) {
    return { ok: false, networkError: e.message };
  }
}

/**
 * Deliver one Discord event to the ingestion journal, retrying only what can succeed.
 *
 * A rejected payload is not an error to retry — the server has already decided the answer
 * and it will not change. A transient one is retried with bounded backoff, and only after
 * the budget is exhausted does the event become a dead letter. Either way the outcome is
 * journaled here, because "detected but never recorded" is the failure this whole path
 * exists to make visible.
 */
async function ingestEvent({ guildId, channelId, channelName, messageId, caller, group, call, rejectionReason, eventType = "create", eventVersion, editedAt }) {
  if (!INGEST_URL || !BOT_SECRET) throw new Error("INGEST_URL / BOT_SHARED_SECRET not set");
  const payload = buildIngestPayload({ guildId, channelId, channelName, messageId, caller, call, rejectionReason, eventType, eventVersion, editedAt });

  for (let attempt = 0; attempt < INGEST_ATTEMPTS; attempt += 1) {
    const result = await postIngest(payload);
    if (result.ok) {
      const accepted = result.body?.accepted === true;
      const freshAccepted = isFreshAcceptedIngest(result.body, eventType);
      log("ingest.delivered", {
        channelId, messageId, eventType, mint: payload.mint,
        accepted, outcome: result.body?.status || (result.body?.duplicate ? "duplicate" : "accepted"),
        reason: result.body?.reason || null, attempt: attempt + 1
      });
      noteFreshness(channelId, accepted ? "lastAccepted" : "lastRejected");
      if (freshAccepted) ingestedMessages.remember(messageId);
      if (freshAccepted && eventType === "create" && !String(eventVersion || "").startsWith("history:")) {
        await relayCall({ caller, channelName, group, call });
      }
      return result.body;
    }

    const verdict = classifyDeliveryFailure(result);
    if (verdict === "reject") {
      log("ingest.rejected", { channelId, messageId, eventType, mint: payload.mint, status: result.status, error: result.body?.error || null });
      return null;
    }
    if (verdict === "fatal") {
      // Credentials or the shared secret are wrong. Every other event will fail the same
      // way, so this is surfaced once per event rather than absorbed into a retry count.
      log("ingest.unauthorized", { channelId, messageId, status: result.status });
      throw new Error(`ingest unauthorized (${result.status})`);
    }
    if (attempt + 1 < INGEST_ATTEMPTS) {
      const delay = nextBackoffMs(attempt);
      log("ingest.retry", { channelId, messageId, eventType, status: result.status || null, networkError: result.networkError || null, attempt: attempt + 1, delayMs: delay });
      await sleep(delay + Math.floor(Math.random() * 250));
    }
  }

  deadLetters.add({ payload, failedAt: new Date().toISOString() });
  log("ingest.deadletter", { ...payload, ...deadLetters.summary() });
  return null;
}

/** Legacy name kept for the /alpha path, which delivers exactly one create. */
const ingestCall = (args) => ingestEvent({ ...args, eventType: "create" });

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
  runtimeHealth.registration.attempts += 1;
  try {
    await registerChannel({
      guildId: guild.id,
      guildName: guild.name,
      guildMemberCount: guild.memberCount,
      channelId: channel.id,
      channelName: channel.name,
      registeredBy: user.username
    });
    runtimeHealth.registration.succeeded += 1;
    runtimeHealth.registration.lastSuccessAt = new Date().toISOString();
    await reply("Channel submitted. It will start copying calls once Degenaration approves it.");
  } catch (e) {
    runtimeHealth.registration.failed += 1;
    runtimeHealth.registration.lastFailureAt = new Date().toISOString();
    console.error("[bot] register failed:", e.message);
    await reply("Could not register right now — try again shortly.");
  }
}

async function syncRegisterCommand(guild) {
  try {
    await guild.commands.set(COMMANDS.map((command) => command.toJSON()));
    runtimeHealth.commands.lastSuccessAt = new Date().toISOString();
    runtimeHealth.commands.lastError = null;
    console.log(`[bot] ${COMMANDS.length} slash commands ready in ${guild.name}`);
  } catch (e) {
    runtimeHealth.commands.lastError = String(e.message).slice(0, 160);
    console.error(`[bot] slash command sync failed for ${guild.name}:`, e.message);
  }
}

/**
 * Remove stale GLOBAL commands.
 *
 * This is the root cause of the duplicate /register users see. Commands are published
 * guild-scoped via guild.commands.set(), which bulk-replaces only the GUILD list and
 * never touches the GLOBAL list. Any command registered globally by an earlier
 * deployment therefore keeps being served alongside the guild copy, and Discord renders
 * both. Clearing the global scope leaves exactly one published copy of each command.
 */
async function clearGlobalCommands() {
  try {
    const existing = await client.application.commands.fetch();
    if (existing.size === 0) return;
    await client.application.commands.set([]);
    console.log(`[bot] removed ${existing.size} stale global command(s)`);
  } catch (e) {
    console.error("[bot] could not clear global commands:", e.message);
  }
}

client.once("ready", async () => {
  console.log(`[bot] logged in as ${client.user.tag}`);
  console.log(`[bot] build ${BOT_BUILD}`);
  await clearGlobalCommands();
  await Promise.allSettled(client.guilds.cache.map((guild) => syncRegisterCommand(guild)));
  await refresh();
  console.log(`[bot] watching ${Object.keys(approved).length} approved channel(s)`);
  startHistoryBackfill();
  setInterval(refresh, REFRESH_MS);
  // The one duty the legacy degencalls service still performed that this listener did not.
  // Until it does, retiring that service freezes every marketplace avatar, name and member
  // count at whatever they were the day it stopped.
  await syncAllProfiles();
  setInterval(syncAllProfiles, PROFILE_SYNC_MS);
  // One immediately, so the verdict is readable the moment the process is up rather than
  // after the first interval. A diagnostic you have to wait ten minutes for is one you
  // reach for only after guessing first.
  emitHeartbeat();
});

client.on("guildCreate", (guild) => {
  syncRegisterCommand(guild);
  // A newly added guild has no profile row yet, so waiting for the timer would leave its
  // marketplace card blank for up to six hours.
  syncAllProfiles().catch(() => {});
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  const reply = (content) => interaction.editReply({ content }).catch(() => {});

  if (interaction.commandName === "register") {
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

  if (interaction.commandName === "test-call") {
    // Diagnostic only: parses the input and reports what the scanner would see.
    // It never ingests a call and never submits a swap (spec 15.2).
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      await reply("Only a server manager can run /test-call.");
      return;
    }
    const call = parseCall(interaction.options.getString("token", true));
    const channelApproved = Boolean(approved[interaction.channelId]);
    if (!call) {
      await reply(`Test only — no trade placed.\nParsed: no supported mint or link found.\nChannel approved: ${channelApproved ? "yes" : "no"}`);
      return;
    }
    await reply(`Test only — no trade placed.\nParsed mint: ${call.mint}\nConfidence: ${call.confidence}\nChannel approved: ${channelApproved ? "yes" : "no"}`);
    return;
  }

  if (interaction.commandName === "onboard") {
    await reply("1. Add Degenaration with bot + applications.commands.\n2. Run /register in the calls channel.\n3. Wait for owner approval.\n4. Post one Solana mint or use /alpha.\n5. Use /degen profile to share the earned record.");
    return;
  }

  if (interaction.commandName === "help") {
    await reply("/register - submit this channel as a call source\n/connect discord - securely link server ownership\n/alpha token - record an explicit call\n/test-call token - check parsing without trading\n/degen status - approval state\n/degen profile - public performance\n/degen referral - assigned server link\n/degen callers - recorded caller activity\n/onboard - setup steps");
    return;
  }

  if (interaction.commandName === "connect") {
    if (interaction.options.getSubcommand() !== "discord") return;
    if (!canManageGuild(interaction.member, interaction.memberPermissions)) {
      await reply("Manage Server permission is required to link this source.");
      return;
    }
    try {
      const link = await createOwnerLink({
        guildId: interaction.guildId,
        discordUserId: interaction.user.id,
        discordUsername: interaction.user.username
      });
      await reply(`Open this private link within 10 minutes: ${SITE_URL}/connect/discord/${link.sessionId}\nSign in and verify the same Discord account. The link itself cannot claim the source.`);
    } catch (e) {
      console.error("[bot] owner link creation failed:", e.message);
      await reply("A secure owner link could not be created right now. Try again shortly.");
    }
    return;
  }

  if (interaction.commandName !== "degen") return;
  const subcommand = interaction.options.getSubcommand();
  try {
    const status = await getGuildStatus(interaction.guildId);
    if (subcommand === "status") {
      if (!status.channels?.length) { await reply("No channel submitted yet. Run /register in your calls channel."); return; }
      const lines = status.channels.slice(0, 8).map((channel) => {
        const state = String(channel.status).toUpperCase();
        if (channel.status !== "approved") return `#${channel.channel_name || channel.channel_id}: ${state}`;
        // Detected vs recorded are reported apart on purpose. "Detected 2m ago, recorded
        // never" is a delivery fault; "detected never" is a parsing or permission fault.
        // Collapsing them into one figure would hide which of the two is happening.
        const seen = freshness.get(channel.channel_id) || {};
        return `#${channel.channel_name || channel.channel_id}: ${state} — last call seen ${since(seen.lastDetected)}, recorded ${since(seen.lastAccepted)}`;
      });
      const held = deadLetters.size ? `\nUnrecorded calls awaiting retry: ${deadLetters.size}` : "";
      await reply(`Degenaration status\n${lines.join("\n")}${held}${status.profile?.public_slug ? `\nProfile: ${SITE_URL}/source/${status.profile.public_slug}` : ""}`);
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

/**
 * Wire the gateway to the decision logic in handlers.js.
 *
 * Everything below the dependency list lives in that file so it can be replayed from a
 * stored fixture without a Discord connection; see `npm run verify:discord-replay`.
 */
const listener = createMessageHandlers({
  parseMessage,
  resolveTradable,
  ingestEvent,
  approvedChannel: (channelId) => approved[channelId],
  selfId: () => client.user?.id || null,
  log,
  noteFreshness,
  ingested: ingestedMessages,
  acknowledge: async ({ msg, group, call, outcome }) => {
    if (!scannerAcknowledgmentsEnabled(
      SCANNER_ACKNOWLEDGMENTS,
      group.scannerAcknowledgmentsEnabled
    )) return;
    if (typeof msg.reply !== "function") throw new Error("source message cannot be replied to");
    await msg.reply(buildScannerAcknowledgment({
      mint: outcome?.mint || call.mint,
      symbol: outcome?.symbol || null
    }));
    log("call.acknowledged", {
      channelId: msg.channel.id,
      messageId: msg.id,
      mint: outcome?.mint || call.mint
    });
  },
  onLegacyRegister: (msg) => registerCallChannel({
    guild: msg.guild,
    channel: msg.channel,
    member: msg.member,
    user: msg.author,
    reply: (content) => msg.reply(content).catch(() => {})
  })
});

client.on("messageCreate", listener.onMessageCreate);

/**
 * Say what has been seen, on a timer, whether or not anything happened.
 *
 * Without this, "is the listener receiving messages?" can only be answered by asking someone
 * to post one and watching — which is what the last two diagnostic rounds cost. A heartbeat
 * makes the answer readable at any moment from the log alone, and its `verdict` field states
 * the reading rather than leaving an operator to infer it from nine counters.
 *
 * Ten minutes is chosen so a quiet server produces 144 lines a day, which is cheap enough to
 * leave on permanently. Counters only: no message text, no author, no channel content.
 */
const HEARTBEAT_MS = Number(process.env.BOT_HEARTBEAT_MS || 600000);
function emitHeartbeat() {
  log("listener.heartbeat", {
    watchedChannels: Object.keys(approved).length,
    guilds: client.guilds?.cache?.size ?? null,
    deadLetters: deadLetters.size,
    profileSync: { ...profileSync },
    ...listener.diagnostics()
  });
}
setInterval(emitHeartbeat, HEARTBEAT_MS);
client.on("messageUpdate", listener.onMessageUpdate);
client.on("messageDelete", listener.onMessageDelete);

// Gateway health. discord.js reconnects on its own, but silently — so an outage looked
// identical to a quiet channel. These make the gap visible and, on resume, say how many
// events Discord replayed.
client.on("shardDisconnect", (event, shardId) => log("gateway.disconnect", { shardId, code: event?.code ?? null }));
client.on("shardReconnecting", (shardId) => log("gateway.reconnecting", { shardId }));
client.on("shardResume", (shardId, replayed) => log("gateway.resume", { shardId, replayed }));
client.on("shardError", (error, shardId) => console.error(`[bot] shard ${shardId} error:`, error?.message));
client.on("error", (error) => console.error("[bot] client error:", error?.message));

// A public, secret-free health document lets the replacement host prove that the Gateway
// listener, command publication and approved-channel refresh are all current. Process-up alone
// is not scanner health: a bot can keep running after its Discord session or source map failed.
http.createServer((req, res) => {
  /**
   * LIVENESS, separate from readiness, and the reason this listener has never deployed.
   *
   * render.yaml pointed healthCheckPath at /health, and /health answers 503 whenever Discord
   * is not ready. So a missing DISCORD_BOT_TOKEN did not merely stop the bot connecting — it
   * failed the deploy health check, Render kept the previous build, and the service froze on
   * a commit from 11 Aug reporting "starting" ever since. Every push after that, including the
   * fixes in this branch, was built and discarded.
   *
   * A configuration fault became an undeployable service, and the two are indistinguishable
   * from outside: "503 starting" is what you see whether the token is wrong, the build is
   * broken, or Discord is down.
   *
   * /live answers 200 whenever the process is running, and is what the platform checks.
   * Readiness is still reported honestly in /health's body and status code for anyone — human
   * or monitor — asking whether the bot is actually working. Deploys can now land, and the
   * body says what is wrong.
   */
  if (req.url === "/live") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ alive: true, build: BOT_BUILD, discordReady: client.isReady() }));
    return;
  }
  if (req.url !== "/" && !req.url?.startsWith("/health")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const health = buildRuntimeHealth({
    build: BOT_BUILD,
    ready: client.isReady(),
    guilds: client.guilds.cache.size,
    approvedChannels: Object.keys(approved).length,
    runtime: runtimeHealth
  });
  res.writeHead(health.httpStatus, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(health.body));
}).listen(HEALTH_PORT, HEALTH_HOST, () => console.log(`[bot] health listening on ${HEALTH_HOST}:${HEALTH_PORT}`));

if (!process.env.DISCORD_BOT_TOKEN) {
  // Named, not swallowed. Without this the process starts, serves /health, reports "starting"
  // forever, and gives no clue which of a dozen faults it is.
  console.error("[bot] DISCORD_BOT_TOKEN is not set — this listener cannot connect to Discord. " +
    "The process stays up and /live answers 200 so the deploy can land; /health will keep " +
    "reporting discord.ready=false until the token is set.");
} else {
  client.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
    console.error("[bot] Discord login failed:", error?.message || error);
  });
}
