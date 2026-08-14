-- Migration 32: scan EVERY channel of an approved server, not just the one someone registered.
--
-- The scanner only ever polled rows in call_channels, and those only appear when a human runs
-- /register inside one specific channel. A server whose calls move to another channel — or
-- which posts across several — goes silent in the journal with no error anywhere, because
-- "nobody registered that channel" and "that channel is quiet" are the same observation from
-- our side. Observed live on 2026-08-14: #alpha-futures active 2 hours ago and invisible,
-- while the registered #sol-alpha had been quiet for 46 hours. The owner reasonably read that
-- as the scanner being broken.
--
-- THE APPROVAL BOUNDARY DOES NOT MOVE. The unit of trust is the GUILD: it is the guild an
-- admin approves, the guild an owner claims through /connect, and the guild that earns the
-- creator share. Channels inside an already-approved guild inherit that decision, which is
-- what an owner means when they add the bot to their server. This function cannot create a
-- source, cannot approve anything, and returns `guild has no approved source` for a guild
-- that was never approved — so it can only ever widen a server that already asked to be
-- listed.
--
-- Additive: one new function. No existing object is replaced.

create or replace function public.bot_autoregister_guild_channels(
  p_secret text,
  p_guild_id text,
  p_channels jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_guild_name text;
  v_added integer := 0;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- The gate. Only for a guild that ALREADY has an approved, non-removed source, joined
  -- through to an approved group that is itself not removed.
  select ch.group_id, ch.guild_name
    into v_group_id, v_guild_name
  from public.call_channels ch
  join public.approved_groups g on g.id = ch.group_id
  where ch.guild_id = p_guild_id
    and ch.status = 'approved'
    and ch.removed_at is null
    and g.removed_at is null
  limit 1;

  if v_group_id is null then
    return jsonb_build_object('ok', false, 'reason', 'guild has no approved source');
  end if;

  insert into public.call_channels
    (guild_id, guild_name, channel_id, channel_name, group_id, registered_by, status, approved_at)
  select
    p_guild_id,
    v_guild_name,
    c->>'id',
    left(coalesce(c->>'name', ''), 100),
    v_group_id,
    -- Recorded as its own registrant so a discovered channel is always distinguishable from
    -- one a human chose, in the admin console and in any later audit.
    'auto-discovered',
    'approved',
    now()
  from jsonb_array_elements(coalesce(p_channels, '[]'::jsonb)) c
  where c->>'id' is not null
    -- Snowflake shape, because this argument comes from an HTTP caller.
    and c->>'id' ~ '^[0-9]{17,20}$'
    -- Never touch a channel that already exists: a removed or suspended one must stay that
    -- way, and re-inserting would resurrect a source an admin deliberately took down.
    and not exists (
      select 1 from public.call_channels existing
      where existing.channel_id = c->>'id'
    );

  get diagnostics v_added = row_count;
  return jsonb_build_object('ok', true, 'added', v_added, 'groupId', v_group_id);
end;
$$;

revoke all on function public.bot_autoregister_guild_channels(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.bot_autoregister_guild_channels(text, text, jsonb) to service_role;
