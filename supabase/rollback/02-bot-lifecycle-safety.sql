-- Rollback of degenaration-bot-lifecycle-safety.sql
--
-- Two guard triggers, their functions, and one partial unique index. None of them holds
-- data, so this is unconditional and needs no reapply afterwards.
--
-- Note what rolling this back re-opens: without bot_profiles_lifecycle_guard an archived
-- bot can be restored and a bot holding open funded positions can be archived, and without
-- positions_entry_config_guard a position's entry configuration becomes mutable after the
-- fact. That is the pre-migration behaviour, which is the point of a rollback — but it is
-- a loosening of a safety property, not a neutral revert, so roll this one back only if it
-- is the migration actually causing the incident.
--
-- Rerun-safe: every statement is `if exists`.

drop trigger if exists positions_entry_config_guard on app_private.positions;
drop trigger if exists bot_profiles_lifecycle_guard on app_private.bot_profiles;

drop function if exists app_private.protect_position_entry_config();
drop function if exists app_private.enforce_bot_lifecycle();

drop index if exists app_private.bot_profiles_owner_discord_source_unique;
