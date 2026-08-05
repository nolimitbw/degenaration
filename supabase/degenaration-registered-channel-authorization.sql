-- Only a registered, approved, ACTIVE guild/channel pair may produce a call.
--
-- THE DEFECT: THE TWO GATES DISAGREE
--
-- Two functions decide whether a Discord channel is a call source, and they do not check the
-- same thing.
--
--   bot_approved_call_channels  — the map the listener refreshes on a timer:
--       ch.status = 'approved' AND ch.removed_at is null
--       AND g.active AND g.verification_status = 'approved' AND g.removed_at is null
--
--   bot_ingest_discord_signal_v2 — the gate the journal actually passes through:
--       ch.status = 'approved' AND ch.removed_at is null
--       LEFT JOIN approved_groups, for the NAME only
--
-- So the authoritative gate never looks at the source's approval state at all. That matters
-- because the listener's map is a cache: between an administrator removing a source and the
-- next refresh, the listener keeps forwarding, and the gate accepts every one of those events.
-- FINAL_LAUNCH_SPEC requires removal to prevent new calls IMMEDIATELY; it did not.
--
-- It is also reachable with no cache involved. `admin_decide_call_channel` approves a channel
-- and, when the guild already has an approved_groups row, does
--
--     update public.approved_groups set active = true, ...
--
-- without clearing `verification_status`, `removed_at`, `suspended_at` or `removal_reason`.
-- Approving one new channel registration from a previously REMOVED server therefore resumed
-- ingestion from it while every marketplace surface — which reads verification_status — kept
-- it hidden. A source removed for cause could go on producing calls invisibly.
--
-- THE GUILD WAS NEVER CHECKED EITHER
--
-- The listener sent only a channel id, so the journal took the guild from the stored row and
-- wrote `source_ref = 'discord:' || v_guild_id || ':' || p_channel_id`. Everything downstream
-- keys on that: fan-out, the marketplace projection, the source's own record. If the stored
-- guild is wrong, calls are attributed to the wrong source and nothing can detect it, because
-- the only two things being compared came from the same row. The guild is now supplied by the
-- listener and checked against the registration.
--
-- WHY THE REFUSAL IS RECORDED
--
-- Every refusal was previously a `return` with a JSON error. The listener counts them in
-- memory, so they die with the process, and the specification requires an ignored channel to
-- be "audited with a truthful reason". `app_private.discord_ingestion_refusals` is that record.
-- It is bounded by rarity, not by policy: the listener refuses an unapproved channel locally
-- and never calls this function, so a row here means the map and the database disagreed —
-- which is exactly the event worth keeping.
--
-- ARITY CHANGE, HANDLED EXPLICITLY
--
-- `bot_ingest_discord_signal_v2` gains `p_guild_id` and goes from 17 arguments to 18. A
-- `create or replace` at a new arity creates an OVERLOAD rather than replacing, after which a
-- 17-argument call fails with "function is not unique" — the defect
-- degenaration-exit-plan-state.sql already had to be corrected for. The 17-argument signature
-- is therefore DROPPED first, and the new argument carries a DEFAULT so that a bot build which
-- predates this migration keeps ingesting through the deployment window. A null guild skips the
-- pair check and is recorded as such rather than silently treated as a match.
--
-- Forward safety: one new table, `bot_ingest_discord_signal_v2` dropped at its old arity and
-- recreated one argument wider, `admin_decide_call_channel` replaced at an unchanged arity of
-- 3 and its search_path pinned to the empty string. No existing row is rewritten, no constraint
-- narrowed, and no grant widened.
-- Rollback: supabase/rollback/12-registered-channel-authorization.sql.

-- ---------------------------------------------------------------------------------------
-- 1. The refusal record
-- ---------------------------------------------------------------------------------------

create table if not exists app_private.discord_ingestion_refusals (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  guild_id text,
  message_id text,
  event_type text,
  -- The stored registration's guild, when there was one. Together with guild_id this is what
  -- makes a mismatch legible after the fact rather than only at the moment it happened.
  registered_guild_id text,
  reason text not null,
  refused_at timestamptz not null default now()
);

alter table app_private.discord_ingestion_refusals enable row level security;
revoke all on table app_private.discord_ingestion_refusals from public, anon, authenticated;

create index if not exists discord_ingestion_refusals_recent_idx
  on app_private.discord_ingestion_refusals (refused_at desc);
create index if not exists discord_ingestion_refusals_channel_idx
  on app_private.discord_ingestion_refusals (channel_id, refused_at desc);

-- ---------------------------------------------------------------------------------------
-- 2. One authorization predicate, used by the gate
-- ---------------------------------------------------------------------------------------

-- Returns the source a channel belongs to, and NULL when the pair is not an active registered
-- call channel. The predicate is written once here so the gate and the listener's map cannot
-- drift apart again — bot_approved_call_channels is rebuilt below on top of it.
--
-- p_guild_id null means "the caller did not tell us", which is a bot build older than this
-- migration. It resolves the channel without the pair check; the caller records that it did.
create or replace function app_private.authorized_call_channel(
  p_channel_id text,
  p_guild_id text default null
)
returns table (
  group_id uuid,
  group_name text,
  guild_id text,
  channel_name text,
  refusal text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel public.call_channels%rowtype;
  v_group public.approved_groups%rowtype;
begin
  select * into v_channel
  from public.call_channels ch
  where ch.channel_id = p_channel_id
  limit 1;

  if not found then
    return query select null::uuid, null::text, null::text, null::text, 'channel not registered'::text;
    return;
  end if;

  -- The pair. A registered channel whose guild is not the one the message came from means the
  -- registration is stale or the caller is wrong, and either way attributing the call to that
  -- source would be a fabrication.
  if p_guild_id is not null
     and nullif(trim(v_channel.guild_id), '') is not null
     and v_channel.guild_id <> p_guild_id then
    return query select null::uuid, null::text, v_channel.guild_id, v_channel.channel_name,
      'channel registered to a different guild'::text;
    return;
  end if;

  if v_channel.status <> 'approved' or v_channel.removed_at is not null then
    return query select null::uuid, null::text, v_channel.guild_id, v_channel.channel_name,
      ('channel ' || coalesce(nullif(v_channel.status, ''), 'unknown'))::text;
    return;
  end if;

  if v_channel.group_id is null then
    return query select null::uuid, null::text, v_channel.guild_id, v_channel.channel_name,
      'channel has no linked source'::text;
    return;
  end if;

  select * into v_group from public.approved_groups g where g.id = v_channel.group_id;
  if not found then
    return query select null::uuid, null::text, v_channel.guild_id, v_channel.channel_name,
      'linked source missing'::text;
    return;
  end if;

  if v_group.removed_at is not null or v_group.verification_status = 'removed' then
    return query select null::uuid, v_group.name, v_channel.guild_id, v_channel.channel_name,
      'source removed'::text;
    return;
  end if;
  -- The two are reported separately on purpose. A source that is `active = false` while its
  -- verification_status still reads 'approved' would otherwise be refused as "source approved",
  -- which tells an operator nothing and looks like a bug in the gate rather than a state on the
  -- source.
  if v_group.verification_status <> 'approved' then
    return query select null::uuid, v_group.name, v_channel.guild_id, v_channel.channel_name,
      ('source ' || v_group.verification_status)::text;
    return;
  end if;
  if not v_group.active then
    return query select null::uuid, v_group.name, v_channel.guild_id, v_channel.channel_name,
      'source inactive'::text;
    return;
  end if;

  return query select v_group.id, coalesce(v_group.name, v_channel.guild_name),
    v_channel.guild_id, v_channel.channel_name, null::text;
end;
$$;

revoke execute on function app_private.authorized_call_channel(text, text) from public, anon, authenticated;
grant execute on function app_private.authorized_call_channel(text, text) to service_role;

-- ---------------------------------------------------------------------------------------
-- 3. The listener's map, rebuilt on the same predicate
-- ---------------------------------------------------------------------------------------

-- Same arity (1), same response shape. The difference is that it now derives from
-- authorized_call_channel, so the map the listener holds and the gate the journal enforces
-- cannot disagree about what "approved" means.
create or replace function public.bot_approved_call_channels(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channels jsonb;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'channel_id', ch.channel_id,
    'group_id', a.group_id,
    'guild_id', ch.guild_id,
    'guild_name', a.group_name
  ) order by ch.created_at desc), '[]'::jsonb)
  into v_channels
  from public.call_channels ch
  cross join lateral app_private.authorized_call_channel(ch.channel_id, ch.guild_id) a
  where a.refusal is null;

  return v_channels;
end;
$$;

revoke execute on function public.bot_approved_call_channels(text) from public, anon, authenticated;
grant execute on function public.bot_approved_call_channels(text) to service_role;

-- ---------------------------------------------------------------------------------------
-- 4. The gate
-- ---------------------------------------------------------------------------------------

-- Dropped at the old arity BEFORE recreating one argument wider. Without this drop both
-- signatures would be installed and every 17-argument call would raise "function is not
-- unique", which is a worse failure than the one being fixed because it breaks a working path.
drop function if exists public.bot_ingest_discord_signal_v2(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text,
  text, text, timestamptz, text, integer, text
);

create or replace function public.bot_ingest_discord_signal_v2(
  p_secret text,
  p_channel_id text,
  p_channel_name text,
  p_mint text,
  p_symbol text,
  p_called_mcap numeric,
  p_called_price_usd numeric,
  p_called_liquidity_usd numeric,
  p_message_id text,
  p_caller text,
  p_confidence text,
  p_event_type text,
  p_event_version text,
  p_edited_at timestamptz,
  p_parser_version text,
  p_confidence_bps integer,
  p_content_hash text,
  p_guild_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth record;
  v_group_id uuid;
  v_group_name text;
  v_guild_id text;
  v_source_ref text;
  v_external_event_id text;
  v_raw_id uuid;
  v_parsed_id uuid;
  v_call_id uuid;
  v_existing_call_id uuid;
  v_previous_mint text;
  v_parse_status text := 'accepted';
  v_rejection_reason text;
  v_legacy_message_id text;
  v_retracted integer := 0;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_channel_id is null or p_channel_id !~ '^\d{17,20}$'
    or p_message_id is null or p_message_id !~ '^\d{17,20}$' then
    raise exception 'invalid Discord event identifiers' using errcode = '22023';
  end if;
  -- Validated to the same shape as the channel: a caller that sends a malformed guild is not
  -- given the benefit of the doubt by having it read as "not supplied".
  if p_guild_id is not null and p_guild_id !~ '^\d{17,20}$' then
    raise exception 'invalid Discord event identifiers' using errcode = '22023';
  end if;
  if p_event_type not in ('create', 'edit', 'delete')
    or nullif(trim(coalesce(p_event_version, '')), '') is null then
    raise exception 'invalid event version' using errcode = '22023';
  end if;
  if p_event_type <> 'delete'
    and (p_mint is null or p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') then
    raise exception 'invalid mint' using errcode = '22023';
  end if;
  if p_confidence_bps is null or p_confidence_bps not between 0 and 10000
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid parser evidence' using errcode = '22023';
  end if;

  select * into v_auth
  from app_private.authorized_call_channel(p_channel_id, p_guild_id);

  if v_auth.refusal is not null then
    -- Recorded before returning. A refusal that leaves no trace is indistinguishable from a
    -- quiet channel, which is what made the last three ingestion faults take days to find.
    insert into app_private.discord_ingestion_refusals (
      channel_id, guild_id, message_id, event_type, registered_guild_id, reason
    ) values (
      p_channel_id, p_guild_id, p_message_id, p_event_type, v_auth.guild_id, v_auth.refusal
    );
    return jsonb_build_object(
      'ok', false, 'error', 'channel not approved', 'reason', v_auth.refusal, 'status', 403
    );
  end if;

  v_group_id := v_auth.group_id;
  v_group_name := v_auth.group_name;
  -- The registration's guild, not the caller's. They are equal by the check above whenever the
  -- caller supplied one, and the registration is the record of record when it did not.
  v_guild_id := v_auth.guild_id;

  v_source_ref := 'discord:' || v_guild_id || ':' || p_channel_id;
  v_external_event_id := p_message_id || ':' || left(trim(p_event_version), 64);

  insert into app_private.raw_signals (
    source_type,
    source_ref,
    external_event_id,
    event_version,
    immutable_payload,
    content_hash,
    edited_at,
    deleted_at
  ) values (
    'discord',
    v_source_ref,
    v_external_event_id,
    left(trim(p_event_version), 64),
    jsonb_build_object(
      'guildId', v_guild_id,
      -- What the caller claimed, kept beside what the registration says. When they agree this
      -- is redundant; when they cannot be compared later, it is the only evidence of which.
      'reportedGuildId', p_guild_id,
      'channelId', p_channel_id,
      'channelName', nullif(left(trim(coalesce(p_channel_name, '')), 120), ''),
      'messageId', p_message_id,
      'eventType', p_event_type,
      'caller', nullif(left(trim(coalesce(p_caller, '')), 120), ''),
      'confidence', nullif(left(trim(coalesce(p_confidence, '')), 32), ''),
      'mint', nullif(left(trim(coalesce(p_mint, '')), 64), '')
    ),
    p_content_hash,
    case when p_event_type = 'edit' then coalesce(p_edited_at, now()) end,
    case when p_event_type = 'delete' then coalesce(p_edited_at, now()) end
  )
  on conflict (source_type, source_ref, external_event_id) do nothing
  returning id into v_raw_id;

  if v_raw_id is null then
    select id into v_raw_id
    from app_private.raw_signals
    where source_type = 'discord'
      and source_ref = v_source_ref
      and external_event_id = v_external_event_id;

    select ps.id into v_parsed_id
    from app_private.parsed_signals ps
    where ps.raw_signal_id = v_raw_id
      and ps.parser_version = left(trim(p_parser_version), 64);

    select c.id into v_existing_call_id
    from public.calls c
    where c.raw_event_id = v_raw_id
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'rawSignalId', v_raw_id,
      'parsedSignalId', v_parsed_id,
      'id', v_existing_call_id
    );
  end if;

  if p_event_type = 'delete' then
    v_parse_status := 'rejected';
    v_rejection_reason := 'source message deleted';
    update public.calls
    set deleted_at = coalesce(p_edited_at, now()),
        parse_status = 'rejected',
        rejection_reason = v_rejection_reason
    where channel_id = p_channel_id
      and (message_id = p_message_id or message_id like p_message_id || ':e:%')
      and deleted_at is null;
    get diagnostics v_retracted = row_count;
  elsif p_event_type = 'edit' then
    select c.mint into v_previous_mint
    from public.calls c
    where c.channel_id = p_channel_id
      and (c.message_id = p_message_id or c.message_id like p_message_id || ':e:%')
      and c.deleted_at is null
    order by c.called_at desc
    limit 1;

    if v_previous_mint = p_mint then
      v_parse_status := 'duplicate';
      v_rejection_reason := 'message edit did not change the mint';
    end if;
    -- The supersede is NOT performed here. The cooldown below can still refuse this edit, and
    -- retracting the previous call for an edit that is never recorded loses a measured call
    -- with nothing to replace it. It runs once the status is final.
  end if;

  if v_parse_status = 'accepted' and exists (
    select 1
    from app_private.parsed_signals ps
    join app_private.raw_signals rs on rs.id = ps.raw_signal_id
    where ps.status = 'accepted'
      and ps.mint = p_mint
      and rs.source_ref = v_source_ref
      and rs.id <> v_raw_id
      and rs.received_at >= now() - interval '60 seconds'
  ) then
    v_parse_status := 'duplicate';
    v_rejection_reason := 'same token repeated inside the source cooldown';
  end if;

  if p_event_type = 'edit' and v_parse_status = 'accepted' then
    update public.calls
    set deleted_at = coalesce(p_edited_at, now()),
        parse_status = 'rejected',
        rejection_reason = 'superseded by message edit'
    where channel_id = p_channel_id
      and (message_id = p_message_id or message_id like p_message_id || ':e:%')
      and deleted_at is null;
    get diagnostics v_retracted = row_count;
  end if;

  insert into app_private.parsed_signals (
    raw_signal_id,
    parser_version,
    status,
    mint,
    confidence_bps,
    rejection_reason,
    normalized_payload
  ) values (
    v_raw_id,
    left(trim(p_parser_version), 64),
    v_parse_status,
    case when p_event_type = 'delete' then null else left(trim(p_mint), 64) end,
    p_confidence_bps,
    v_rejection_reason,
    jsonb_build_object(
      'symbol', nullif(left(trim(coalesce(p_symbol, '')), 32), ''),
      'calledMcapUsd', p_called_mcap,
      'calledPriceUsd', p_called_price_usd,
      'calledLiquidityUsd', p_called_liquidity_usd,
      'eventType', p_event_type
    )
  )
  on conflict (raw_signal_id, parser_version) do update
  set status = excluded.status
  returning id into v_parsed_id;

  if v_parse_status <> 'accepted' then
    return jsonb_build_object(
      'ok', true,
      'accepted', false,
      'status', v_parse_status,
      'reason', v_rejection_reason,
      'retractedCalls', v_retracted,
      'rawSignalId', v_raw_id,
      'parsedSignalId', v_parsed_id
    );
  end if;

  v_legacy_message_id := case
    when p_event_type = 'edit'
      then left(p_message_id || ':e:' || left(trim(p_event_version), 32), 64)
    else p_message_id
  end;

  insert into public.calls (
    group_id, group_name, mint, symbol, called_mcap, called_price_usd, peak_price_usd,
    latest_price_usd, peak_mcap, latest_mcap, called_liquidity_usd, latest_liquidity_usd,
    channel_id, channel_name, caller, confidence, message_id, parser_version,
    parser_confidence, parse_status, raw_event_id, parsed_signal_id, edited_at
  ) values (
    v_group_id,
    v_group_name,
    left(trim(p_mint), 64),
    nullif(left(trim(coalesce(p_symbol, '')), 32), ''),
    p_called_mcap,
    p_called_price_usd,
    p_called_price_usd,
    p_called_price_usd,
    p_called_mcap,
    p_called_mcap,
    p_called_liquidity_usd,
    p_called_liquidity_usd,
    p_channel_id,
    nullif(left(trim(coalesce(p_channel_name, '')), 120), ''),
    nullif(left(trim(coalesce(p_caller, '')), 120), ''),
    nullif(left(trim(coalesce(p_confidence, '')), 32), ''),
    v_legacy_message_id,
    left(trim(p_parser_version), 64),
    p_confidence_bps::numeric / 10000,
    'accepted',
    v_raw_id,
    v_parsed_id,
    case when p_event_type = 'edit' then coalesce(p_edited_at, now()) end
  )
  on conflict (message_id) where message_id is not null do nothing
  returning id into v_call_id;

  if v_call_id is null then
    select id into v_call_id
    from public.calls
    where message_id = v_legacy_message_id
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'accepted', true,
    'retractedCalls', v_retracted,
    'id', v_call_id,
    'rawSignalId', v_raw_id,
    'parsedSignalId', v_parsed_id,
    'group', v_group_name,
    'mint', p_mint,
    'symbol', p_symbol,
    'entryPriceUsd', p_called_price_usd
  );
end;
$$;

revoke execute on function public.bot_ingest_discord_signal_v2(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text,
  text, text, timestamptz, text, integer, text, text
) from public, anon, authenticated;

grant execute on function public.bot_ingest_discord_signal_v2(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text,
  text, text, timestamptz, text, integer, text, text
) to service_role;

-- ---------------------------------------------------------------------------------------
-- 5. Approving a channel cannot silently reinstate a removed source
-- ---------------------------------------------------------------------------------------

-- Same arity (3). Two changes:
--
--   1. Approving a channel whose guild already has a SUSPENDED or REMOVED source is refused,
--      with an error naming the audited flow. Previously it set `active = true` and left
--      verification_status, removed_at, suspended_at and removal_reason exactly as they were,
--      so one channel approval resumed ingestion from a source removed for cause while every
--      marketplace surface — which reads verification_status — kept it hidden. Reinstatement
--      belongs to admin_decide_source, which takes an actor and a reason and writes an audit
--      entry; this function has neither.
--
--   2. search_path is pinned to the empty string and every name qualified. It was one of four
--      admin functions pinned to `public, pg_temp` (PENDING_DEPLOYMENT records the correction
--      to that claim); check:admin-authorization holds the remaining three as a list that may
--      shrink and never grow.
create or replace function public.admin_decide_call_channel(p_secret text, p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel public.call_channels%rowtype;
  v_group public.approved_groups%rowtype;
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
    select ch.group_id into v_group_id
    from public.call_channels ch
    where ch.guild_id = v_channel.guild_id and ch.group_id is not null
    limit 1;
  end if;

  if v_group_id is null then
    select g.id into v_group_id
    from public.approved_groups g
    where g.discord_guild_id = v_channel.guild_id
    limit 1;
  end if;

  if v_group_id is not null then
    select * into v_group from public.approved_groups g where g.id = v_group_id;
    if found and (
      v_group.removed_at is not null
      or v_group.suspended_at is not null
      or v_group.verification_status <> 'approved'
    ) then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'error', 'source is ' || coalesce(nullif(v_group.verification_status, ''), 'inactive')
          || ' — reinstate it first, with a reason, before approving a channel on it'
      );
    end if;
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
    update public.approved_groups g
    set
      active = true,
      public_slug = coalesce(g.public_slug, v_public_slug),
      referral_code = coalesce(g.referral_code, v_referral_code)
    where g.id = v_group_id;
  end if;

  update public.call_channels
  set status = 'approved', group_id = v_group_id, approved_at = now(), removed_at = null
  where id = p_id;

  select g.public_slug, g.referral_code into v_public_slug, v_referral_code
  from public.approved_groups g where g.id = v_group_id;

  return jsonb_build_object(
    'ok', true,
    'group_id', v_group_id,
    'public_slug', v_public_slug,
    'referral_code', v_referral_code
  );
end;
$$;

revoke execute on function public.admin_decide_call_channel(text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_decide_call_channel(text, uuid, text) to service_role;
