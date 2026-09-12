-- Authoritative, read-only Discord RUN facts. The client must not infer approval or
-- budget state from a selected option. All amounts stay integer lamports until the
-- existing subscription boundary, whose legacy columns are denominated in SOL.
-- Rollback: supabase/rollback/27-bot-run-readiness.sql

create or replace function public.app_user_bot_run_facts(
  p_secret text,
  p_privy_user_id text,
  p_bot_id uuid,
  p_source_group_id uuid,
  p_channel_id text,
  p_buy_lamports numeric,
  p_daily_cap_lamports numeric
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_source_approved boolean := false;
  v_channel_registered boolean := false;
  v_duplicate boolean := false;
  v_spent_lamports numeric := 0;
  v_day date := (now() at time zone 'utc')::date;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_privy_user_id, '')), '') is null
     or p_source_group_id is null
     or p_buy_lamports is null or p_buy_lamports <= 0 or trunc(p_buy_lamports) <> p_buy_lamports
     or p_daily_cap_lamports is null or p_daily_cap_lamports <= 0
     or trunc(p_daily_cap_lamports) <> p_daily_cap_lamports then
    raise exception 'invalid readiness request' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.approved_groups g
    where g.id = p_source_group_id
      and g.active = true
      and g.verification_status = 'approved'
      and g.removed_at is null
      and g.suspended_at is null
  ) into v_source_approved;

  v_channel_registered := v_source_approved and (
    nullif(trim(coalesce(p_channel_id, '')), '') is null
    or exists (
      select 1 from public.call_channels ch
      where ch.group_id = p_source_group_id
        and ch.channel_id = p_channel_id
        and ch.status = 'approved'
        and ch.removed_at is null
    )
  );

  select exists (
    select 1 from app_private.bot_profiles b
    where b.owner_privy_user_id = p_privy_user_id
      and b.kind = 'discord'
      and b.source_group_id = p_source_group_id
      and b.status = 'active'
      and (p_bot_id is null or b.id <> p_bot_id)
  ) into v_duplicate;

  if p_bot_id is not null then
    select case
      when s.daily_spent_on = v_day then round(coalesce(s.daily_spent, 0) * 1000000000)
      else 0
    end
    into v_spent_lamports
    from public.subscriptions s
    where s.bot_profile_id = p_bot_id
      and s.privy_user_id = p_privy_user_id;
  end if;

  return jsonb_build_object(
    'sourceApproved', v_source_approved,
    'channelRegistered', v_channel_registered,
    'duplicateActiveBot', v_duplicate,
    'dailyBudgetAvailable', coalesce(v_spent_lamports, 0) + p_buy_lamports <= p_daily_cap_lamports,
    'dailySpentLamports', trunc(coalesce(v_spent_lamports, 0))::text,
    'dailyRemainingLamports', trunc(greatest(p_daily_cap_lamports - coalesce(v_spent_lamports, 0), 0))::text
  );
end;
$$;

revoke all on function public.app_user_bot_run_facts(text, text, uuid, uuid, text, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.app_user_bot_run_facts(text, text, uuid, uuid, text, numeric, numeric)
  to service_role;
