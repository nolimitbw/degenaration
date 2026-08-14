import { verify as verifySignature } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { fetchWithTimeout } from "@/lib/server/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Discord slash commands, served over HTTP instead of a gateway connection.
 *
 * `/connect discord` is defined in server/bot/index.js and has never run: that program needs a
 * persistent WebSocket and has no host, so `discord_owner_link_sessions` is 0 and
 * `discord_ownership_events` is 0. No source has a verified owner, which is also why no
 * creator commission can be attributed to anyone.
 *
 * Discord supports a second delivery model — set an Interactions Endpoint URL and Discord POSTs
 * each command to it, signed. That needs no resident process, so it runs here on the deployment
 * that already exists. It does not replace the gateway bot: MESSAGE_CREATE still requires one,
 * which is why the scanner still polls. It covers commands only, and commands are what is
 * broken.
 *
 * Verification is mandatory and must happen on the RAW body before parsing — Discord signs the
 * exact bytes, and it actively probes this endpoint with deliberately invalid signatures when
 * you save the URL. An endpoint that answers those is rejected by Discord, which is the correct
 * outcome: without this check anyone could POST a forged command and claim a source.
 */

// BigInt(32) rather than a 32n literal: this project's tsconfig targets below ES2020, where
// BigInt literals are a compile error. The permission bitfield is far wider than Number can
// hold exactly, so it must still be BigInt arithmetic.
const MANAGE_GUILD = BigInt(32);

/** The application's Ed25519 public key, read from Discord once and cached for the instance. */
let verifyKey: string | null = null;

async function applicationVerifyKey(): Promise<string | null> {
  if (verifyKey) return verifyKey;
  // Prefer an explicitly configured key; fall back to asking Discord with the bot token, so
  // this works without anyone having to copy a value out of the developer portal.
  const configured = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (configured) { verifyKey = configured; return verifyKey; }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  try {
    const response = await fetchWithTimeout("https://discord.com/api/v10/applications/@me", {
      headers: { authorization: `Bot ${token}` },
      cache: "no-store"
    }, 6_000);
    if (!response.ok) return null;
    const application = await response.json().catch(() => null);
    const key = application?.verify_key;
    if (typeof key === "string" && /^[0-9a-f]{64}$/i.test(key)) { verifyKey = key; return verifyKey; }
  } catch { /* fall through */ }
  return null;
}

/**
 * Ed25519 over `timestamp + rawBody`, using the DER wrapper Node needs for a raw 32-byte key.
 * Node has this natively, so no dependency is added for it.
 */
function signatureValid(rawBody: string, signature: string, timestamp: string, publicKeyHex: string) {
  if (!/^[0-9a-f]+$/i.test(signature) || signature.length !== 128) return false;
  try {
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyHex, "hex")
    ]);
    return verifySignature(
      null,
      Buffer.from(timestamp + rawBody, "utf8"),
      { key: der, format: "der", type: "spki" },
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

async function bridge(operation: string, params: Record<string, unknown>) {
  const url = getBotBridgeUrl();
  if (!url) throw new Error("bot bridge is not configured");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: botBridgeHeaders,
    cache: "no-store",
    body: JSON.stringify({ operation, p_secret: process.env.BOT_SHARED_SECRET, ...params })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `bridge operation failed (${response.status})`);
  return data;
}

/** Type 4 with flag 64 — a reply only the caller can see. An owner link must never be public. */
const ephemeral = (content: string) =>
  NextResponse.json({ type: 4, data: { content, flags: 64 } });

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  const raw = await req.text();

  if (!signature || !timestamp) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 });
  }
  const publicKey = await applicationVerifyKey();
  if (!publicKey) {
    // Fail closed. Answering unverified commands would let anyone claim a Discord source.
    return NextResponse.json({ error: "verification unavailable" }, { status: 503 });
  }
  if (!signatureValid(raw, signature, timestamp, publicKey)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  // 1 = PING. Discord sends this when the endpoint URL is saved and periodically after.
  if (body?.type === 1) return NextResponse.json({ type: 1 });

  /**
   * 3 = MESSAGE_COMPONENT — the owner picked a channel from the /register menu.
   *
   * `data.values` for a channel select carries the chosen ids. It is verified again inside
   * finishRegistration rather than trusted: this is a separate signed request from the client,
   * and a component id is not proof of who is clicking it.
   */
  if (body?.type === 3 && body?.data?.custom_id === "degen-register-channel") {
    const chosen = Array.isArray(body?.data?.values) ? body.data.values[0] : null;
    return await finishRegistration(body, typeof chosen === "string" ? chosen : null);
  }

  // 2 = APPLICATION_COMMAND.
  if (body?.type !== 2) return NextResponse.json({ type: 4, data: { content: "Unsupported interaction.", flags: 64 } });

  const name = body?.data?.name;
  const subcommand = body?.data?.options?.[0]?.name;

  if (name === "connect" && subcommand === "discord") {
    const guildId = body?.guild_id;
    if (!guildId) return ephemeral("Run this inside the server you want to link.");

    // Permission is checked from the bitfield Discord sends, not from anything the caller
    // supplies in the command — the same rule the gateway handler uses.
    let permissions = BigInt(0);
    try { permissions = BigInt(body?.member?.permissions ?? "0"); } catch { permissions = BigInt(0); }
    if ((permissions & MANAGE_GUILD) !== MANAGE_GUILD) {
      return ephemeral("Manage Server permission is required to link this source.");
    }

    try {
      const link = await bridge("create_owner_link", {
        p_guild_id: guildId,
        p_discord_user_id: body?.member?.user?.id ?? null,
        p_discord_username: body?.member?.user?.username ?? null,
        p_manage_guild_verified: true
      });
      const sessionId = link?.session_id || link?.sessionId;
      if (!sessionId) return ephemeral("A secure owner link could not be created right now. Try again shortly.");
      const site = process.env.NEXT_PUBLIC_SITE_URL || "https://degenaration.vercel.app";
      return ephemeral(
        `Open this private link within 10 minutes: ${site}/connect/discord/${sessionId}\n` +
        "Sign in and verify the same Discord account. The link itself cannot claim the source."
      );
    } catch {
      return ephemeral("A secure owner link could not be created right now. Try again shortly.");
    }
  }

  /**
   * The command a DIFFERENT server's owner runs to put their calls channel forward. This is
   * the whole onboarding path for the marketplace — without it the only sources are the ones
   * added by hand — and it was missing from the HTTP endpoint, so the one bot that is actually
   * installed could not accept a new server.
   *
   * Mirrors registerCallChannel in server/bot/index.js: manager permission required, the
   * channel is taken from where the command was run, and approval stays manual.
   */
  /**
   * `/register` asks WHICH channel, rather than assuming the one it was typed in.
   *
   * Taking the current channel silently is how a server ends up monitoring #general because
   * that is where the owner happened to run the command. Discord has a native channel picker
   * (component type 8) which is filtered to text channels and shows only what the user can
   * already see, so the choice is explicit and cannot name a channel they do not have.
   *
   * The registration itself happens on the follow-up component interaction below.
   */
  if (name === "register") {
    const guildId = body?.guild_id;
    if (!guildId) return ephemeral("Run /register inside the server you want to connect.");

    let permissions = BigInt(0);
    try { permissions = BigInt(body?.member?.permissions ?? "0"); } catch { permissions = BigInt(0); }
    if ((permissions & MANAGE_GUILD) !== MANAGE_GUILD) {
      return ephemeral("Only a server manager can register a call channel.");
    }

    return NextResponse.json({
      type: 4,
      data: {
        content: "Choose the channel where you post Solana calls. Only that channel is monitored.",
        flags: 64,
        components: [{
          type: 1,
          components: [{
            type: 8,               // CHANNEL_SELECT
            custom_id: "degen-register-channel",
            channel_types: [0, 5], // text and announcement; nothing that cannot hold messages
            placeholder: "Select your calls channel",
            min_values: 1,
            max_values: 1
          }]
        }]
      }
    });
  }

  if (name === "help") {
    return ephemeral(
      "DegenAration commands:\n" +
      "/register — choose the channel where you post calls\n" +
      "/connect discord — link this server to your DegenAration account"
    );
  }

  return ephemeral("That command is not handled here yet.");
}

/**
 * Complete a registration once the owner has chosen a channel.
 *
 * Separate from the command so the permission check happens again here rather than being
 * inherited: a component interaction is a fresh request from the client and its permissions
 * must be verified on their own, not assumed from the command that produced the menu.
 */
async function finishRegistration(body: any, selectedChannelId: string | null) {
  {
    const guildId = body?.guild_id;
    const channelId = selectedChannelId;
    if (!guildId || !channelId) return ephemeral("That channel could not be read. Try /register again.");

    let permissions = BigInt(0);
    try { permissions = BigInt(body?.member?.permissions ?? "0"); } catch { permissions = BigInt(0); }
    if ((permissions & MANAGE_GUILD) !== MANAGE_GUILD) {
      return ephemeral("Only a server manager can register a call channel.");
    }

    // The interaction payload carries ids but not always names, and the register RPC records
    // them for the marketplace listing. Ask Discord rather than storing a blank.
    let guildName: string | null = null;
    let channelName: string | null = null;
    let memberCount: number | null = null;
    const token = process.env.DISCORD_BOT_TOKEN;
    if (token) {
      const auth = { authorization: `Bot ${token}` };
      const [g, c] = await Promise.all([
        fetchWithTimeout(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, { headers: auth, cache: "no-store" }, 5_000).catch(() => null),
        fetchWithTimeout(`https://discord.com/api/v10/channels/${channelId}`, { headers: auth, cache: "no-store" }, 5_000).catch(() => null)
      ]);
      const guild = g?.ok ? await g.json().catch(() => null) : null;
      const channel = c?.ok ? await c.json().catch(() => null) : null;
      guildName = guild?.name ?? null;
      memberCount = Number.isInteger(guild?.approximate_member_count) ? guild.approximate_member_count : null;
      channelName = channel?.name ?? null;
    }

    try {
      await bridge("register_channel", {
        p_guild_id: guildId,
        p_guild_name: guildName,
        p_guild_member_count: memberCount,
        p_channel_id: channelId,
        p_channel_name: channelName,
        p_registered_by: body?.member?.user?.username ?? null
      });
      return ephemeral("Channel submitted. It will start copying calls once DegenAration approves it.");
    } catch {
      return ephemeral("Could not register right now — try again shortly.");
    }
  }
}
