-- Durable parser rejections for approved Discord sources.
-- Rejected events are immutable journal evidence only: they never create calls or deliveries.
-- Rollback: supabase/rollback/24-discord-rejected-signals.sql.

create or replace function public.bot_record_discord_rejection(
  p_secret text,
  p_guild_id text,
  p_channel_id text,
  p_channel_name text,
  p_message_id text,
  p_caller text,
  p_event_type text,
  p_event_version text,
  p_rejection_reason text,
  p_parser_version text,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth record;
  v_source_ref text;
  v_external_event_id text;
  v_raw_id uuid;
  v_parsed_id uuid;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_channel_id is null or p_channel_id !~ '^\d{17,20}$'
    or p_message_id is null or p_message_id !~ '^\d{17,20}$'
    or (p_guild_id is not null and p_guild_id !~ '^\d{17,20}$') then
    raise exception 'invalid Discord event identifiers' using errcode = '22023';
  end if;
  if p_event_type not in ('create', 'edit')
    or nullif(trim(coalesce(p_event_version, '')), '') is null then
    raise exception 'invalid event version' using errcode = '22023';
  end if;
  if p_rejection_reason <> 'ambiguous_mint' then
    raise exception 'invalid rejection reason' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_parser_version, '')), '') is null
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid parser evidence' using errcode = '22023';
  end if;

  select * into v_auth
  from app_private.authorized_call_channel(p_channel_id, p_guild_id);

  if v_auth.refusal is not null then
    insert into app_private.discord_ingestion_refusals (
      channel_id, guild_id, message_id, event_type, registered_guild_id, reason
    ) values (
      p_channel_id, p_guild_id, p_message_id, p_event_type, v_auth.guild_id, v_auth.refusal
    );
    return jsonb_build_object(
      'ok', false, 'error', 'channel not approved', 'reason', v_auth.refusal, 'status', 403
    );
  end if;

  v_source_ref := 'discord:' || v_auth.guild_id || ':' || p_channel_id;
  v_external_event_id := p_message_id || ':' || left(trim(p_event_version), 64);

  insert into app_private.raw_signals (
    source_type, source_ref, external_event_id, event_version,
    immutable_payload, content_hash, edited_at
  ) values (
    'discord', v_source_ref, v_external_event_id, left(trim(p_event_version), 64),
    jsonb_build_object(
      'guildId', v_auth.guild_id,
      'reportedGuildId', p_guild_id,
      'channelId', p_channel_id,
      'channelName', nullif(left(trim(coalesce(p_channel_name, '')), 120), ''),
      'messageId', p_message_id,
      'eventType', p_event_type,
      'caller', nullif(left(trim(coalesce(p_caller, '')), 120), ''),
      'rejectionReason', p_rejection_reason
    ),
    p_content_hash,
    case when p_event_type = 'edit' then now() end
  )
  on conflict (source_type, source_ref, external_event_id) do nothing
  returning id into v_raw_id;

  if v_raw_id is null then
    select id into v_raw_id
    from app_private.raw_signals
    where source_type = 'discord'
      and source_ref = v_source_ref
      and external_event_id = v_external_event_id;

    select id into v_parsed_id
    from app_private.parsed_signals
    where raw_signal_id = v_raw_id
      and parser_version = left(trim(p_parser_version), 64);

    return jsonb_build_object(
      'ok', true, 'accepted', false, 'duplicate', true,
      'status', 'rejected', 'reason', p_rejection_reason,
      'rawSignalId', v_raw_id, 'parsedSignalId', v_parsed_id
    );
  end if;

  insert into app_private.parsed_signals (
    raw_signal_id, parser_version, status, mint, confidence_bps,
    rejection_reason, normalized_payload
  ) values (
    v_raw_id, left(trim(p_parser_version), 64), 'rejected', null, 0,
    p_rejection_reason,
    jsonb_build_object('eventType', p_event_type, 'candidateCount', null)
  )
  returning id into v_parsed_id;

  return jsonb_build_object(
    'ok', true, 'accepted', false, 'duplicate', false,
    'status', 'rejected', 'reason', p_rejection_reason,
    'rawSignalId', v_raw_id, 'parsedSignalId', v_parsed_id
  );
end;
$$;

revoke execute on function public.bot_record_discord_rejection(
  text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.bot_record_discord_rejection(
  text, text, text, text, text, text, text, text, text, text, text
) to service_role;
