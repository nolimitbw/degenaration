create or replace function public.app_scanner_status(
  p_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x."displayName"), '[]'::jsonb)
  into v_rows
  from (
    select
      a.adapter_key as "key",
      a.display_name as "displayName",
      a.adapter_version as "version",
      a.status,
      a.program_ids as "programIds",
      a.capabilities,
      a.limitation,
      a.last_success_at as "lastSuccessAt",
      a.last_failure_at as "lastFailureAt",
      a.slot_lag as "slotLag",
      a.updated_at as "updatedAt"
    from app_private.scanner_adapters a
  ) x;

  return jsonb_build_object('ok', true, 'adapters', v_rows);
end;
$$;

revoke execute on function public.app_scanner_status(text) from public, anon, authenticated;
grant execute on function public.app_scanner_status(text) to service_role;
