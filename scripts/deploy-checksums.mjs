/**
 * Generate a SQL probe that proves production's deployed function bodies are byte-identical
 * to this repository's.
 *
 * WHY. Migrations reach production as text pasted into an apply call, not as a file
 * transfer. Nothing in that path detects a truncated paste, a dropped clause or a mangled
 * dollar-quote — and a plpgsql body is not validated at creation, so a corrupted function
 * installs cleanly and fails later, at runtime, on the worker's first tick. Checking that
 * the object EXISTS is not the same as checking it is the RIGHT object.
 *
 * So: apply the package to PGlite from the files on disk, take md5(prosrc) of every function
 * the package defines, and emit a query that asks production for the same digests and
 * returns only the rows that disagree. An empty result is the proof.
 *
 * Usage:  node scripts/deploy-checksums.mjs [stopAfterMigrationNumber]
 */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, PRODUCTION_TABLES } from "./lib/production-schema.mjs";
import { BASELINE, PACKAGE } from "../supabase/rollback/plan.mjs";

const stopAfter = Number(process.argv[2] ?? PACKAGE.length);
const repo = process.cwd();
const read = (p) => readFile(`${repo}/${p}`, "utf8");

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private; create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $x$ select null::uuid $x$;
  create function app_private.admin_secret_ok(t text) returns boolean
    language sql stable as $x$ select true $x$;
`);
await db.exec(renderTables(Object.keys(PRODUCTION_TABLES)));
await db.exec(`
  create table if not exists app_private.bot_profiles (
    id uuid primary key default gen_random_uuid(), owner_privy_user_id text,
    source_group_id uuid, kind text, status text);
  create table if not exists app_private.positions (
    id uuid primary key default gen_random_uuid(), bot_id uuid, config_version_id uuid,
    entry_config_snapshot jsonb not null default '{}'::jsonb, status text);
  create table if not exists app_private.cash_movements (
    id uuid primary key default gen_random_uuid(), tx_signature text);
`);
for (const f of BASELINE) await db.exec(await read(`supabase/${f}`));

// Digest the baseline so the diff below reports only what the package itself installs.
const digest = async () =>
  new Map(
    (
      await db.query(`
        select n.nspname || '.' || p.proname || '(' ||
               pg_get_function_identity_arguments(p.oid) || ')' as sig,
               md5(p.prosrc) as body
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app_private') and p.prokind = 'f'`)
    ).rows.map((r) => [r.sig, r.body]),
  );

const before = await digest();
const applied = [];
for (const step of PACKAGE.filter((s) => s.n <= stopAfter)) {
  await db.exec(await read(`supabase/${step.apply}`));
  applied.push(step.n);
}
const after = await digest();

// Only functions the package created or changed.
const expected = [...after].filter(([sig, body]) => before.get(sig) !== body).sort();

const values = expected.map(([sig, body]) => `('${sig.replace(/'/g, "''")}','${body}')`).join(",\n    ");

console.log(`-- ${expected.length} function(s) defined or changed by migrations ${applied.join(", ")}.
-- Run this against production. An EMPTY result set is the proof: every deployed body is
-- byte-identical to this repository. Any row is a mismatch or a missing function.
with expected(sig, body) as (values
    ${values}
),
deployed as (
  select n.nspname || '.' || p.proname || '(' ||
         pg_get_function_identity_arguments(p.oid) || ')' as sig,
         md5(p.prosrc) as body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','app_private') and p.prokind = 'f'
)
select e.sig,
       case when d.sig is null then 'MISSING IN PRODUCTION' else 'BODY DIFFERS' end as problem
from expected e left join deployed d on d.sig = e.sig and d.body = e.body
where d.sig is null
order by 1;`);

await db.close();
