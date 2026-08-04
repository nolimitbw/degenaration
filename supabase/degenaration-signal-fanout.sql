-- Fan a parsed signal out to the bots subscribed to its source.
--
-- WHY
--
-- Spec section 7's chain is: Discord event -> raw immutable event -> parser -> mint validation
-- -> scanner filters -> accepted/rejected/duplicate -> **subscriber fan-out** -> durable trade
-- intent -> execution.
--
-- A writer/reader inventory of that chain finds:
--
--     raw_signals        writers 1   readers 2
--     parsed_signals     writers 1   readers 3
--     signal_deliveries  writers 0   readers 1     <-- the chain stops here
--
-- Ingestion writes raw and parsed rows. Nothing has ever written a delivery. So even with the
-- Discord bot deployed and raw_signals flowing, a parsed call would reach no subscriber and no
-- trade intent would ever be created from a Discord signal. That is not blocked on the bot
-- being deployed -- it is a missing writer, the same defect class as the settlement writer in
-- degenaration-settlement-writer.sql, and it is fixable now.
--
-- WHAT A DELIVERY IS
--
-- One row per (parsed signal, bot). It is the record that a specific bot was offered a
-- specific call, and what was decided. A rejected delivery is as important as an accepted one:
-- without it, "why didn't my bot buy that?" has no answer, which is exactly the opacity the
-- performance journal exists to remove.
--
-- Forward safety: new function only; no table or existing function is altered.
-- Rollback: drop the function. Deliveries already written stay valid.

create or replace function app_private.fan_out_parsed_signal(
  p_parsed_signal_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parsed app_private.parsed_signals%rowtype;
  v_source_group_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
begin
  select * into v_parsed
  from app_private.parsed_signals
  where id = p_parsed_signal_id;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'parsed signal not found');
  end if;

  -- Only a signal the parser accepted, with a mint, can be offered to anyone. A rejected parse
  -- is already explained on parsed_signals.rejection_reason; duplicating that as a delivery per
  -- bot would be noise, not journal.
  if v_parsed.status is distinct from 'accepted' or nullif(trim(coalesce(v_parsed.mint, '')), '') is null then
    return jsonb_build_object(
      'ok', true, 'delivered', 0, 'skipped', 0,
      'reason', coalesce(v_parsed.rejection_reason, 'signal not accepted by the parser')
    );
  end if;

  -- The Discord source this signal came from, resolved through the raw event's channel.
  select ch.group_id into v_source_group_id
  from app_private.raw_signals rs
  join public.call_channels ch on ch.channel_id = rs.source_ref
  where rs.id = v_parsed.raw_signal_id
    and ch.status = 'approved'
  limit 1;

  if v_source_group_id is null then
    return jsonb_build_object(
      'ok', true, 'delivered', 0, 'skipped', 0,
      'reason', 'no approved channel maps to this signal'
    );
  end if;

  -- Every live Discord bot following that source, each with the config version in force right
  -- now. The version is captured per delivery so a later edit cannot rewrite what this bot was
  -- running when the call arrived.
  with candidates as (
    select
      b.id as bot_id,
      (select c.id from app_private.bot_config_versions c
        where c.bot_id = b.id order by c.version desc limit 1) as config_version_id
    from app_private.bot_profiles b
    where b.kind = 'discord'
      and b.source_group_id = v_source_group_id
      and b.status = 'active'
  ),
  inserted as (
    insert into app_private.signal_deliveries (
      parsed_signal_id, bot_id, config_version_id, idempotency_key, status, evaluation
    )
    select
      v_parsed.id,
      c.bot_id,
      c.config_version_id,
      -- One offer per signal per bot, forever. A replayed ingestion or a second worker
      -- collides here rather than offering the same call twice.
      'delivery:' || v_parsed.id::text || ':' || c.bot_id::text,
      'pending',
      jsonb_build_object('mint', v_parsed.mint, 'confidenceBps', v_parsed.confidence_bps)
    from candidates c
    where c.config_version_id is not null
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;

  -- A bot with no config version cannot be offered a call: there would be nothing to execute
  -- it under. Counted rather than silently dropped.
  select count(*) into v_skipped
  from app_private.bot_profiles b
  where b.kind = 'discord'
    and b.source_group_id = v_source_group_id
    and b.status = 'active'
    and not exists (
      select 1 from app_private.bot_config_versions c where c.bot_id = b.id
    );

  return jsonb_build_object(
    'ok', true,
    'delivered', v_created,
    'skipped', v_skipped,
    'sourceGroupId', v_source_group_id,
    'mint', v_parsed.mint
  );
end;
$$;

-- Fires as soon as the parser writes an accepted signal, so ingestion needs no second call and
-- cannot forget to fan out.
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

drop trigger if exists parsed_signals_fan_out on app_private.parsed_signals;
create trigger parsed_signals_fan_out
after insert on app_private.parsed_signals
for each row execute function app_private.fan_out_on_parse();

revoke execute on function app_private.fan_out_parsed_signal(uuid) from public, anon, authenticated;
revoke execute on function app_private.fan_out_on_parse() from public, anon, authenticated;
