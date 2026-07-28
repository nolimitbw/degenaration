create index if not exists auth_identities_privy_user_idx
  on app_private.auth_identities (privy_user_id);

create index if not exists bot_profiles_current_version_idx
  on app_private.bot_profiles (current_version_id);

create index if not exists bot_profiles_source_group_idx
  on app_private.bot_profiles (source_group_id);

create index if not exists bot_profiles_wallet_idx
  on app_private.bot_profiles (wallet_id);

create index if not exists cash_movements_wallet_idx
  on app_private.cash_movements (wallet_id);

create index if not exists commission_ledger_execution_idx
  on app_private.commission_ledger_entries (execution_id);

create index if not exists commission_ledger_payout_request_idx
  on app_private.commission_ledger_entries (payout_request_id);

create index if not exists kol_strategies_owner_idx
  on app_private.kol_strategies (owner_privy_user_id);

create index if not exists kol_subscriptions_strategy_version_idx
  on app_private.kol_subscriptions (strategy_version_id);

create index if not exists kol_subscriptions_wallet_idx
  on app_private.kol_subscriptions (wallet_id);

create index if not exists market_snapshots_pool_idx
  on app_private.market_snapshots (pool_id);

create index if not exists pnl_card_records_referral_link_idx
  on app_private.pnl_card_records (referral_link_id);

create index if not exists position_lots_entry_execution_idx
  on app_private.position_lots (entry_execution_id);

create index if not exists position_lots_position_idx
  on app_private.position_lots (position_id);

create index if not exists positions_bot_idx
  on app_private.positions (bot_id);

create index if not exists positions_config_version_idx
  on app_private.positions (config_version_id);

create index if not exists scanner_pools_adapter_idx
  on app_private.scanner_pools (adapter_key);

create index if not exists signal_deliveries_config_version_idx
  on app_private.signal_deliveries (config_version_id);

create index if not exists signal_deliveries_parsed_signal_idx
  on app_private.signal_deliveries (parsed_signal_id);

create index if not exists source_ownership_owner_idx
  on app_private.source_ownership_history (owner_privy_user_id);

create index if not exists source_ownership_identity_idx
  on app_private.source_ownership_history (verified_identity_id);

create index if not exists trade_intents_bot_idx
  on app_private.trade_intents (bot_id);

create index if not exists trade_intents_config_version_idx
  on app_private.trade_intents (config_version_id);

create index if not exists trade_intents_signal_delivery_idx
  on app_private.trade_intents (signal_delivery_id);

create index if not exists subscriptions_config_version_idx
  on public.subscriptions (config_version_id);
