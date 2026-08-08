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

export async function GET() {
  const clientId = process.env.DISCORD_BOT_CLIENT_ID || process.env.NEXT_PUBLIC_DISCORD_BOT_CLIENT_ID || DEFAULT_BOT_CLIENT_ID;
  const configured = Boolean(process.env.BOT_SHARED_SECRET);
  const status = await liveStatus();

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
    live: status
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
