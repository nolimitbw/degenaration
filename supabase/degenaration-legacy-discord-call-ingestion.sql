-- CAPTURED FROM PRODUCTION, NOT AUTHORED HERE.
--
-- public.bot_ingest_discord_call is live in the database and is the RPC behind the
-- bot-bridge `ingest_call` operation, but no file under supabase/ defined it. The repository
-- therefore did not describe its own production surface, and scripts/check-bridge-contract.mjs
-- fails on exactly that: an allowlisted bridge operation with no SQL definition.
--
-- The body below was read back with pg_get_functiondef on 2026-08-04 and is reproduced
-- verbatim apart from formatting. Applying it is a no-op against current production.
--
-- STATUS: legacy. bot_ingest_discord_signal_v2 (degenaration-discord-signal-ingestion.sql)
-- supersedes it with parser versioning, content hashing and the raw-signal journal. This one
-- writes straight to public.calls with no raw event and no parser version, which is why the
-- single production row in public.calls carries confidence 'slash-command' and
-- last_scanned_at NULL. Do not extend it; retire it once the deployed bot no longer calls
-- `ingest_call`.
--
-- DEPENDENCY NOT COMMITTED: app_private.bot_secret_ok(text) also exists only in production.
-- Its body embeds a SHA-256 digest of the bot shared secret, so it is deliberately NOT
-- reproduced here — committing a credential digest hands an attacker an offline brute-force
-- target. See docs/ai/OPEN_BLOCKERS.md. This file assumes that function already exists,
-- which it does.
--
-- Rollback: none required; this is a faithful copy of the deployed function.

create or replace function public.bot_ingest_discord_call(
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
  p_confidence text
)
returns jsonb
language plpgsql
security definer
-- NOTE: production pins 'public', 'pg_temp' here, not the '' used by every function written
-- in this repository. Reproduced as deployed rather than silently hardened, because changing
-- it is a production migration and this file is a record, not a change.
set search_path to 'public', 'pg_temp'
as $$
declare
  v_group_id uuid;
  v_group_name text;
  v_call_id uuid;
  v_existing_id uuid;
begin
  if not app_private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select ch.group_id, coalesce(g.name, ch.guild_name)
  into v_group_id, v_group_name
  from public.call_channels ch
  left join public.approved_groups g on g.id = ch.group_id
  where ch.channel_id = p_channel_id and ch.status = 'approved'
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'channel not approved', 'status', 403);
  end if;

  if nullif(trim(coalesce(p_message_id, '')), '') is not null then
    select id into v_existing_id
    from public.calls
    where message_id = left(trim(p_message_id), 64)
    limit 1;

    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_existing_id, 'group', v_group_name, 'mint', p_mint, 'symbol', p_symbol, 'entryPriceUsd', p_called_price_usd);
    end if;
  end if;

  insert into public.calls (
    group_id, group_name, mint, symbol,
    called_mcap, called_price_usd, peak_price_usd, latest_price_usd,
    peak_mcap, latest_mcap, called_liquidity_usd, latest_liquidity_usd,
    channel_id, channel_name, caller, confidence, message_id
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
    left(trim(p_channel_id), 64),
    nullif(left(trim(coalesce(p_channel_name, '')), 120), ''),
    nullif(left(trim(coalesce(p_caller, '')), 120), ''),
    nullif(left(trim(coalesce(p_confidence, '')), 32), ''),
    nullif(left(trim(coalesce(p_message_id, '')), 64), '')
  )
  returning id into v_call_id;

  return jsonb_build_object('ok', true, 'id', v_call_id, 'group', v_group_name, 'mint', p_mint, 'symbol', p_symbol, 'entryPriceUsd', p_called_price_usd);
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'duplicate', true, 'group', v_group_name, 'mint', p_mint, 'symbol', p_symbol, 'entryPriceUsd', p_called_price_usd);
end;
$$;

revoke execute on function public.bot_ingest_discord_call(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.bot_ingest_discord_call(
  text, text, text, text, text, numeric, numeric, numeric, text, text, text
) to service_role;
