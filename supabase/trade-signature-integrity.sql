create unique index if not exists trades_tx_signature_unique
on public.trades (tx_signature)
where tx_signature is not null;

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
set search_path = ''
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(p_tx_signature), '') is null then
    return jsonb_build_object('ok', false, 'error', 'transaction signature required', 'status', 400);
  end if;

  insert into public.trades (
    privy_user_id, user_pubkey, mint, side, sol_amount, token_amount,
    price_usd, fee_sol, tx_signature, kind
  ) values (
    p_privy_user_id, nullif(p_user_pubkey, ''), p_mint,
    case when p_side = 'sell' then 'sell' else 'buy' end,
    p_sol_amount, p_token_amount, p_price_usd, greatest(coalesce(p_fee_sol, 0), 0),
    trim(p_tx_signature), coalesce(nullif(p_kind, ''), 'manual')
  );

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'transaction already recorded', 'status', 409);
end;
$$;

revoke execute on function public.app_user_insert_trade(text, text, text, text, text, numeric, numeric, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function public.app_user_insert_trade(text, text, text, text, text, numeric, numeric, numeric, numeric, text, text) to service_role;

create or replace function public.app_supabase_insert_trade(
  p_secret text,
  p_user_id uuid,
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
set search_path = ''
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(p_tx_signature), '') is null then
    return jsonb_build_object('ok', false, 'error', 'transaction signature required', 'status', 400);
  end if;

  insert into public.trades (
    user_id, user_pubkey, mint, side, sol_amount, token_amount,
    price_usd, fee_sol, tx_signature, kind
  ) values (
    p_user_id, nullif(p_user_pubkey, ''), p_mint,
    case when p_side = 'sell' then 'sell' else 'buy' end,
    p_sol_amount, p_token_amount, p_price_usd, greatest(coalesce(p_fee_sol, 0), 0),
    trim(p_tx_signature), coalesce(nullif(p_kind, ''), 'manual')
  );

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'transaction already recorded', 'status', 409);
end;
$$;

revoke execute on function public.app_supabase_insert_trade(text, uuid, text, text, text, numeric, numeric, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function public.app_supabase_insert_trade(text, uuid, text, text, text, numeric, numeric, numeric, numeric, text, text) to service_role;
