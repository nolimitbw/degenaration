import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const operations: Record<string, string[]> = {
  app_submit_server_application: ["p_secret", "p_server_name", "p_invite_link", "p_owner_handle", "p_member_count", "p_pitch"],
  admin_list_server_applications: ["p_secret"],
  admin_decide_server_application_v2: [
    "p_secret", "p_actor_privy_user_id", "p_id", "p_action", "p_reason"
  ],
  admin_list_call_channels: ["p_secret"],
  admin_decide_call_channel_v2: [
    "p_secret", "p_actor_privy_user_id", "p_id", "p_action", "p_reason"
  ],
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
  app_user_upsert_profile: ["p_secret", "p_privy_user_id", "p_payload"],
  app_sync_verified_identity: [
    "p_secret", "p_privy_user_id", "p_provider", "p_provider_subject",
    "p_email", "p_email_verified"
  ],
  app_user_get_access: ["p_secret", "p_privy_user_id"],
  app_user_upsert_wallet: [
    "p_secret", "p_privy_user_id", "p_wallet_address", "p_privy_wallet_id", "p_label"
  ],
  app_user_save_bot: ["p_secret", "p_privy_user_id", "p_payload"],
  app_user_list_bots: ["p_secret", "p_privy_user_id", "p_kind"],
  app_user_get_bot: ["p_secret", "p_privy_user_id", "p_bot_id"],
  app_user_get_bot_activity: ["p_secret", "p_privy_user_id", "p_bot_id", "p_limit"],
  app_public_list_discord_marketplace: ["p_secret", "p_period", "p_sort", "p_limit"],
  app_public_list_kol_marketplace: ["p_secret", "p_period", "p_sort", "p_limit"],
  app_user_upsert_kol_subscription: [
    "p_secret", "p_privy_user_id", "p_strategy_id", "p_payload"
  ],
  app_user_list_kol_subscriptions: ["p_secret", "p_privy_user_id"],
  app_user_affiliate_summary: ["p_secret", "p_privy_user_id", "p_scope"],
  app_public_resolve_referral: [
    "p_secret", "p_code", "p_visitor_hash", "p_idempotency_key"
  ],
  app_user_complete_referral_attribution: [
    "p_secret", "p_privy_user_id", "p_code", "p_visitor_hash",
    "p_capture_nonce", "p_captured_at"
  ],
  app_user_check_referral_slug: ["p_secret", "p_privy_user_id", "p_slug"],
  app_user_change_referral_slug: [
    "p_secret", "p_privy_user_id", "p_slug", "p_confirmed"
  ],
  app_user_request_payout: [
    "p_secret", "p_privy_user_id", "p_destination_wallet", "p_gross_lamports"
  ],
  app_user_portfolio_summary: ["p_secret", "p_privy_user_id", "p_period"],
  app_user_withdrawable_state: ["p_secret", "p_privy_user_id"],
  app_user_record_pnl_card: [
    "p_secret", "p_privy_user_id", "p_card_type", "p_subject_type",
    "p_subject_id", "p_snapshot", "p_referral_code", "p_render_version"
  ],
  app_scanner_status: ["p_secret"],
  app_consume_rate_limit: [
    "p_secret", "p_scope", "p_subject_hash", "p_limit", "p_window_seconds", "p_cost"
  ],
  admin_product_overview: ["p_secret", "p_actor_privy_user_id"],
  admin_list_kol_strategies: ["p_secret", "p_actor_privy_user_id", "p_status", "p_limit"],
  admin_decide_kol_strategy: [
    "p_secret", "p_actor_privy_user_id", "p_strategy_id", "p_action", "p_reason"
  ],
  admin_list_payout_requests: [
    "p_secret", "p_actor_privy_user_id", "p_status", "p_limit"
  ],
  admin_decide_payout_v2: [
    "p_secret", "p_actor_privy_user_id", "p_payout_id", "p_action",
    "p_reason", "p_tx_signature"
  ],
  admin_list_app_users: ["p_secret", "p_actor_privy_user_id", "p_limit"],
  admin_list_trade_executions: [
    "p_secret", "p_actor_privy_user_id", "p_status", "p_limit"
  ],
  admin_scanner_health: ["p_secret", "p_actor_privy_user_id"],
  admin_list_audit_log: ["p_secret", "p_actor_privy_user_id", "p_limit"],
  admin_list_system_flags: ["p_secret", "p_actor_privy_user_id"],
  admin_update_system_flag_v2: [
    "p_secret", "p_actor_privy_user_id", "p_flag_key", "p_value", "p_reason"
  ],
  admin_source_action: [
    "p_secret", "p_actor_privy_user_id", "p_source_group_id", "p_action", "p_reason"
  ],
  admin_list_referrals_v2: [
    "p_secret", "p_actor_privy_user_id", "p_query", "p_limit"
  ]
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
