-- Keep approved Discord source referral links in the canonical referral resolver
-- after source ownership has been verified.

create unique index if not exists referral_links_discord_subject_unique
  on app_private.referral_links (subject_type, subject_id)
  where subject_type = 'discord';

create or replace function app_private.sync_discord_group_referral_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_privy_user_id is not null
    and new.referral_code is not null
    and new.active = true
    and new.verification_status = 'approved'
    and new.removed_at is null
    and exists (
      select 1
      from app_private.app_users u
      where u.privy_user_id = new.owner_privy_user_id
        and u.status = 'active'
    ) then
    insert into app_private.referral_links (
      owner_privy_user_id,
      code,
      subject_type,
      subject_id,
      active,
      disabled_at
    ) values (
      new.owner_privy_user_id,
      new.referral_code,
      'discord',
      new.id::text,
      true,
      null
    )
    on conflict (subject_type, subject_id) where subject_type = 'discord'
    do update set
      owner_privy_user_id = excluded.owner_privy_user_id,
      code = excluded.code,
      active = true,
      disabled_at = null;
  else
    update app_private.referral_links
    set active = false,
        disabled_at = coalesce(disabled_at, now())
    where subject_type = 'discord'
      and subject_id = new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists approved_groups_sync_referral_link
  on public.approved_groups;
create trigger approved_groups_sync_referral_link
after insert or update of
  owner_privy_user_id,
  referral_code,
  active,
  verification_status,
  removed_at
on public.approved_groups
for each row execute function app_private.sync_discord_group_referral_link();

revoke execute on function app_private.sync_discord_group_referral_link()
  from public, anon, authenticated;
