-- Public identities for approved Discord call sources.
-- Approval assigns a stable profile slug and referral code; unapproved rows stay private.

alter table public.approved_groups
  add column if not exists public_slug text,
  add column if not exists referral_code text,
  add column if not exists bio text,
  add column if not exists avatar_url text,
  add column if not exists discord_invite_url text,
  add column if not exists server_application_id uuid references public.server_applications(id) on delete set null;

update public.approved_groups
set
  public_slug = coalesce(
    public_slug,
    trim(both '-' from left(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), 48))
      || '-' || substr(md5(id::text), 1, 8)
  ),
  referral_code = coalesce(referral_code, 'dg' || substr(md5(id::text || ':ref'), 1, 10));

create unique index if not exists approved_groups_public_slug_key
  on public.approved_groups (public_slug) where public_slug is not null;
create unique index if not exists approved_groups_referral_code_key
  on public.approved_groups (referral_code) where referral_code is not null;
create unique index if not exists approved_groups_application_key
  on public.approved_groups (server_application_id) where server_application_id is not null;

revoke all on table public.approved_groups from anon, authenticated;
grant select (
  id, name, discord_channel_id, members, win_rate, pnl_30d, tag, active, created_at,
  public_slug, referral_code, bio, avatar_url, discord_invite_url
) on table public.approved_groups to anon, authenticated;

create or replace function public.admin_decide_call_channel(p_secret text, p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel public.call_channels%rowtype;
  v_group_id uuid;
  v_name text;
  v_slug_base text;
  v_public_slug text;
  v_referral_code text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'bad action', 'status', 400);
  end if;

  if p_action = 'reject' then
    update public.call_channels set status = 'rejected' where id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not found', 'status', 404);
    end if;
    return jsonb_build_object('ok', true);
  end if;

  select * into v_channel from public.call_channels where id = p_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not found', 'status', 404);
  end if;

  v_group_id := v_channel.group_id;
  v_name := coalesce(nullif(v_channel.guild_name, ''), 'Discord server');
  v_slug_base := trim(both '-' from left(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), 48));
  if v_slug_base = '' then v_slug_base := 'discord-server'; end if;
  v_public_slug := v_slug_base || '-' || substr(md5(v_channel.guild_id), 1, 8);
  v_referral_code := 'dg' || substr(md5(v_channel.guild_id || ':ref'), 1, 10);

  if v_group_id is null then
    select group_id into v_group_id
    from public.call_channels
    where guild_id = v_channel.guild_id and group_id is not null
    limit 1;
  end if;

  if v_group_id is null then
    select id into v_group_id
    from public.approved_groups
    where discord_guild_id = v_channel.guild_id
    limit 1;
  end if;

  if v_group_id is null then
    insert into public.approved_groups (
      name, tag, active, members, discord_guild_id, public_slug, referral_code
    ) values (
      v_name,
      'Discord',
      true,
      case when v_channel.guild_member_count is not null then v_channel.guild_member_count::text else null end,
      v_channel.guild_id,
      v_public_slug,
      v_referral_code
    )
    returning id into v_group_id;
  else
    update public.approved_groups
    set
      active = true,
      public_slug = coalesce(public_slug, v_public_slug),
      referral_code = coalesce(referral_code, v_referral_code)
    where id = v_group_id;
  end if;

  update public.call_channels
  set status = 'approved', group_id = v_group_id, approved_at = now()
  where id = p_id;

  select public_slug, referral_code into v_public_slug, v_referral_code
  from public.approved_groups where id = v_group_id;

  return jsonb_build_object(
    'ok', true,
    'group_id', v_group_id,
    'public_slug', v_public_slug,
    'referral_code', v_referral_code
  );
end;
$$;

create or replace function public.admin_decide_server_application(p_secret text, p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.server_applications%rowtype;
  v_group_id uuid;
  v_slug_base text;
  v_public_slug text;
  v_referral_code text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'bad action', 'status', 400);
  end if;

  select * into v_application from public.server_applications where id = p_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not found', 'status', 404);
  end if;

  if p_action = 'reject' then
    update public.server_applications set status = 'rejected' where id = p_id;
    return jsonb_build_object('ok', true);
  end if;

  v_slug_base := trim(both '-' from left(regexp_replace(lower(v_application.server_name), '[^a-z0-9]+', '-', 'g'), 48));
  if v_slug_base = '' then v_slug_base := 'discord-server'; end if;
  v_public_slug := v_slug_base || '-' || substr(md5(v_application.id::text), 1, 8);
  v_referral_code := 'dg' || substr(md5(v_application.id::text || ':ref'), 1, 10);

  insert into public.approved_groups (
    name, members, tag, active, public_slug, referral_code, discord_invite_url, server_application_id
  ) values (
    v_application.server_name,
    v_application.member_count,
    'Listed',
    true,
    v_public_slug,
    v_referral_code,
    v_application.invite_link,
    v_application.id
  )
  on conflict (server_application_id) where server_application_id is not null
  do update set
    name = excluded.name,
    members = excluded.members,
    active = true,
    discord_invite_url = excluded.discord_invite_url,
    public_slug = coalesce(public.approved_groups.public_slug, excluded.public_slug),
    referral_code = coalesce(public.approved_groups.referral_code, excluded.referral_code)
  returning id, public_slug, referral_code into v_group_id, v_public_slug, v_referral_code;

  update public.server_applications set status = 'approved' where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'group_id', v_group_id,
    'public_slug', v_public_slug,
    'referral_code', v_referral_code
  );
end;
$$;
