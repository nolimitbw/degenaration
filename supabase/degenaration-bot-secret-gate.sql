-- app_private.bot_secret_ok — the gate every Discord bridge RPC checks.
--
-- WHY THIS FILE EXISTS: this function was only ever created by hand in the live Supabase
-- project, so it was missing from the repo. Every bot RPC calls it
-- (bot_ingest_discord_signal_v2, bot_register_call_channel, bot_enrich_call_pricing, …),
-- which means a fresh project built from these files had no working bot ingestion and
-- the gap was invisible until runtime. Same shape as app_private.admin_secret_ok.
--
-- BEFORE RUNNING: replace the placeholder below with the SHA-256 of your real
-- BOT_SHARED_SECRET. Generate it without putting the secret in your shell history:
--
--     read -rs BOT_SECRET && printf '%s' "$BOT_SECRET" | sha256sum
--
-- Do NOT commit the secret itself — only its hash belongs here.
--
-- If this function already exists in your project with the correct hash, SKIP this file.
-- Running it with the placeholder would break bot ingestion until you set a real hash.

create schema if not exists app_private;

create or replace function app_private.bot_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select p_secret is not null
    and encode(extensions.digest(p_secret, 'sha256'), 'hex') = 'REPLACE_WITH_SHA256_OF_BOT_SHARED_SECRET'
$$;

revoke execute on function app_private.bot_secret_ok(text) from public, anon, authenticated;
