import { NextResponse } from "next/server";

const DEFAULT_BOT_CLIENT_ID = "1525315046303858748";
const BOT_PERMISSIONS = "68608";
const BOT_SCOPES = "bot applications.commands";

export async function GET() {
  const clientId = process.env.DISCORD_BOT_CLIENT_ID || process.env.NEXT_PUBLIC_DISCORD_BOT_CLIENT_ID || DEFAULT_BOT_CLIENT_ID;
  const configured = Boolean(process.env.BOT_SHARED_SECRET);
  const invite = process.env.NEXT_PUBLIC_DISCORD_BOT_INVITE ||
    `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${BOT_PERMISSIONS}&scope=${encodeURIComponent(BOT_SCOPES)}`;

  return NextResponse.json({
    clientId,
    invite,
    permissions: BOT_PERMISSIONS,
    scopes: BOT_SCOPES.split(" "),
    registrationBridgeConfigured: configured
  });
}
