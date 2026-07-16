import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const operations: Record<string, { rpc: string; params: string[] }> = {
  register_channel: {
    rpc: "bot_register_call_channel",
    params: ["p_secret", "p_guild_id", "p_guild_name", "p_guild_member_count", "p_channel_id", "p_channel_name", "p_registered_by"]
  },
  approved_channels: {
    rpc: "bot_approved_call_channels",
    params: ["p_secret"]
  },
  ingest_call: {
    rpc: "bot_ingest_discord_call",
    params: [
      "p_secret", "p_channel_id", "p_channel_name", "p_mint", "p_symbol",
      "p_called_mcap", "p_called_price_usd", "p_called_liquidity_usd",
      "p_message_id", "p_caller", "p_confidence"
    ]
  },
  guild_status: {
    rpc: "bot_guild_status",
    params: ["p_secret", "p_guild_id"]
  }
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const operation = typeof body.operation === "string" ? operations[body.operation] : null;
  if (!operation) return json({ error: "unknown operation" }, 400);

  const params = Object.fromEntries(operation.params.map((key) => [key, body[key] ?? null]));
  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await client.rpc(operation.rpc, params);

  if (error) {
    const denied = error.code === "42501";
    return json({ error: denied ? "unauthorized" : "bridge operation failed" }, denied ? 401 : 502);
  }
  return json(data);
});
