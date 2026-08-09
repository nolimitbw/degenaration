drop trigger if exists calls_preserve_discord_history_time on public.calls;
drop function if exists app_private.preserve_discord_history_call_time();

do $$
declare
  v_oid regprocedure := 'public.bot_ingest_discord_signal_v2(text,text,text,text,text,numeric,numeric,numeric,text,text,text,text,text,timestamptz,text,integer,text,text)'::regprocedure;
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(v_oid) into v_definition;
  if position('if v_parse_status = ''accepted'' and exists (' in v_definition) > 0
    and position('if v_parse_status = ''accepted'' and p_event_version not like ''history:%'' and exists (' in v_definition) = 0 then
    return;
  end if;
  v_patched := replace(
    v_definition,
    'if v_parse_status = ''accepted'' and p_event_version not like ''history:%'' and exists (',
    'if v_parse_status = ''accepted'' and exists ('
  );
  if v_patched = v_definition then raise exception 'history cooldown rollback target not found'; end if;
  execute v_patched;
end;
$$;

create or replace function app_private.fan_out_on_parse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' then
    perform app_private.fan_out_parsed_signal(new.id);
  end if;
  return new;
end;
$$;

revoke execute on function app_private.fan_out_on_parse() from public, anon, authenticated;

drop function if exists public.bot_update_discord_backfill_state(text, text, text, text, boolean, bigint, text);
drop function if exists public.bot_discord_backfill_state(text, text);
drop table if exists app_private.discord_history_backfills;
