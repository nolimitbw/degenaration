-- Fan-out could never resolve a source, so every real Discord call reached zero subscribers.
--
-- THE DEFECT
--
-- `app_private.fan_out_parsed_signal` resolved the Discord source with:
--
--     join public.call_channels ch on ch.channel_id = rs.source_ref
--
-- and `public.bot_ingest_discord_signal_v2` writes:
--
--     v_source_ref := 'discord:' || v_guild_id || ':' || p_channel_id;
--
-- so the join compares `discord:1520209045544374342:1521876069693526158` against
-- `1521876069693526158` and never matches. Confirmed against production, where the single
-- existing raw signal joins to NULL on source_ref and to its channel on the payload:
--
--     source_ref          discord:1520209045544374342:1521876069693526158
--     join_on_source_ref  NULL
--     join_on_payload     1521876069693526158
--
-- WHAT IT COSTS
--
-- Nothing raises. `fan_out_on_parse` is an AFTER INSERT trigger that discards the return
-- value, so an ingested call is journaled as `accepted`, the marketplace counts it, and the
-- function returns `delivered: 0, reason: 'no approved channel maps to this signal'` into
-- the void. Every Discord call would be measured and shown, and no subscriber would ever be
-- offered one — the auto-trading path dead on arrival, indistinguishable from a source
-- nobody follows.
--
-- WHY IT WAS GREEN
--
-- The same shape as the rest of this project's failure mode: two individually correct halves
-- never checked against each other. `verify:signal-fanout` inserted its own raw signal with
-- `source_ref = 'chan-1'` — a bare channel id, which ingestion has never once written — so
-- the fixture agreed with the reader instead of with the writer. The fixture is corrected in
-- the same change, and `verify:discord-replay` now composes the two halves so the join is
-- exercised against a source_ref the ingest function actually produced.
--
-- Forward safety: replaces one function body at the same signature. No table, trigger,
-- constraint or grant is altered, and no row is rewritten.
-- Rollback: supabase/rollback/08-signal-fanout-source-ref.sql (reapplies the prior body).

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
  --
  -- source_ref is `discord:<guild>:<channel>` for anything ingestion wrote, so the channel is
  -- its third segment. The payload's channelId is the same value recorded explicitly and is
  -- read as a fallback; a source type that stores the channel reference directly falls through
  -- to source_ref itself. Preferring the structural parse keeps this working for a row whose
  -- payload predates the channelId key.
  select ch.group_id into v_source_group_id
  from app_private.raw_signals rs
  cross join lateral (
    select coalesce(
      nullif(split_part(rs.source_ref, ':', 3), ''),
      nullif(rs.immutable_payload->>'channelId', ''),
      rs.source_ref
    ) as channel_id
  ) src
  join public.call_channels ch on ch.channel_id = src.channel_id
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

revoke execute on function app_private.fan_out_parsed_signal(uuid) from public, anon, authenticated;
