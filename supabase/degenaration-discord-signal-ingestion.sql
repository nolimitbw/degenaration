-- Immutable Discord signal ingestion with parser evidence and edit/delete history.

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
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_channel_id is null or p_channel_id !~ '^\d{17,20}$'
    or p_message_id is null or p_message_id !~ '^\d{17,20}$' then
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

  select ch.group_id, coalesce(g.name, ch.guild_name), ch.guild_id
  into v_group_id, v_group_name, v_guild_id
  from public.call_channels ch
  left join public.approved_groups g on g.id = ch.group_id
  where ch.channel_id = p_channel_id
    and ch.status = 'approved'
    and ch.removed_at is null
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'channel not approved', 'status', 403);
  end if;

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
    else
      update public.calls
      set deleted_at = coalesce(p_edited_at, now()),
          parse_status = 'rejected',
          rejection_reason = 'superseded by message edit'
      where channel_id = p_channel_id
        and (message_id = p_message_id or message_id like p_message_id || ':e:%')
        and deleted_at is null;
    end if;
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
    group_id,
    group_name,
    mint,
    symbol,
    called_mcap,
    called_price_usd,
    peak_price_usd,
    latest_price_usd,
    peak_mcap,
    latest_mcap,
    called_liquidity_usd,
    latest_liquidity_usd,
    channel_id,
    channel_name,
    caller,
    confidence,
    message_id,
    parser_version,
    parser_confidence,
    parse_status,
    raw_event_id,
    parsed_signal_id,
    edited_at
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
  text, text, timestamptz, text, integer, text
) from public, anon, authenticated;

grant execute on function public.bot_ingest_discord_signal_v2(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text,
  text, text, timestamptz, text, integer, text
) to service_role;
