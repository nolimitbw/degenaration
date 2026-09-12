-- Re-capture the production shapes recorded in scripts/lib/production-schema.mjs.
--
-- Read-only. Run against the production project with a read-only connection or the
-- Supabase SQL editor, then transcribe the result into PRODUCTION_TABLES.
--
-- Never hand-edit production-schema.mjs to make a verification pass. If a fixture
-- assertion fails, either production really changed (re-capture) or the migration is
-- wrong (fix the migration).

with captured as (
  select unnest(array[
    'public.subscriptions',
    'public.copy_subscriptions',
    'app_private.kol_subscriptions',
    'app_private.call_executions',
    'app_private.copy_executions',
    'app_private.bot_config_versions',
    'app_private.trading_wallets'
  ])::regclass as oid
)
select
  c.relnamespace::regnamespace::text || '.' || c.relname as qualified_name,
  (select json_agg(json_build_object(
      'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
     from pg_attribute a
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
  (select json_agg(json_build_object('type', con.contype, 'def', pg_get_constraintdef(con.oid))
            order by con.contype, con.conname)
     from pg_constraint con where con.conrelid = c.oid) as constraints,
  (select json_agg(pg_get_indexdef(i.indexrelid))
     from pg_index i
    where i.indrelid = c.oid and i.indisunique
      and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid))
    as standalone_unique_indexes
from captured
join pg_class c on c.oid = captured.oid
order by qualified_name;
