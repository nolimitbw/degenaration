import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/server/guard";

const DEFAULT_BOT_CLIENT_ID = "1525315046303858748";
const BOT_PERMISSIONS = "117760";
const BOT_SCOPES = "bot applications.commands";
const EXPECTED_BOT_BUILD = "source-tools-v3";
const DEFAULT_HEALTH_URL = "https://degencalls.onrender.com/health?format=json";

function canonicalInvite(clientId: string) {
  const invite = new URL("https://discord.com/oauth2/authorize");
  invite.searchParams.set("client_id", clientId);
  invite.searchParams.set("permissions", BOT_PERMISSIONS);
  invite.searchParams.set("scope", BOT_SCOPES);
  invite.searchParams.set("integration_type", "0");
  return invite.toString();
}

async function liveStatus() {
  const healthUrl = process.env.DEGENCALLS_HEALTH_URL || DEFAULT_HEALTH_URL;
  try {
    const response = await fetchWithTimeout(healthUrl, { cache: "no-store" }, 5_000);
    const health = await response.json().catch(() => null);
    const commands = health?.discord?.commands;
    const source = health?.source_bridge;
    return {
      online: response.ok && health?.discord?.ready === true,
      serviceStatus: typeof health?.status === "string" ? health.status : response.ok ? "online" : "offline",
      version: typeof health?.version === "string" ? health.version : null,
      guilds: Number.isInteger(health?.discord?.guilds) ? health.discord.guilds : null,
      commandsRegistered: Boolean(commands?.lastSuccessAt) && !commands?.lastError,
      commandLastSuccessAt: commands?.lastSuccessAt || null,
      approvedChannelRefreshOk: Boolean(source?.approvedRefresh?.lastSuccessAt) && !source?.approvedRefresh?.lastError,
      approvedChannels: Number.isInteger(source?.approvedChannels) ? source.approvedChannels : null,
      registrationAttempts: Number.isInteger(source?.registration?.attempts) ? source.registration.attempts : null,
      registrationSucceeded: Number.isInteger(source?.registration?.succeeded) ? source.registration.succeeded : null,
      registrationFailed: Number.isInteger(source?.registration?.failed) ? source.registration.failed : null,
      lastRegistrationAt: source?.registration?.lastSuccessAt || source?.registration?.lastFailureAt || null
    };
  } catch {
    return {
      online: false,
      serviceStatus: "unreachable",
      version: null,
      guilds: null,
      commandsRegistered: false,
      commandLastSuccessAt: null,
      approvedChannelRefreshOk: false,
      approvedChannels: null,
      registrationAttempts: null,
      registrationSucceeded: null,
      registrationFailed: null,
      lastRegistrationAt: null
    };
  }
}

/**
 * What OUR Discord application actually is, asked of Discord with our own bot token.
 *
 * `live` below reports degencalls.onrender.com — a listener that is not in this repository. Its
 * guild count and readiness were the only Discord facts on this endpoint, so a different
 * application's health was being read as ours. That is how "the bot in my server is not the
 * DegenAration bot" stayed invisible: the page said a bot was online, and it was, just not this
 * one. This block names ours specifically so the two can never be confused again.
 */
async function selfApplication() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { configured: false, name: null, id: null, guilds: null, commands: null };
  const auth = { authorization: `Bot ${token}` };
  try {
    const app = await fetchWithTimeout("https://discord.com/api/v10/applications/@me", { headers: auth, cache: "no-store" }, 6_000);
    const application = app.ok ? await app.json().catch(() => null) : null;
    if (!application?.id) return { configured: true, name: null, id: null, guilds: null, commands: null, error: `applications/@me ${app.status}` };

    const [guildsResponse, commandsResponse] = await Promise.all([
      fetchWithTimeout("https://discord.com/api/v10/users/@me/guilds", { headers: auth, cache: "no-store" }, 6_000),
      fetchWithTimeout(`https://discord.com/api/v10/applications/${application.id}/commands`, { headers: auth, cache: "no-store" }, 6_000)
    ]);
    const guilds = guildsResponse.ok ? await guildsResponse.json().catch(() => []) : [];
    const commands = commandsResponse.ok ? await commandsResponse.json().catch(() => []) : [];

    return {
      configured: true,
      id: application.id,
      name: application.name ?? null,
      interactionsEndpointSet: Boolean(application.interactions_endpoint_url),
      guilds: Array.isArray(guilds) ? guilds.map((g: any) => g?.name).filter(Boolean) : [],
      commands: Array.isArray(commands) ? commands.map((c: any) => c?.name).filter(Boolean) : []
    };
  } catch {
    return { configured: true, name: null, id: null, guilds: null, commands: null, error: "unreachable" };
  }
}

export async function GET() {
  const clientId = process.env.DISCORD_BOT_CLIENT_ID || process.env.NEXT_PUBLIC_DISCORD_BOT_CLIENT_ID || DEFAULT_BOT_CLIENT_ID;
  const configured = Boolean(process.env.BOT_SHARED_SECRET);
  const [status, self] = await Promise.all([liveStatus(), selfApplication()]);

  return NextResponse.json({
    clientId,
    invite: canonicalInvite(clientId),
    permissions: BOT_PERMISSIONS,
    permissionNames: ["View Channels", "Send Messages", "Embed Links", "Attach Files", "Read Message History"],
    scopes: BOT_SCOPES.split(" "),
    slashCommandConfigured: BOT_SCOPES.split(" ").includes("applications.commands"),
    registrationCommand: "/register",
    commands: ["/register", "/connect discord", "/alpha", "/degen status", "/degen profile", "/degen referral", "/degen callers", "/onboard", "/help"],
    registrationBridgeConfigured: configured,
    botBuild: process.env.BOT_BUILD || EXPECTED_BOT_BUILD,
    /** The listener at degencalls.onrender.com — NOT this repository's bot. */
    live: status,
    /** This repository's own Discord application. */
    self
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
