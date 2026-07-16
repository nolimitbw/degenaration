create table if not exists public.privy_profiles (
  privy_user_id text primary key,
  wallet_address text,
  max_trade_sol numeric not null default 0.5,
  daily_cap_sol numeric not null default 2,
  quick_buy_amounts numeric[] not null default '{0.1,0.5,1,2}',
  risk_accepted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privy_profiles_max_trade check (max_trade_sol > 0 and max_trade_sol <= 100),
  constraint privy_profiles_daily_cap check (daily_cap_sol > 0 and daily_cap_sol <= 1000 and daily_cap_sol >= max_trade_sol)
);

alter table public.privy_profiles enable row level security;
revoke all on table public.privy_profiles from public, anon, authenticated;
grant select, insert, update on table public.privy_profiles to service_role;

create index if not exists privy_profiles_wallet_address_idx
  on public.privy_profiles (wallet_address)
  where wallet_address is not null;

create or replace function public.app_user_get_profile(
  p_secret text,
  p_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(p_privy_user_id), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid user', 'status', 400);
  end if;

  select to_jsonb(p) - 'privy_user_id'
  into v_profile
  from public.privy_profiles p
  where p.privy_user_id = p_privy_user_id;

  return coalesce(v_profile, jsonb_build_object(
    'wallet_address', null,
    'max_trade_sol', 0.5,
    'daily_cap_sol', 2,
    'quick_buy_amounts', jsonb_build_array(0.1, 0.5, 1, 2),
    'risk_accepted', false
  ));
end;
$$;

create or replace function public.app_user_upsert_profile(
  p_secret text,
  p_privy_user_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.privy_profiles%rowtype;
  v_wallet text;
  v_max numeric;
  v_daily numeric;
  v_quick numeric[];
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(p_privy_user_id), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid user', 'status', 400);
  end if;

  select * into v_existing
  from public.privy_profiles
  where privy_user_id = p_privy_user_id;

  v_wallet := case when p_payload ? 'wallet_address'
    then nullif(trim(p_payload->>'wallet_address'), '')
    else v_existing.wallet_address end;
  v_max := case when p_payload ? 'max_trade_sol'
    then (p_payload->>'max_trade_sol')::numeric
    else coalesce(v_existing.max_trade_sol, 0.5) end;
  v_daily := case when p_payload ? 'daily_cap_sol'
    then (p_payload->>'daily_cap_sol')::numeric
    else coalesce(v_existing.daily_cap_sol, 2) end;
  v_quick := case when p_payload ? 'quick_buy_amounts'
    then array(select jsonb_array_elements_text(p_payload->'quick_buy_amounts')::numeric)
    else coalesce(v_existing.quick_buy_amounts, '{0.1,0.5,1,2}') end;

  if v_wallet is not null and v_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid wallet', 'status', 400);
  end if;
  if v_max <= 0 or v_max > 100 or v_daily < v_max or v_daily > 1000 then
    return jsonb_build_object('ok', false, 'error', 'invalid trade limits', 'status', 400);
  end if;
  if cardinality(v_quick) < 1 or cardinality(v_quick) > 4
    or exists (select 1 from unnest(v_quick) amount where amount <= 0 or amount > 100) then
    return jsonb_build_object('ok', false, 'error', 'invalid quick-buy amounts', 'status', 400);
  end if;

  insert into public.privy_profiles (
    privy_user_id, wallet_address, max_trade_sol, daily_cap_sol, quick_buy_amounts, updated_at
  ) values (
    p_privy_user_id, v_wallet, v_max, v_daily, v_quick, now()
  )
  on conflict (privy_user_id) do update set
    wallet_address = excluded.wallet_address,
    max_trade_sol = excluded.max_trade_sol,
    daily_cap_sol = excluded.daily_cap_sol,
    quick_buy_amounts = excluded.quick_buy_amounts,
    updated_at = now();

  return jsonb_build_object('ok', true);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'error', 'invalid profile values', 'status', 400);
end;
$$;

revoke execute on function public.app_user_get_profile(text, text) from public, anon, authenticated;
grant execute on function public.app_user_get_profile(text, text) to service_role;
revoke execute on function public.app_user_upsert_profile(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.app_user_upsert_profile(text, text, jsonb) to service_role;
