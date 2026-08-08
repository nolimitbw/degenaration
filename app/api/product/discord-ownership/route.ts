import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyDiscordIdentity, requirePrivyUser } from "@/lib/server/privy";
import {
  DISCORD_LINK_STATE_COOKIE,
  issueDiscordLinkState,
  verifyDiscordLinkState
} from "@/lib/server/discord-link-state";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clearState(response: NextResponse) {
  response.cookies.set(DISCORD_LINK_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/product/discord-ownership",
    expires: new Date(0)
  });
  return response;
}

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60, failClosed: true });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const sessionId = req.nextUrl.searchParams.get("session");
  if (!sessionId) {
    const summary = await callPrivyRpc("app_user_discord_ownership_summary", { p_privy_user_id: user.privyUserId });
    return summary.ok ? NextResponse.json(summary.data) : NextResponse.json({ error: summary.error }, { status: summary.status });
  }
  if (!UUID_RE.test(sessionId)) return NextResponse.json({ error: "invalid link session" }, { status: 400 });
  const discord = await requirePrivyDiscordIdentity(req, user.privyUserId);
  if (!discord.ok) return discord.response;
  const session = await callPrivyRpc<any>("app_user_get_discord_link_session", {
    p_privy_user_id: user.privyUserId,
    p_session_id: sessionId
  });
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  if (session.data?.ok === false) return NextResponse.json({ error: session.data.error }, { status: session.data.status || 400 });
  if (session.data.discordUserId !== discord.identity.subject) {
    return NextResponse.json({ error: "Sign in with the Discord account that created this link" }, { status: 403 });
  }
  const state = issueDiscordLinkState(sessionId, user.privyUserId);
  if (!state) return NextResponse.json({ error: "Account linking is temporarily unavailable." }, { status: 503 });
  const response = NextResponse.json({ ...session.data, state: state.token });
  response.cookies.set(DISCORD_LINK_STATE_COOKIE, state.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/product/discord-ownership",
    expires: new Date(state.expiresAt)
  });
  return response;
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 20, windowSeconds: 60, failClosed: true });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const discord = await requirePrivyDiscordIdentity(req, user.privyUserId);
  if (!discord.ok) return discord.response;
  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const headerState = req.headers.get("x-discord-link-state") || undefined;
  const cookieState = req.cookies.get(DISCORD_LINK_STATE_COOKIE)?.value;
  if (!UUID_RE.test(sessionId) || headerState !== cookieState || !verifyDiscordLinkState(headerState, sessionId, user.privyUserId)) {
    return clearState(NextResponse.json({ error: "invalid or expired link state" }, { status: 403 }));
  }
  const result = await callPrivyRpc<any>("app_user_complete_discord_owner_link", {
    p_privy_user_id: user.privyUserId,
    p_session_id: sessionId,
    p_verified_discord_user_id: discord.identity.subject,
    p_verified_discord_username: discord.identity.username
  });
  if (!result.ok) return clearState(NextResponse.json({ error: result.error }, { status: result.status }));
  if (result.data?.ok === false) return clearState(NextResponse.json({ error: result.data.error }, { status: result.data.status || 400 }));
  return clearState(NextResponse.json(result.data));
}

export async function DELETE(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 10, windowSeconds: 60, failClosed: true });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const body = await req.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });
  const result = await callPrivyRpc("app_user_revoke_discord_owner_link", {
    p_privy_user_id: user.privyUserId,
    p_reason: reason
  });
  return result.ok ? NextResponse.json(result.data) : NextResponse.json({ error: result.error }, { status: result.status });
}
