import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DISCORD_API = "https://discord.com/api/v10";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

const snowflake = (value: unknown): value is string => typeof value === "string" && /^\d{17,20}$/.test(value);

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function authorized(request: Request) {
  const expected = Deno.env.get("BOT_SHARED_SECRET") ?? "";
  const supplied = request.headers.get("x-bot-secret") ?? "";
  if (!expected || !supplied) return false;
  const [left, right] = await Promise.all([digest(expected), digest(supplied)]);
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function nonce(value: string) {
  let result = 0n;
  for (const byte of new TextEncoder().encode(value)) result = (result * 131n + BigInt(byte)) & 0x7fffffffffffffffn;
  return result.toString();
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!(await authorized(request))) return json({ error: "unauthorized" }, 401);

  const token = Deno.env.get("DISCORD_BOT_TOKEN") ?? Deno.env.get("DISCORD_TOKEN") ?? "";
  const expectedGuildId = Deno.env.get("DISCORD_GUILD_ID") ?? "";
  if (!token || !expectedGuildId) return json({ error: "Discord delivery is not configured" }, 503);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const channelId = body.channel_id;
  if (!snowflake(channelId)) return json({ error: "invalid Discord channel" }, 400);

  const auth = { authorization: `Bot ${token}` };
  const channelResponse = await fetch(`${DISCORD_API}/channels/${channelId}`, { headers: auth });
  const channel = await channelResponse.json().catch(() => null);
  if (!channelResponse.ok) return json({ error: "Discord channel is unavailable", upstream_status: channelResponse.status }, 502);
  if (channel?.guild_id !== expectedGuildId) return json({ error: "channel is outside the configured Discord server" }, 403);
  if (body.verify_only === true) {
    return json({ ok: true, channel_id: channelId, guild_id: channel.guild_id, channel_name: channel.name ?? null });
  }

  const embeds = Array.isArray(body.embeds) ? body.embeds : [];
  const components = Array.isArray(body.components) ? body.components : [];
  const content = typeof body.content === "string" ? body.content.slice(0, 2000) : undefined;
  const deliveryId = typeof body.delivery_id === "string" ? body.delivery_id.trim().slice(0, 160) : "";
  if ((!content && embeds.length === 0) || embeds.length > 10 || components.length > 5 || !deliveryId) {
    return json({ error: "valid message payload and delivery_id are required" }, 400);
  }

  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ content, embeds, components, nonce: nonce(deliveryId), enforce_nonce: true })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    return json({ error: "Discord delivery failed", upstream_status: response.status }, 502);
  }
  return json({ ok: true, message_id: result.id, channel_id: channelId });
});
