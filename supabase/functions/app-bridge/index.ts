import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const operations: Record<string, string[]> = {
  app_submit_server_application: ["p_secret", "p_server_name", "p_invite_link", "p_owner_handle", "p_member_count", "p_pitch"],
  admin_list_server_applications: ["p_secret"],
  admin_decide_server_application: ["p_secret", "p_id", "p_action"],
  admin_list_call_channels: ["p_secret"],
  admin_decide_call_channel: ["p_secret", "p_id", "p_action"],
  admin_dashboard_summary: ["p_secret"],
  app_user_list_trades: ["p_secret", "p_privy_user_id"],
  app_user_insert_trade: [
    "p_secret", "p_privy_user_id", "p_user_pubkey", "p_mint", "p_side",
    "p_sol_amount", "p_token_amount", "p_price_usd", "p_fee_sol", "p_tx_signature", "p_kind"
  ],
  app_supabase_insert_trade: [
    "p_secret", "p_user_id", "p_user_pubkey", "p_mint", "p_side",
    "p_sol_amount", "p_token_amount", "p_price_usd", "p_fee_sol", "p_tx_signature", "p_kind"
  ],
  app_user_list_subscriptions: ["p_secret", "p_privy_user_id"],
  app_user_upsert_subscription: ["p_secret", "p_privy_user_id", "p_group_id", "p_payload"],
  app_user_list_limit_orders: ["p_secret", "p_privy_user_id"],
  app_user_create_limit_order: ["p_secret", "p_privy_user_id", "p_payload"],
  app_user_update_limit_order: ["p_secret", "p_privy_user_id", "p_id", "p_action", "p_sig"],
  app_user_list_copy_subscriptions: ["p_secret", "p_privy_user_id"],
  app_user_upsert_copy_subscription: ["p_secret", "p_privy_user_id", "p_payload"],
  app_user_delete_copy_subscription: ["p_secret", "p_privy_user_id", "p_leader_wallet"],
  app_user_get_profile: ["p_secret", "p_privy_user_id"],
  app_user_upsert_profile: ["p_secret", "p_privy_user_id", "p_payload"]
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

  const operation = typeof body.operation === "string" ? body.operation : "";
  const allowed = Object.hasOwn(operations, operation) ? operations[operation] : null;
  if (!allowed) return json({ error: "unknown operation" }, 400);

  const params = Object.fromEntries(allowed.map((key) => [key, body[key] ?? null]));
  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await client.rpc(operation, params);

  if (error) {
    const denied = error.code === "42501";
    return json({ error: denied ? "unauthorized" : "bridge operation failed" }, denied ? 401 : 502);
  }
  return json(data);
});
