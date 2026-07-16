create or replace function public.app_submit_server_application(
  p_secret text,
  p_server_name text,
  p_invite_link text,
  p_owner_handle text,
  p_member_count text,
  p_pitch text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if nullif(trim(p_server_name), '') is null
    or nullif(trim(p_invite_link), '') is null
    or nullif(trim(p_owner_handle), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid application', 'status', 400);
  end if;

  insert into public.server_applications (
    server_name, invite_link, owner_handle, member_count, pitch, status
  ) values (
    left(trim(p_server_name), 100),
    left(trim(p_invite_link), 200),
    left(trim(p_owner_handle), 100),
    nullif(left(trim(coalesce(p_member_count, '')), 30), ''),
    nullif(left(trim(coalesce(p_pitch, '')), 1000), ''),
    'pending'
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function public.app_submit_server_application(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.app_submit_server_application(text, text, text, text, text, text) to service_role;

do $$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'app_user_%' or p.proname like 'admin_%')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;
