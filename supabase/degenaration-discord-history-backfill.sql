-- Migration 30: durable, idempotent Discord history backfill.
-- Historical messages are journaled and measured, but never fanned out for trading and never
-- assigned a present-day price as though it were the call-time baseline.

create table if not exists app_private.discord_history_backfills (
  channel_id text primary key check (channel_id ~ '^\d{17,20}$'),
  newest_message_id text check (newest_message_id is null or newest_message_id ~ '^\d{17,20}$'),
  oldest_message_id text check (oldest_message_id is null or oldest_message_id ~ '^\d{17,20}$'),
  completed_at timestamptz,
  last_run_at timestamptz not null default now(),
  messages_scanned bigint not null default 0 check (messages_scanned >= 0),
  last_error text,
  updated_at timestamptz not null default now()
);

revoke all on table app_private.discord_history_backfills from public, anon, authenticated;

create or replace function public.bot_discord_backfill_state(p_secret text, p_channel_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_state jsonb;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_channel_id is null or p_channel_id !~ '^\d{17,20}$' then
    raise exception 'invalid Discord channel' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.call_channels c
    cross join lateral app_private.authorized_call_channel(c.channel_id, c.guild_id) a
    where c.channel_id = p_channel_id and a.refusal is null
  ) then
    raise exception 'channel not approved' using errcode = '42501';
  end if;
  select to_jsonb(s) into v_state
  from app_private.discord_history_backfills s where s.channel_id = p_channel_id;
  return coalesce(v_state, jsonb_build_object(
    'channel_id', p_channel_id, 'newest_message_id', null, 'oldest_message_id', null,
    'completed_at', null, 'messages_scanned', 0
  ));
end;
$$;

create or replace function public.bot_update_discord_backfill_state(
  p_secret text,
  p_channel_id text,
  p_newest_message_id text,
  p_oldest_message_id text,
  p_completed boolean,
  p_messages_scanned bigint,
  p_last_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_state jsonb;
begin
  perform public.bot_discord_backfill_state(p_secret, p_channel_id);
  if (p_newest_message_id is not null and p_newest_message_id !~ '^\d{17,20}$')
    or (p_oldest_message_id is not null and p_oldest_message_id !~ '^\d{17,20}$')
    or coalesce(p_messages_scanned, 0) < 0 then
    raise exception 'invalid Discord backfill state' using errcode = '22023';
  end if;
  insert into app_private.discord_history_backfills (
    channel_id, newest_message_id, oldest_message_id, completed_at,
    last_run_at, messages_scanned, last_error, updated_at
  ) values (
    p_channel_id, p_newest_message_id, p_oldest_message_id,
    case when p_completed then now() end,
    now(), coalesce(p_messages_scanned, 0), nullif(left(coalesce(p_last_error, ''), 500), ''), now()
  )
  on conflict (channel_id) do update set
    newest_message_id = coalesce(excluded.newest_message_id, app_private.discord_history_backfills.newest_message_id),
    oldest_message_id = coalesce(excluded.oldest_message_id, app_private.discord_history_backfills.oldest_message_id),
    completed_at = case when p_completed then coalesce(app_private.discord_history_backfills.completed_at, now())
      else app_private.discord_history_backfills.completed_at end,
    last_run_at = now(),
    messages_scanned = greatest(app_private.discord_history_backfills.messages_scanned, excluded.messages_scanned),
    last_error = excluded.last_error,
    updated_at = now()
  returning to_jsonb(discord_history_backfills) into v_state;
  return v_state;
end;
$$;

revoke execute on function public.bot_discord_backfill_state(text, text) from public, anon, authenticated;
revoke execute on function public.bot_update_discord_backfill_state(text, text, text, text, boolean, bigint, text) from public, anon, authenticated;
grant execute on function public.bot_discord_backfill_state(text, text) to service_role;
grant execute on function public.bot_update_discord_backfill_state(text, text, text, text, boolean, bigint, text) to service_role;

-- The live cooldown compares ingestion time. A historical walk can ingest hundreds of old
-- messages in one minute, so that comparison must not collapse distinct old calls. Patch only
-- this exact predicate and fail closed if the audited function body no longer matches it.
do $$
declare
  v_oid regprocedure := 'public.bot_ingest_discord_signal_v2(text,text,text,text,text,numeric,numeric,numeric,text,text,text,text,text,timestamptz,text,integer,text,text)'::regprocedure;
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(v_oid) into v_definition;
  if position('if v_parse_status = ''accepted'' and p_event_version not like ''history:%'' and exists (' in v_definition) > 0 then
    return;
  end if;
  v_patched := replace(
    v_definition,
    'if v_parse_status = ''accepted'' and exists (',
    'if v_parse_status = ''accepted'' and p_event_version not like ''history:%'' and exists ('
  );
  if v_patched = v_definition then
    raise exception 'history backfill cooldown patch target not found';
  end if;
  execute v_patched;
end;
$$;

create or replace function app_private.preserve_discord_history_call_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_version text;
declare v_called_at timestamptz;
begin
  select r.event_version into v_version
  from app_private.raw_signals r where r.id = new.raw_event_id;
  if v_version like 'history:%' then
    begin
      v_called_at := substring(v_version from 9)::timestamptz;
    exception when others then
      raise exception 'invalid historical Discord event timestamp' using errcode = '22023';
    end;
    new.called_at := v_called_at;
    new.called_mcap := null;
    new.called_price_usd := null;
    new.peak_price_usd := null;
    new.latest_price_usd := null;
    new.peak_mcap := null;
    new.latest_mcap := null;
    new.called_liquidity_usd := null;
    new.latest_liquidity_usd := null;
  end if;
  return new;
end;
$$;

drop trigger if exists calls_preserve_discord_history_time on public.calls;
create trigger calls_preserve_discord_history_time
before insert on public.calls
for each row execute function app_private.preserve_discord_history_call_time();

-- Backfilled calls build the public performance record only. They cannot create deliveries,
-- trade intents, acknowledgments, or swaps for messages posted before activation.
create or replace function app_private.fan_out_on_parse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and not exists (
    select 1 from app_private.raw_signals r
    where r.id = new.raw_signal_id and r.event_version like 'history:%'
  ) then
    perform app_private.fan_out_parsed_signal(new.id);
  end if;
  return new;
end;
$$;

revoke execute on function app_private.preserve_discord_history_call_time() from public, anon, authenticated;
revoke execute on function app_private.fan_out_on_parse() from public, anon, authenticated;
