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
  // Onboarding step 0 is gated on this (app/onboarding/page.tsx:30 -> app/api/user/profile
  // /route.ts:64). It was never allowlisted in any commit, so the call has always returned
  // "unknown operation" and no user has ever cleared step 0 -- public.privy_profiles has
  // zero rows in production, which corroborates it. See docs/ai/DEPLOYMENT_DRIFT_REPORT.md A-2.
  app_user_set_risk_acceptance: ["p_secret", "p_privy_user_id", "p_accepted"],
  app_sync_verified_identity: [
    "p_secret", "p_privy_user_id", "p_provider", "p_provider_subject",
    "p_email", "p_email_verified"
  ],
  app_user_get_access: ["p_secret", "p_privy_user_id"],
  app_user_upsert_wallet: [
    "p_secret", "p_privy_user_id", "p_wallet_address", "p_privy_wallet_id", "p_label"
  ],
  app_user_primary_wallet: ["p_secret", "p_privy_user_id"],
  app_user_save_bot: ["p_secret", "p_privy_user_id", "p_payload"],
  // The other half of app/api/product/bots/route.ts:50-52. An ACTIVE bot goes to
  // app_user_save_bot; anything else goes here. Without this entry the draft branch answers
  // "unknown operation", and since the active branch is separately refused by
  // AUTOMATED_MAINNET_RELEASE, NO bot could be saved at all. Defect A-1.
  app_user_save_mainnet_bot_draft: ["p_secret", "p_privy_user_id", "p_payload"],
  app_user_list_bots: ["p_secret", "p_privy_user_id", "p_kind"],
  app_user_get_bot: ["p_secret", "p_privy_user_id", "p_bot_id"],
  app_user_delete_bot: ["p_secret", "p_privy_user_id", "p_bot_id"],
  app_user_get_bot_activity: ["p_secret", "p_privy_user_id", "p_bot_id", "p_limit"],
  app_user_bot_run_facts: [
    "p_secret", "p_privy_user_id", "p_bot_id", "p_source_group_id", "p_channel_id",
    "p_buy_lamports", "p_daily_cap_lamports"
  ],
  app_user_trade_history: ["p_secret", "p_privy_user_id", "p_limit"],
  app_automation_runtime_facts: ["p_secret"],
  app_public_list_discord_marketplace: ["p_secret", "p_period", "p_sort", "p_limit"],
  app_public_discord_journal_stats: ["p_secret", "p_period"],
  app_public_list_kol_marketplace: ["p_secret", "p_period", "p_sort", "p_limit"],
  app_user_upsert_kol_subscription: [
    "p_secret", "p_privy_user_id", "p_strategy_id", "p_payload"
  ],
  app_user_list_kol_subscriptions: ["p_secret", "p_privy_user_id"],
  app_user_affiliate_summary: ["p_secret", "p_privy_user_id", "p_scope"],
  app_user_get_discord_link_session: ["p_secret", "p_privy_user_id", "p_session_id"],
  app_user_complete_discord_owner_link: [
    "p_secret", "p_privy_user_id", "p_session_id",
    "p_verified_discord_user_id", "p_verified_discord_username"
  ],
  app_user_discord_ownership_summary: ["p_secret", "p_privy_user_id"],
  app_user_revoke_discord_owner_link: ["p_secret", "p_privy_user_id", "p_reason"],
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
  app_user_open_withdrawal_intent: [
    "p_secret", "p_privy_user_id", "p_wallet_address", "p_destination_address", "p_amount_lamports"
  ],
  app_user_record_withdrawal_signature: [
    "p_secret", "p_privy_user_id", "p_intent_id", "p_tx_signature"
  ],
  app_user_settle_withdrawal: [
    "p_secret", "p_privy_user_id", "p_intent_id", "p_outcome", "p_error"
  ],
  // The network reconciliation app_user_settle_withdrawal deliberately refuses to do on a
  // client's say-so. Reached only by /api/product/portfolio/withdraw/reconcile, which reads
  // the transaction first and passes what it saw.
  app_user_reconcile_withdrawal: [
    "p_secret", "p_privy_user_id", "p_intent_id", "p_landed", "p_succeeded", "p_error"
  ],
  app_user_pending_withdrawals: ["p_secret", "p_privy_user_id", "p_older_than_seconds"],
  app_user_list_withdrawals: ["p_secret", "p_privy_user_id", "p_limit"],
  app_user_record_pnl_card: [
    "p_secret", "p_privy_user_id", "p_card_type", "p_subject_type",
    "p_subject_id", "p_snapshot", "p_referral_code", "p_render_version"
  ],
  app_scanner_status: ["p_secret"],
  // Whether a worker is heartbeating, and how stale. The RUN readiness check needs it and
  // cannot reach the worker's own /health port -- that answers whoever can reach the container,
  // and the app is not on that network. The database is where both sides already meet.
  app_worker_liveness: ["p_secret"],
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
  // Spec section 8. Every figure these return aggregates trade_executions, positions and
  // withdrawal_intents, which only gained a writer in d554243 -- before that they would have
  // reported zero for every client.
  admin_client_ledger: ["p_secret", "p_actor_privy_user_id", "p_limit"],
  admin_business_summary: ["p_secret", "p_actor_privy_user_id"],
  // Revenue is a separate operation from admin_business_summary rather than more fields on it,
  // because it carries the allocation-drift verdict an operator must read before trusting any
  // other figure -- and a caller that only wants the client table should not have to fetch it.
  admin_revenue_summary: ["p_secret", "p_actor_privy_user_id"],
  // Withdrawing platform revenue. A FOURTH money ledger, deliberately: reusing the creator
  // payout ledger would report creator payouts as company withdrawals and double-count the
  // allocation trade_executions already removes once.
  admin_open_revenue_withdrawal: [
    "p_secret", "p_actor_privy_user_id", "p_mint", "p_destination_address", "p_amount_base_units"
  ],
  admin_record_revenue_withdrawal_signature: [
    "p_secret", "p_actor_privy_user_id", "p_id", "p_tx_signature"
  ],
  admin_settle_revenue_withdrawal: [
    "p_secret", "p_actor_privy_user_id", "p_id", "p_outcome", "p_error"
  ],
  admin_list_revenue_withdrawals: ["p_secret", "p_actor_privy_user_id", "p_limit"],
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
  admin_list_discord_ownership: ["p_secret", "p_actor_privy_user_id", "p_limit"],
  admin_resolve_discord_ownership: [
    "p_secret", "p_actor_privy_user_id", "p_source_group_id", "p_action",
    "p_target_privy_user_id", "p_discord_user_id", "p_reason"
  ],
  admin_list_referrals_v2: [
    "p_secret", "p_actor_privy_user_id", "p_query", "p_limit"
  ],
  // Recomputes app_private.performance_snapshots from the ledger. Portfolio, My Bots, the
  // KOL cards and the Discord 1D/7D/30D figures all read that table and it had no writer at
  // all until cbeabe5, so every one of them showed a dash.
  admin_refresh_performance: ["p_secret", "p_actor_privy_user_id"],
  // What closed a position and at what price. The PnL card needs it: a closed trade's
  // average exit is proceeds/quantity from app_private.position_exits, and before that table
  // existed no ledger linked a position to the executions that closed it.
  app_user_position_exits: ["p_secret", "p_privy_user_id", "p_position_id"],
  // Section 8's client detail: one client's balances, wallets, positions, executions,
  // withdrawals, commissions, referrals, bots, failures and audit events.
  admin_client_detail: ["p_secret", "p_actor_privy_user_id", "p_privy_user_id"]
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
    if (error.code === "42501") return json({ error: "unauthorized" }, 401);

    // A DELIBERATE refusal is not an outage, and must not be reported as one.
    //
    // These functions guard themselves with `raise exception ... using errcode`, and the
    // message is written for the person reading it: "archived bot cannot be restored",
    // "bot has open positions". Every one of them was being flattened into 502, which
    // lib/server/app-bridge.ts renders as "This is temporarily unavailable. Please try
    // again shortly." So a permanent, correct refusal told the user to keep retrying
    // something that could never succeed — which is exactly what happened on RUN for an
    // archived bot.
    //
    // 23514 is check_violation and P0001 is the default for a bare `raise exception`. Both
    // are also produced by Postgres itself for a real constraint or trigger failure, and
    // THOSE messages name relations and columns. Auto-generated wording is excluded below
    // rather than trusted, so a schema error still reads as a generic failure.
    const message = typeof error.message === "string" ? error.message : "";
    const autoGenerated = /violates check constraint|new row for relation|duplicate key value|violates foreign key|null value in column/i.test(message);
    const deliberate = (error.code === "23514" || error.code === "P0001")
      && message.length > 0 && message.length <= 200 && !autoGenerated;
    if (deliberate) return json({ ok: false, status: 409, error: message }, 200);

    return json({ error: "bridge operation failed" }, 502);
  }
  return json(data);
});
