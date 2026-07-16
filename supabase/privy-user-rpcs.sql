-- Server-side RPCs for Privy-authenticated user state.
-- The Next.js API verifies Privy, then calls these with ADMIN_KEY so Vercel does
-- not need the Supabase service_role key for user-owned rows.

create or replace function public.app_user_list_trades(p_secret text, p_privy_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select id, mint, side, sol_amount, price_usd, fee_sol, kind, created_at
    from public.trades
    where privy_user_id = p_privy_user_id
    order by created_at desc
    limit 50
  ) t;
  return v_rows;
end;
$$;

create or replace function public.app_user_insert_trade(
  p_secret text,
  p_privy_user_id text,
  p_user_pubkey text,
  p_mint text,
  p_side text,
  p_sol_amount numeric,
  p_token_amount numeric,
  p_price_usd numeric,
  p_fee_sol numeric,
  p_tx_signature text,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  insert into public.trades (
    privy_user_id, user_pubkey, mint, side, sol_amount, token_amount,
    price_usd, fee_sol, tx_signature, kind
  ) values (
    p_privy_user_id, nullif(p_user_pubkey, ''), p_mint,
    case when p_side = 'sell' then 'sell' else 'buy' end,
    p_sol_amount, p_token_amount, p_price_usd, p_fee_sol,
    nullif(p_tx_signature, ''), coalesce(nullif(p_kind, ''), 'manual')
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.app_user_list_subscriptions(p_secret text, p_privy_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  into v_rows
  from (
    select group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell, stop_loss,
      slippage_bps, daily_cap_sol, enabled
    from public.subscriptions
    where privy_user_id = p_privy_user_id
    order by created_at desc
  ) s;
  return v_rows;
end;
$$;

create or replace function public.app_user_upsert_subscription(
  p_secret text,
  p_privy_user_id text,
  p_group_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_row jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select id into v_id
  from public.subscriptions
  where privy_user_id = p_privy_user_id and group_id = p_group_id
  limit 1;

  if v_id is null then
    insert into public.subscriptions (
      privy_user_id, group_id, size_sol, tp1, tp1_sell, tp2, tp2_sell,
      stop_loss, slippage_bps, daily_cap_sol, enabled, user_pubkey, wallet_id
    ) values (
      p_privy_user_id, p_group_id,
      (p_payload->>'size_sol')::numeric,
      (p_payload->>'tp1')::numeric,
      (p_payload->>'tp1_sell')::integer,
      (p_payload->>'tp2')::numeric,
      (p_payload->>'tp2_sell')::integer,
      (p_payload->>'stop_loss')::integer,
      (p_payload->>'slippage_bps')::integer,
      (p_payload->>'daily_cap_sol')::numeric,
      coalesce((p_payload->>'enabled')::boolean, true),
      nullif(p_payload->>'user_pubkey', ''),
      nullif(p_payload->>'wallet_id', '')
    )
    returning to_jsonb(subscriptions.*) into v_row;
  else
    update public.subscriptions
    set size_sol = (p_payload->>'size_sol')::numeric,
      tp1 = (p_payload->>'tp1')::numeric,
      tp1_sell = (p_payload->>'tp1_sell')::integer,
      tp2 = (p_payload->>'tp2')::numeric,
      tp2_sell = (p_payload->>'tp2_sell')::integer,
      stop_loss = (p_payload->>'stop_loss')::integer,
      slippage_bps = (p_payload->>'slippage_bps')::integer,
      daily_cap_sol = (p_payload->>'daily_cap_sol')::numeric,
      enabled = coalesce((p_payload->>'enabled')::boolean, true),
      user_pubkey = nullif(p_payload->>'user_pubkey', ''),
      wallet_id = nullif(p_payload->>'wallet_id', '')
    where id = v_id
    returning to_jsonb(subscriptions.*) into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.app_user_list_limit_orders(p_secret text, p_privy_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select id, mint, symbol, trigger, target_usd, amount_sol, slippage_bps,
      user_pubkey, status, created_at, sig
    from public.limit_orders
    where privy_user_id = p_privy_user_id
    order by created_at desc
  ) o;
  return v_rows;
end;
$$;

create or replace function public.app_user_create_limit_order(
  p_secret text,
  p_privy_user_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  insert into public.limit_orders (
    privy_user_id, mint, symbol, trigger, target_usd, amount_sol,
    slippage_bps, user_pubkey, wallet_id, status
  ) values (
    p_privy_user_id,
    p_payload->>'mint',
    nullif(p_payload->>'symbol', ''),
    case when p_payload->>'trigger' = 'above' then 'above' else 'below' end,
    (p_payload->>'target_usd')::numeric,
    (p_payload->>'amount_sol')::numeric,
    (p_payload->>'slippage_bps')::integer,
    p_payload->>'user_pubkey',
    nullif(p_payload->>'wallet_id', ''),
    'open'
  )
  returning to_jsonb(limit_orders.*) into v_row;

  return v_row;
end;
$$;

create or replace function public.app_user_update_limit_order(
  p_secret text,
  p_privy_user_id text,
  p_id uuid,
  p_action text,
  p_sig text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.limit_orders
  set status = case when p_action = 'filled' then 'filled' else 'cancelled' end,
    sig = case when p_action = 'filled' then nullif(p_sig, '') else sig end,
    filled_at = case when p_action = 'filled' then now() else filled_at end
  where id = p_id and privy_user_id = p_privy_user_id and status = 'open';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not found', 'status', 404);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.app_user_list_copy_subscriptions(p_secret text, p_privy_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select id, leader_wallet, label, size_sol, slippage_bps, daily_cap_sol,
      enabled, tp1, tp1_sell, tp2, tp2_sell, stop_loss
    from public.copy_subscriptions
    where privy_user_id = p_privy_user_id
    order by created_at desc
  ) c;
  return v_rows;
end;
$$;

create or replace function public.app_user_upsert_copy_subscription(
  p_secret text,
  p_privy_user_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_row jsonb;
  v_leader text := p_payload->>'leader_wallet';
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select id into v_id
  from public.copy_subscriptions
  where privy_user_id = p_privy_user_id and leader_wallet = v_leader
  limit 1;

  if v_id is null then
    insert into public.copy_subscriptions (
      privy_user_id, leader_wallet, label, size_sol, slippage_bps,
      daily_cap_sol, tp1, tp1_sell, tp2, tp2_sell, stop_loss,
      enabled, user_pubkey, wallet_id
    ) values (
      p_privy_user_id, v_leader, nullif(p_payload->>'label', ''),
      (p_payload->>'size_sol')::numeric,
      (p_payload->>'slippage_bps')::integer,
      (p_payload->>'daily_cap_sol')::numeric,
      (p_payload->>'tp1')::numeric,
      (p_payload->>'tp1_sell')::integer,
      (p_payload->>'tp2')::numeric,
      (p_payload->>'tp2_sell')::integer,
      (p_payload->>'stop_loss')::integer,
      coalesce((p_payload->>'enabled')::boolean, true),
      p_payload->>'user_pubkey',
      nullif(p_payload->>'wallet_id', '')
    )
    returning to_jsonb(copy_subscriptions.*) into v_row;
  else
    update public.copy_subscriptions
    set label = nullif(p_payload->>'label', ''),
      size_sol = (p_payload->>'size_sol')::numeric,
      slippage_bps = (p_payload->>'slippage_bps')::integer,
      daily_cap_sol = (p_payload->>'daily_cap_sol')::numeric,
      tp1 = (p_payload->>'tp1')::numeric,
      tp1_sell = (p_payload->>'tp1_sell')::integer,
      tp2 = (p_payload->>'tp2')::numeric,
      tp2_sell = (p_payload->>'tp2_sell')::integer,
      stop_loss = (p_payload->>'stop_loss')::integer,
      enabled = coalesce((p_payload->>'enabled')::boolean, true),
      user_pubkey = p_payload->>'user_pubkey',
      wallet_id = nullif(p_payload->>'wallet_id', '')
    where id = v_id
    returning to_jsonb(copy_subscriptions.*) into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.app_user_delete_copy_subscription(
  p_secret text,
  p_privy_user_id text,
  p_leader_wallet text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  delete from public.copy_subscriptions
  where privy_user_id = p_privy_user_id and leader_wallet = p_leader_wallet;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.app_user_list_trades(text, text) to anon, authenticated;
grant execute on function public.app_user_insert_trade(text, text, text, text, text, numeric, numeric, numeric, numeric, text, text) to anon, authenticated;
grant execute on function public.app_user_list_subscriptions(text, text) to anon, authenticated;
grant execute on function public.app_user_upsert_subscription(text, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.app_user_list_limit_orders(text, text) to anon, authenticated;
grant execute on function public.app_user_create_limit_order(text, text, jsonb) to anon, authenticated;
grant execute on function public.app_user_update_limit_order(text, text, uuid, text, text) to anon, authenticated;
grant execute on function public.app_user_list_copy_subscriptions(text, text) to anon, authenticated;
grant execute on function public.app_user_upsert_copy_subscription(text, text, jsonb) to anon, authenticated;
grant execute on function public.app_user_delete_copy_subscription(text, text, text) to anon, authenticated;
