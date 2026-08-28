const RENDER_ORIGIN = "https://degenaration-web.onrender.com";
const DISCORD_API = "https://discord.com/api/v10";

function isSnowflake(value) {
  return typeof value === "string" && /^[0-9]{17,20}$/.test(value);
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function secretsMatch(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let different = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) different |= a[index] ^ b[index];
  return different === 0;
}

async function deliveryNonce(value) {
  const bytes = await digest(value);
  let nonce = 0n;
  for (const byte of bytes.slice(0, 8)) nonce = (nonce << 8n) | BigInt(byte);
  return (nonce & 0x7fffffffffffffffn).toString();
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function discordDelivery(request, env) {
  if (!env.DISCORD_BOT_TOKEN || !env.BOT_SHARED_SECRET || !env.DISCORD_GUILD_ID) return null;
  if (!(await secretsMatch(request.headers.get("x-bot-secret"), env.BOT_SHARED_SECRET))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const channelId = body?.channel_id;
  if (!isSnowflake(channelId)) return json({ error: "invalid Discord channel" }, 400);

  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
  const channelResponse = await fetch(`${DISCORD_API}/channels/${channelId}`, { headers });
  if (!channelResponse.ok) return json({ error: "Discord channel is unavailable", upstream_status: channelResponse.status }, 502);
  const channel = await channelResponse.json();
  if (channel.guild_id !== env.DISCORD_GUILD_ID) {
    return json({ error: "channel is outside the configured Discord server" }, 403);
  }
  if (body.verify_only === true) {
    return json({ ok: true, channel_id: channelId, guild_id: channel.guild_id, channel_name: channel.name ?? null });
  }
  if (body.list_recent === true) {
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 100));
    const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`, { headers });
    const messages = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(messages)) return json({ error: "Discord history is unavailable" }, 502);
    return json({
      ok: true,
      messages: messages.map(message => ({
        id: message.id,
        timestamp: message.timestamp,
        content: message.content,
        embeds: message.embeds,
        author_bot: message.author?.bot === true
      }))
    });
  }

  const embeds = Array.isArray(body.embeds) ? body.embeds : [];
  const components = Array.isArray(body.components) ? body.components : [];
  const content = typeof body.content === "string" ? body.content.slice(0, 2000) : undefined;
  const deliveryId = typeof body.delivery_id === "string" ? body.delivery_id.trim().slice(0, 160) : "";
  if ((!content && embeds.length === 0) || embeds.length > 10 || components.length > 5 || !deliveryId) {
    return json({ error: "message payload and delivery_id are required" }, 400);
  }
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ content, embeds, components, nonce: await deliveryNonce(deliveryId), enforce_nonce: true })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) return json({ error: "Discord delivery failed", upstream_status: response.status }, 502);
  return json({ ok: true, message_id: result.id, channel_id: channelId });
}

function rewriteLocation(headers, publicOrigin) {
  const location = headers.get("location");
  if (!location) return;

  headers.set("location", location.replace(RENDER_ORIGIN, publicOrigin));
}

export default {
  async fetch(request, env) {
    const publicUrl = new URL(request.url);

    if (request.method === "POST" && publicUrl.pathname === "/api/bot/discord-delivery") {
      const response = await discordDelivery(request, env);
      if (response) return response;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
    }

    const renderUrl = new URL(publicUrl.pathname + publicUrl.search, RENDER_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("host", renderUrl.host);
    headers.set("x-forwarded-host", publicUrl.host);
    headers.set("x-forwarded-proto", "https");

    const response = await fetch(
      new Request(renderUrl, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : request.body,
        redirect: "manual"
      })
    );

    const responseHeaders = new Headers(response.headers);
    rewriteLocation(responseHeaders, publicUrl.origin);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  }
};
