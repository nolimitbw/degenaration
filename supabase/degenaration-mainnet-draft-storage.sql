-- Store non-executable bot configurations as Solana Mainnet drafts without
-- weakening the existing mainnet activation gate.

create or replace function public.app_user_save_mainnet_bot_draft(
  p_secret text,
  p_privy_user_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := lower(coalesce(p_payload->>'status', 'draft'));
  v_result jsonb;
  v_bot_id uuid;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if lower(coalesce(p_payload->>'executionMode', '')) <> 'solana-mainnet'
    or v_status = 'active' then
    raise exception 'non-executable Solana Mainnet configuration required' using errcode = '22023';
  end if;

  v_result := public.app_user_save_bot(
    p_secret,
    p_privy_user_id,
    jsonb_set(p_payload, '{executionMode}', '"paper"'::jsonb, true)
  );
  v_bot_id := (v_result #>> '{bot,id}')::uuid;

  update app_private.bot_profiles
  set execution_mode = 'solana-mainnet'
  where id = v_bot_id
    and owner_privy_user_id = p_privy_user_id
    and status <> 'active';

  if not found then
    raise exception 'bot draft was not saved' using errcode = 'P0002';
  end if;

  return jsonb_set(
    jsonb_set(v_result, '{bot,executionMode}', '"solana-mainnet"'::jsonb, true),
    '{bot,updatedAt}',
    to_jsonb(now()),
    true
  );
end;
$$;

revoke execute on function public.app_user_save_mainnet_bot_draft(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.app_user_save_mainnet_bot_draft(text, text, jsonb)
  to service_role;
