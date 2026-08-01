-- Make bot archival terminal, keep one live Discord bot per source and preserve
-- the exact configuration attached to every new private-ledger position.
--
-- Forward safety: existing rows are not rewritten. The unique index fails closed
-- if pre-existing duplicate live Discord profiles need an operator decision.
-- Rollback: drop the two triggers, their functions and the unique index. Position
-- and bot history created while this migration is active remains valid.

create unique index if not exists bot_profiles_owner_discord_source_unique
  on app_private.bot_profiles (owner_privy_user_id, source_group_id)
  where kind = 'discord' and source_group_id is not null and status <> 'archived';

create or replace function app_private.enforce_bot_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'archived bot cannot be restored' using errcode = '23514';
  end if;

  if old.status <> 'archived' and new.status = 'archived' and exists (
    select 1
    from app_private.positions p
    where p.bot_id = old.id and p.status in ('opening', 'open', 'closing')
  ) then
    raise exception 'bot has open positions' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists bot_profiles_lifecycle_guard on app_private.bot_profiles;
create trigger bot_profiles_lifecycle_guard
before update of status on app_private.bot_profiles
for each row execute function app_private.enforce_bot_lifecycle();

create or replace function app_private.protect_position_entry_config()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version_config jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.bot_id is distinct from old.bot_id
      or new.config_version_id is distinct from old.config_version_id
      or new.entry_config_snapshot is distinct from old.entry_config_snapshot then
      raise exception 'position entry configuration is immutable' using errcode = '55000';
    end if;
    return new;
  end if;

  if new.bot_id is null then
    return new;
  end if;
  if new.config_version_id is null or new.entry_config_snapshot = '{}'::jsonb then
    raise exception 'bot position requires an entry configuration snapshot' using errcode = '23514';
  end if;

  select c.config into v_version_config
  from app_private.bot_config_versions c
  where c.id = new.config_version_id and c.bot_id = new.bot_id;

  if not found or v_version_config is distinct from new.entry_config_snapshot then
    raise exception 'position entry configuration does not match bot version' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists positions_entry_config_guard on app_private.positions;
create trigger positions_entry_config_guard
before insert or update of bot_id, config_version_id, entry_config_snapshot
on app_private.positions
for each row execute function app_private.protect_position_entry_config();

revoke execute on function app_private.enforce_bot_lifecycle() from public, anon, authenticated;
revoke execute on function app_private.protect_position_entry_config() from public, anon, authenticated;
