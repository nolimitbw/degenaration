-- Attribute a worker position to the bot that opened it.
--
-- WHY
--
-- public.positions carried no bot linkage, so the archival guard in
-- degenaration-bot-lifecycle-safety.sql had to reach a bot's positions through
-- `join public.positions wp on wp.group_id = s.group_id`. That join is unsound twice over:
--
--   1. worker_load_submitted_executions returns `null::uuid as group_id` for the copy
--      path, and settlement.js passes it through, so every copy-opened position has
--      group_id NULL. `NULL = s.group_id` is never true.
--   2. KOL bots have no source_group_id at all, so no KOL bot could ever be matched.
--
-- Either way a bot holding open, funded positions archived cleanly — the defect the
-- guard exists to prevent.
--
-- Resolution happens inside worker_open_position rather than by threading a new column
-- through the loader and the JS settlement path, because the RPC already receives the
-- group and owner it needs. Copy positions resolve to NULL, which is correct: wallet-copy
-- subscriptions are not bots and must not block bot archival.
--
-- Forward safety: the column is nullable, so existing rows keep working and the guard
-- retains a group-based fallback for any position opened before this migration.
-- Rollback: restore the previous worker_open_position signature, drop the trigger branch
-- that reads bot_profile_id, then drop the column. No position history is rewritten.

alter table public.positions
  add column if not exists bot_profile_id uuid
    references app_private.bot_profiles(id) on delete set null;

create index if not exists positions_bot_profile_open_idx
  on public.positions (bot_profile_id)
  where bot_profile_id is not null and closed_at is null;

-- The old signature must be dropped, not replaced: adding a defaulted parameter creates a
-- second overload and every existing call becomes ambiguous.
drop function if exists public.worker_open_position(
  text, text, text, numeric, numeric, text, integer, numeric, integer, numeric,
  integer, integer, text, uuid, uuid
);

create or replace function public.worker_open_position(
  p_user_pubkey text,
  p_wallet_id text,
  p_mint text,
  p_entry_price_usd numeric,
  p_amount_raw numeric,
  p_entry_sig text,
  p_slippage_bps integer default 300,
  p_tp1 numeric default null,
  p_tp1_sell integer default 0,
  p_tp2 numeric default null,
  p_tp2_sell integer default 0,
  p_stop_loss integer default null,
  p_privy_user_id text default null,
  p_group_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.positions%rowtype;
  v_bot_profile_id uuid;
begin
  if nullif(trim(p_entry_sig), '') is null then
    return jsonb_build_object('ok', false, 'error', 'entry signature required', 'status', 400);
  end if;
  if p_amount_raw is null or p_amount_raw <= 0 then
    return jsonb_build_object('ok', false, 'error', 'amount must be positive', 'status', 400);
  end if;
  if p_entry_price_usd is null or p_entry_price_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'entry price required', 'status', 400);
  end if;

  -- Resolved from the subscription that produced this buy. Scoped to the owner as well as
  -- the source: a Discord source is shared, so group alone would attribute another user's
  -- position to this bot. Copy buys pass p_group_id = null and resolve to null.
  if p_group_id is not null then
    select s.bot_profile_id into v_bot_profile_id
    from public.subscriptions s
    where s.group_id = p_group_id
      and s.bot_profile_id is not null
      and (
        (p_privy_user_id is not null and s.privy_user_id = p_privy_user_id)
        or (p_user_id is not null and s.user_id = p_user_id)
      )
    limit 1;
  end if;

  insert into public.positions (
    user_id, privy_user_id, user_pubkey, wallet_id, group_id, mint,
    entry_price_usd, amount_raw, original_amount_raw,
    tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps, entry_sig, status,
    bot_profile_id
  ) values (
    p_user_id, p_privy_user_id, p_user_pubkey, p_wallet_id, p_group_id, p_mint,
    p_entry_price_usd, p_amount_raw, p_amount_raw,
    p_tp1, coalesce(p_tp1_sell, 0), p_tp2, coalesce(p_tp2_sell, 0),
    p_stop_loss, coalesce(p_slippage_bps, 300), trim(p_entry_sig), 'open',
    v_bot_profile_id
  )
  on conflict (entry_sig) where entry_sig is not null do nothing
  returning * into v_row;

  if not found then
    -- Already captured. Idempotent by design: the caller retried, which must not open a
    -- second position for one buy.
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'position', to_jsonb(v_row));
end;
$$;

revoke execute on function public.worker_open_position(
  text, text, text, numeric, numeric, text, integer, numeric, integer, numeric,
  integer, integer, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.worker_open_position(
  text, text, text, numeric, numeric, text, integer, numeric, integer, numeric,
  integer, integer, text, uuid, uuid
) to service_role;
