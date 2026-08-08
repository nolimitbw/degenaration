-- Position-level user trade history from immutable execution, lot and exit journals.
-- No market price is persisted here; the API pairs these facts with fresh quotes.
-- Rollback: supabase/rollback/28-user-trade-history.sql

create or replace function public.app_user_trade_history(
  p_secret text,
  p_privy_user_id text,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_privy_user_id, '')), '') is null then
    raise exception 'invalid user' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x."openedAt" desc), '[]'::jsonb)
  into v_rows
  from (
    select
      p.id,
      p.bot_id as "botId",
      b.name as "botName",
      b.kind as "sourceKind",
      coalesce(g.name, ks.slug, b.name, 'Unassigned') as "sourceName",
      p.mint,
      p.status,
      p.quantity_base_units::text as "quantityBaseUnits",
      p.cost_lamports::text as "investedLamports",
      p.realized_pnl_lamports::text as "realizedPnlLamports",
      p.entry_config_snapshot as "entryConfig",
      p.opened_at as "openedAt",
      p.updated_at as "updatedAt",
      p.closed_at as "closedAt",
      en."averageEntryPriceUsd",
      en."entryQuantityBaseUnits",
      en."entrySignatures",
      ex."averageExitPriceUsd",
      ex."exitedQuantityBaseUnits",
      ex."proceedsLamports",
      ex."releasedBasisLamports",
      (coalesce(en.entry_platform_fee, 0) + coalesce(ex.exit_platform_fee, 0))::text as "platformFeeLamports",
      (coalesce(en.entry_creator_fee, 0) + coalesce(ex.exit_creator_fee, 0))::text as "creatorFeeLamports",
      (coalesce(en.entry_referral_fee, 0) + coalesce(ex.exit_referral_fee, 0))::text as "referralFeeLamports",
      ex."exitSignatures",
      ex."closeReason",
      wp.peak_price_usd::text as "peakPriceUsd"
    from app_private.positions p
    left join app_private.bot_profiles b on b.id = p.bot_id
    left join public.approved_groups g on g.id = b.source_group_id
    left join app_private.kol_strategies ks on ks.bot_id = b.id
    left join lateral (
      select
        case when sum(l.quantity_base_units) > 0
          then (sum(coalesce(te.average_price_usd, 0) * l.quantity_base_units)
            / sum(l.quantity_base_units))::text else null end as "averageEntryPriceUsd",
        coalesce(sum(l.quantity_base_units), 0)::text as "entryQuantityBaseUnits",
        coalesce(jsonb_agg(te.tx_signature order by l.created_at)
          filter (where te.tx_signature is not null), '[]'::jsonb) as "entrySignatures",
        coalesce(sum(te.platform_fee_lamports), 0) as entry_platform_fee,
        coalesce(sum(te.creator_fee_lamports), 0) as entry_creator_fee,
        coalesce(sum(te.referral_fee_lamports), 0) as entry_referral_fee,
        (array_agg(te.tx_signature order by l.created_at)
          filter (where te.tx_signature is not null))[1] as first_signature
      from app_private.position_lots l
      join app_private.trade_executions te on te.id = l.entry_execution_id
      where l.position_id = p.id
    ) en on true
    left join lateral (
      select
        case when sum(px.quantity_base_units) > 0
          then (sum(coalesce(te.average_price_usd, 0) * px.quantity_base_units)
            / sum(px.quantity_base_units))::text else null end as "averageExitPriceUsd",
        coalesce(sum(px.quantity_base_units), 0)::text as "exitedQuantityBaseUnits",
        case when count(*) filter (where px.proceeds_lamports is null) > 0 then null
          else coalesce(sum(px.proceeds_lamports), 0)::text end as "proceedsLamports",
        coalesce(sum(px.cost_basis_lamports), 0)::text as "releasedBasisLamports",
        coalesce(sum(te.platform_fee_lamports), 0) as exit_platform_fee,
        coalesce(sum(te.creator_fee_lamports), 0) as exit_creator_fee,
        coalesce(sum(te.referral_fee_lamports), 0) as exit_referral_fee,
        coalesce(jsonb_agg(te.tx_signature order by px.created_at)
          filter (where te.tx_signature is not null), '[]'::jsonb) as "exitSignatures",
        (array_agg(ti.intent_kind order by px.created_at desc))[1] as "closeReason"
      from app_private.position_exits px
      join app_private.trade_executions te on te.id = px.exit_execution_id
      join app_private.trade_intents ti on ti.id = te.intent_id
      where px.position_id = p.id
    ) ex on true
    left join public.positions wp on wp.entry_sig = en.first_signature
    where p.owner_privy_user_id = p_privy_user_id
    order by p.opened_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) x;

  return jsonb_build_object('ok', true, 'asOf', now(), 'positions', v_rows);
end;
$$;

revoke all on function public.app_user_trade_history(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.app_user_trade_history(text, text, integer)
  to service_role;
