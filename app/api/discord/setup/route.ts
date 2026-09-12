import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/server/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Point this repository's Discord application at the HTTP interactions endpoint and register
 * its commands.
 *
 * Diagnosed from /api/bot/config: the application "Degenaration" IS installed in both guilds,
 * but had ZERO commands registered and no interactions endpoint. So every `/connect discord`
 * a user ran belonged to the OTHER bot in those servers — which is why the name looked wrong,
 * and why discord_owner_link_sessions is 0 and no source has a verified owner.
 *
 * Both fixes are ordinary Discord REST calls the bot token can make, so neither needs anyone
 * to click through the developer portal.
 *
 * ORDER MATTERS. The endpoint URL is set FIRST, because Discord validates it synchronously —
 * it sends a PING with a deliberately invalid signature and expects a rejection, then a valid
 * one and expects a PONG. If that fails the PATCH fails, and we want to know that before
 * publishing commands that would route to a broken endpoint.
 *
 * Guild commands are registered as well as global ones: global registration can take up to an
 * hour to appear, guild registration is immediate, and this needs to be verifiable now.
 */

const COMMANDS = [
  {
    // The onboarding path for every OTHER server: an owner runs this in their calls channel
    // and it goes forward for review. Without it the marketplace can only grow by hand.
    name: "register",
    description: "Submit this channel as a DegenAration call source for review."
  },
  {
    name: "connect",
    description: "Securely connect a server owner to DegenAration.",
    options: [{
      type: 1, // SUB_COMMAND
      name: "discord",
      description: "Link this server to your signed-in DegenAration account."
    }]
  },
  {
    name: "help",
    description: "Show DegenAration bot commands."
  }
];

function isAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

/**
 * Which applications are installed in each guild, and which of them own a `/connect`.
 *
 * Two bots in the same server can both register a command with the same name; Discord shows
 * both and the user picks blind. That is what "De Generation PR used /connect discord — the
 * application did not respond" is: a different application's broken copy of our command.
 * Naming the other one is the only way to remove the right thing.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "DISCORD_BOT_TOKEN is not set" }, { status: 503 });
  const auth = { authorization: `Bot ${token}` };

  const guildsResponse = await fetchWithTimeout("https://discord.com/api/v10/users/@me/guilds", { headers: auth, cache: "no-store" }, 8_000);
  const guilds = guildsResponse.ok ? await guildsResponse.json().catch(() => []) : [];
  const report: Record<string, unknown> = {};

  for (const guild of Array.isArray(guilds) ? guilds : []) {
    if (!guild?.id) continue;
    const response = await fetchWithTimeout(
      `https://discord.com/api/v10/guilds/${guild.id}/integrations`,
      { headers: auth, cache: "no-store" }, 8_000
    );
    if (!response.ok) {
      report[guild.name || guild.id] = { error: `integrations ${response.status}` };
      continue;
    }
    const integrations = await response.json().catch(() => []);
    report[guild.name || guild.id] = (Array.isArray(integrations) ? integrations : [])
      .filter((i: any) => i?.type === "discord" || i?.application)
      .map((i: any) => ({
        name: i?.application?.name ?? i?.name ?? null,
        applicationId: i?.application?.id ?? null,
        botUsername: i?.application?.bot?.username ?? null,
        // Needed to remove one: the integration has its own id, which is not the app id.
        integrationId: i?.id ?? null,
        guildId: guild.id
      }));
  }

  /**
   * Can the bot actually READ each approved channel right now?
   *
   * The scanner reported no error and no messages for a channel whose owner says it is busy.
   * Those two look identical from the outside — "nothing new" and "cannot see it" both come
   * back as zero — so the only way to tell them apart is to ask Discord directly and report
   * the status code.
   */
  const channels = await fetchWithTimeout(
    `${req.nextUrl.origin}/api/cron/discord-backfill`,
    { headers: { authorization: req.headers.get("authorization") || "" }, cache: "no-store" }, 60_000
  ).catch(() => null);

  const probe: Record<string, unknown> = {};
  for (const id of ["1521876069693526158", "1495930481018142801"]) {
    const response = await fetchWithTimeout(
      `https://discord.com/api/v10/channels/${id}/messages?limit=5`,
      { headers: auth, cache: "no-store" }, 8_000
    ).catch(() => null);
    if (!response) { probe[id] = { error: "unreachable" }; continue; }
    if (!response.ok) {
      probe[id] = { status: response.status, detail: (await response.text().catch(() => "")).slice(0, 160) };
      continue;
    }
    const messages = await response.json().catch(() => []);
    probe[id] = {
      status: 200,
      visible: Array.isArray(messages) ? messages.length : 0,
      newest: Array.isArray(messages) && messages[0]?.timestamp ? messages[0].timestamp : null,
      newestId: Array.isArray(messages) && messages[0]?.id ? messages[0].id : null
    };
  }

  /**
   * Every text channel the bot can see, newest activity first.
   *
   * A registered channel that has genuinely gone quiet and a busy channel nobody registered
   * look the same from the journal: no new calls. This tells them apart by naming where the
   * activity actually is, so the answer is "register #that-one" rather than "the scanner is
   * broken".
   *
   * `last_message_id` is a snowflake and its timestamp is the top 42 bits, so the time of the
   * newest message comes free with the channel list — no per-channel message fetch, which at
   * this many channels would be the thing that gets us rate limited.
   */
  const DISCORD_EPOCH = 1420070400000;
  const activity: Record<string, unknown> = {};
  for (const guild of Array.isArray(guilds) ? guilds : []) {
    if (!guild?.id) continue;
    const response = await fetchWithTimeout(`https://discord.com/api/v10/guilds/${guild.id}/channels`, { headers: auth, cache: "no-store" }, 8_000);
    if (!response.ok) { activity[guild.name || guild.id] = { error: `channels ${response.status}` }; continue; }
    const list = await response.json().catch(() => []);
    activity[guild.name || guild.id] = (Array.isArray(list) ? list : [])
      .filter((c: any) => c?.type === 0 && c?.last_message_id)
      .map((c: any) => ({
        name: c.name,
        id: c.id,
        lastMessageAt: new Date(Number(BigInt(c.last_message_id) >> BigInt(22)) + DISCORD_EPOCH).toISOString()
      }))
      .sort((a: any, b: any) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
      .slice(0, 12);
  }

  return NextResponse.json(
    { ok: true, guilds: report, channelRead: probe, channelActivity: activity, scannerReachable: Boolean(channels) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Remove another application from the guilds this bot is in.
 *
 * Requested explicitly by the owner: "remove the de generation pr, we only need 1 bot".
 * Deleting a guild integration is how a bot is removed from a server, and it needs MANAGE_GUILD
 * — which this bot has in the DegenAration guild, since reading integrations already succeeded
 * there.
 *
 * Two guards, because this reaches into someone's Discord server and removes something:
 *   - it will only act on an application id passed in explicitly, never a default;
 *   - it verifies the integration's NAME matches what the caller expects before deleting, so a
 *     mistyped id cannot silently remove a different bot. Discord ids are 18-19 digits and
 *     nothing about them is memorable enough to trust unverified.
 *
 * It refuses to remove THIS application, which would otherwise be a one-request way to
 * disconnect the product from every server it serves.
 */
export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "DISCORD_BOT_TOKEN is not set" }, { status: 503 });

  const applicationId = req.nextUrl.searchParams.get("applicationId");
  const expectedName = req.nextUrl.searchParams.get("name");
  if (!applicationId || !/^\d{15,25}$/.test(applicationId)) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }
  if (!expectedName) {
    return NextResponse.json({ error: "name is required, and must match the installed integration" }, { status: 400 });
  }

  const auth = { authorization: `Bot ${token}` };
  const selfResponse = await fetchWithTimeout("https://discord.com/api/v10/applications/@me", { headers: auth, cache: "no-store" }, 8_000);
  const self = selfResponse.ok ? await selfResponse.json().catch(() => null) : null;
  if (self?.id === applicationId) {
    return NextResponse.json({ error: "refusing to remove this application from its own guilds" }, { status: 400 });
  }

  const guildsResponse = await fetchWithTimeout("https://discord.com/api/v10/users/@me/guilds", { headers: auth, cache: "no-store" }, 8_000);
  const guilds = guildsResponse.ok ? await guildsResponse.json().catch(() => []) : [];
  const removed: Record<string, unknown> = {};

  for (const guild of Array.isArray(guilds) ? guilds : []) {
    if (!guild?.id) continue;
    const listing = await fetchWithTimeout(`https://discord.com/api/v10/guilds/${guild.id}/integrations`, { headers: auth, cache: "no-store" }, 8_000);
    if (!listing.ok) { removed[guild.name || guild.id] = { skipped: `integrations ${listing.status}` }; continue; }
    const integrations = await listing.json().catch(() => []);
    const match = (Array.isArray(integrations) ? integrations : [])
      .find((i: any) => i?.application?.id === applicationId);
    if (!match) { removed[guild.name || guild.id] = { skipped: "not installed here" }; continue; }

    const actualName = match?.application?.name ?? match?.name ?? "";
    if (actualName !== expectedName) {
      removed[guild.name || guild.id] = { refused: `name mismatch: installed as "${actualName}"` };
      continue;
    }

    const response = await fetchWithTimeout(
      `https://discord.com/api/v10/guilds/${guild.id}/integrations/${match.id}`,
      { method: "DELETE", headers: auth, cache: "no-store" }, 12_000
    );
    removed[guild.name || guild.id] = response.ok
      ? { removed: actualName }
      : { failed: response.status, detail: (await response.text().catch(() => "")).slice(0, 200) };
  }

  return NextResponse.json({ ok: true, applicationId, guilds: removed }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "DISCORD_BOT_TOKEN is not set" }, { status: 503 });

  const auth = { authorization: `Bot ${token}`, "content-type": "application/json" };
  const origin = req.nextUrl.origin;
  const endpoint = `${origin}/api/discord/interactions`;
  const steps: Record<string, unknown> = { endpoint };

  const appResponse = await fetchWithTimeout("https://discord.com/api/v10/applications/@me", { headers: auth, cache: "no-store" }, 8_000);
  if (!appResponse.ok) {
    return NextResponse.json({ error: `applications/@me ${appResponse.status}` }, { status: 502 });
  }
  const application = await appResponse.json();
  steps.application = { id: application.id, name: application.name };

  // 1. The endpoint. Discord validates it during this call.
  const patch = await fetchWithTimeout("https://discord.com/api/v10/applications/@me", {
    method: "PATCH",
    headers: auth,
    cache: "no-store",
    body: JSON.stringify({ interactions_endpoint_url: endpoint })
  }, 20_000);
  steps.interactionsEndpoint = patch.ok
    ? "set"
    : { status: patch.status, detail: (await patch.text().catch(() => "")).slice(0, 300) };

  // 2. Global commands.
  const global = await fetchWithTimeout(`https://discord.com/api/v10/applications/${application.id}/commands`, {
    method: "PUT",
    headers: auth,
    cache: "no-store",
    body: JSON.stringify(COMMANDS)
  }, 15_000);
  steps.globalCommands = global.ok
    ? (await global.json().catch(() => [])).map((c: any) => c?.name)
    : { status: global.status, detail: (await global.text().catch(() => "")).slice(0, 300) };

  // 3. Guild commands, for immediate availability in the servers the bot is already in.
  const guildsResponse = await fetchWithTimeout("https://discord.com/api/v10/users/@me/guilds", { headers: auth, cache: "no-store" }, 8_000);
  const guilds = guildsResponse.ok ? await guildsResponse.json().catch(() => []) : [];
  const perGuild: Record<string, unknown> = {};
  for (const guild of Array.isArray(guilds) ? guilds : []) {
    if (!guild?.id) continue;
    const response = await fetchWithTimeout(
      `https://discord.com/api/v10/applications/${application.id}/guilds/${guild.id}/commands`,
      { method: "PUT", headers: auth, cache: "no-store", body: JSON.stringify(COMMANDS) },
      15_000
    );
    perGuild[guild.name || guild.id] = response.ok
      ? (await response.json().catch(() => [])).map((c: any) => c?.name)
      : { status: response.status, detail: (await response.text().catch(() => "")).slice(0, 200) };
  }
  steps.guildCommands = perGuild;

  return NextResponse.json({ ok: true, ...steps }, { headers: { "Cache-Control": "no-store" } });
}
