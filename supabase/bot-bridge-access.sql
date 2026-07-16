-- Narrow PostgREST access for the Discord bridge. Each function validates
-- BOT_SHARED_SECRET before touching RLS-protected tables.

create or replace function public.bot_guild_status(
  p_secret text,
  p_guild_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channels jsonb;
  v_group_id uuid;
  v_profile jsonb;
  v_top_callers jsonb;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_guild_id is null or p_guild_id !~ '^\d{17,20}$' then
    raise exception 'invalid guild' using errcode = '22023';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'channel_id', ch.channel_id,
      'channel_name', ch.channel_name,
      'status', ch.status,
      'group_id', ch.group_id,
      'created_at', ch.created_at,
      'approved_at', ch.approved_at
    ) order by ch.created_at desc), '[]'::jsonb),
    (array_agg(ch.group_id order by (ch.group_id is null), ch.created_at desc))[1]
  into v_channels, v_group_id
  from public.call_channels ch
  where ch.guild_id = p_guild_id;

  if v_group_id is not null then
    select jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'public_slug', g.public_slug,
      'referral_code', g.referral_code
    )
    into v_profile
    from public.approved_groups g
    where g.id = v_group_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'name', ranked.caller,
      'calls', ranked.call_count
    ) order by ranked.call_count desc, ranked.caller asc), '[]'::jsonb)
    into v_top_callers
    from (
      select left(trim(c.caller), 100) as caller, count(*)::integer as call_count
      from public.calls c
      where c.group_id = v_group_id
        and nullif(trim(c.caller), '') is not null
      group by left(trim(c.caller), 100)
      order by count(*) desc, left(trim(c.caller), 100) asc
      limit 10
    ) ranked;
  end if;

  return jsonb_build_object(
    'channels', coalesce(v_channels, '[]'::jsonb),
    'profile', v_profile,
    'topCallers', coalesce(v_top_callers, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.bot_register_call_channel(text, text, text, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.bot_approved_call_channels(text) from public, anon, authenticated;
revoke execute on function public.bot_ingest_discord_call(text, text, text, text, text, numeric, numeric, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function public.bot_guild_status(text, text) from public, anon, authenticated;

grant execute on function public.bot_register_call_channel(text, text, text, integer, text, text, text) to service_role;
grant execute on function public.bot_approved_call_channels(text) to service_role;
grant execute on function public.bot_ingest_discord_call(text, text, text, text, text, numeric, numeric, numeric, text, text, text) to service_role;
grant execute on function public.bot_guild_status(text, text) to service_role;
