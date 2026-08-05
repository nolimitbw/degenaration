/**
 * The deployment package is reversible — proven, not asserted.
 *
 * Every migration in supabase/ carried a rollback in its header as prose, and not one had
 * ever been executed. Running them for the first time found two defects, both in the class
 * this project keeps hitting: two individually correct halves never checked against each
 * other.
 *
 *   1. degenaration-exit-plan-state.sql widens worker_open_position 15 -> 16 arguments and
 *      worker_settle_position_exit 8 -> 9. Its header said "reapply those two files", but
 *      `create or replace function` at a different arity creates an OVERLOAD. The
 *      documented rollback therefore leaves BOTH arities installed and the worker's own
 *      call fails with "function is not unique" — the identical defect the forward
 *      migration was already fixed for, reintroduced in the direction you only ever run
 *      during an incident. The control run at the bottom of this file reproduces it.
 *
 *   2. The same migration's worker_load_submitted_executions was written from
 *      degenaration-buy-settlement.sql without noticing that
 *      degenaration-copy-execution-integrity.sql had superseded it hours later with a union
 *      over copy_executions. Applying it as drafted would have silently dropped the copy
 *      branch in production: server/engine/store.js dispatches on `execution.source`, so
 *      every submitted copy execution would never be returned and never settle, holding its
 *      reserved capital with nothing raising anywhere.
 *
 * What this verifies, against real PostgreSQL:
 *
 *   baseline            the seven already-applied files, in the order production applied them
 *   -> apply 1..7       the pending package, in its required order
 *   -> roll back 7..1   each rollback script, then its reapply list
 *   -> assert           the catalog is identical to baseline, object for object
 *   -> re-apply 1..7    and assert the catalog is identical to the applied state
 *
 * The re-apply step is the one that matters operationally: a rollback that cannot be
 * followed by a second attempt is not a rollback, it is a one-way door.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// PGlite rethrows Postgres errors with the whole bundle in the stack, which buries the one
// line that matters. Keep failures readable.
process.on("uncaughtException", (err) => {
  console.error(`\nFAILED: ${err.message}\n${err.query ? `while running:\n${err.query.slice(0, 400)}\n` : ""}`);
  process.exit(1);
});
import { PGlite } from "@electric-sql/pglite";
import { renderTables, PRODUCTION_TABLES } from "./lib/production-schema.mjs";
import { BASELINE, PACKAGE, ARITY_CHANGES } from "../supabase/rollback/plan.mjs";

const repo = process.cwd();
const results = {};
const read = (p) => readFile(`${repo}/${p}`, "utf8");

/**
 * Tables no migration creates, so the fixture must. Only existence and the columns a
 * migration's DDL names are load-bearing here: this file verifies that DDL is reversed,
 * not that data flows through it. Every table whose SHAPE matters is rendered from the
 * captured production schema instead.
 */
const STUBS = `
  create table if not exists app_private.bot_profiles (
    id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text,
    source_group_id uuid,
    kind text,
    status text
  );
  -- The product ledger. bot_id / config_version_id / entry_config_snapshot are named by
  -- positions_entry_config_guard's column list, so they must exist for the trigger to be
  -- creatable at all — a trigger's UPDATE OF list is resolved at creation time.
  create table if not exists app_private.positions (
    id uuid primary key default gen_random_uuid(),
    bot_id uuid,
    config_version_id uuid,
    entry_config_snapshot jsonb not null default '{}'::jsonb,
    status text
  );
  create table if not exists app_private.cash_movements (
    id uuid primary key default gen_random_uuid(),
    tx_signature text
  );
  -- The signal journal. degenaration-signal-fanout.sql is in the baseline, and its function
  -- body and its AFTER INSERT trigger both resolve at creation time, so these must exist for
  -- the baseline to apply at all.
  create table if not exists app_private.raw_signals (
    id uuid primary key default gen_random_uuid(),
    source_type text not null,
    source_ref text not null,
    immutable_payload jsonb not null default '{}'::jsonb,
    content_hash text not null
  );
  create table if not exists app_private.parsed_signals (
    id uuid primary key default gen_random_uuid(),
    raw_signal_id uuid not null references app_private.raw_signals(id),
    parser_version text not null,
    status text not null,
    mint text,
    confidence_bps integer,
    rejection_reason text,
    normalized_payload jsonb not null default '{}'::jsonb
  );
  create table if not exists app_private.signal_deliveries (
    id uuid primary key default gen_random_uuid(),
    parsed_signal_id uuid not null references app_private.parsed_signals(id),
    bot_id uuid not null,
    config_version_id uuid not null,
    idempotency_key text not null unique,
    status text not null,
    evaluation jsonb not null default '{}'::jsonb
  );
  -- production-schema.mjs captures CONSTRAINTS but not standalone partial UNIQUE INDEXES, so
  -- this one does not come through renderTables. bot_ingest_discord_signal_v2 infers its
  -- ON CONFLICT against it, and without the index that statement raises 42P10.
  create unique index if not exists calls_message_id_unique
    on public.calls (message_id) where message_id is not null;
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema app_private;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $x$ select null::uuid $x$;
    create function app_private.admin_secret_ok(t text) returns boolean
      language sql stable as $x$ select true $x$;
  `);
  await db.exec(renderTables(Object.keys(PRODUCTION_TABLES)));
  await db.exec(STUBS);
  for (const f of BASELINE) await db.exec(await read(`supabase/${f}`));
  return db;
}

/**
 * Everything a rollback could fail to restore: function identities AND their bodies,
 * columns, indexes, triggers, constraints. Bodies are included deliberately — an
 * arity-stable `create or replace` restores the signature whether or not it restores the
 * behaviour, and only the body distinguishes those two outcomes.
 */
async function snapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    functions: await q(`
      select n.nspname || '.' || p.proname as name,
             p.pronargs,
             pg_get_function_identity_arguments(p.oid) as args,
             md5(coalesce(p.prosrc, '')) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private')
      order by 1, 2, 3`),
    columns: await q(`
      select table_schema || '.' || table_name as tbl, column_name, data_type,
             is_nullable, coalesce(column_default, '') as dflt
      from information_schema.columns
      where table_schema in ('public', 'app_private')
      order by 1, 2`),
    indexes: await q(`
      select schemaname || '.' || indexname as name, indexdef
      from pg_indexes where schemaname in ('public', 'app_private') order by 1`),
    triggers: await q(`
      select c.relname || '.' || t.tgname as name
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname in ('public', 'app_private') order by 1`),
    constraints: await q(`
      select c.conrelid::regclass::text || '.' || c.conname as name,
             pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname in ('public', 'app_private') order by 1`),
  };
}

function diff(a, b, label) {
  const parts = [];
  for (const key of Object.keys(a)) {
    const sa = new Set(a[key].map((r) => JSON.stringify(r)));
    const sb = new Set(b[key].map((r) => JSON.stringify(r)));
    const onlyA = [...sa].filter((x) => !sb.has(x));
    const onlyB = [...sb].filter((x) => !sa.has(x));
    if (onlyA.length || onlyB.length) {
      parts.push(`  ${key}:`);
      for (const x of onlyA.slice(0, 6)) parts.push(`    only in ${label[0]}: ${x}`);
      for (const x of onlyB.slice(0, 6)) parts.push(`    only in ${label[1]}: ${x}`);
    }
  }
  return parts.join("\n");
}

const applyPackage = async (db) => {
  for (const step of PACKAGE) await db.exec(await read(`supabase/${step.apply}`));
};

// ---------------------------------------------------------------------------------------
// 1. Baseline -> apply -> roll back -> assert identical to baseline
// ---------------------------------------------------------------------------------------
const db = await freshDb();
const baseline = await snapshot(db);

await applyPackage(db);
const applied = await snapshot(db);
assert.notDeepEqual(applied, baseline, "the package must actually change the schema");
results.packageApplies = "PASS";

// The package must be rerun-safe: a deployment is often a rerun after a partial failure.
await applyPackage(db);
assert.deepEqual(await snapshot(db), applied, "re-applying the package must be a no-op");
results.packageRerunSafe = "PASS";

for (const step of [...PACKAGE].reverse()) {
  await db.exec(await read(`supabase/rollback/${step.rollback}`));
  // Rollback scripts get re-run under pressure; running one twice must be a no-op.
  await db.exec(await read(`supabase/rollback/${step.rollback}`));
  for (const f of step.reapply) await db.exec(await read(`supabase/${f}`));
}
const rolledBack = await snapshot(db);
results.rollbackScriptsRerunSafe = "PASS";

const drift = diff(baseline, rolledBack, ["baseline", "after rollback"]);
assert.equal(
  drift,
  "",
  `rollback did not restore the baseline schema:\n${drift}\n` +
    "Every difference above is an object a rollback would leave behind in production.",
);
results.rollbackRestoresBaseline = "PASS";

// ---------------------------------------------------------------------------------------
// 2. The package must be installable again after a rollback
// ---------------------------------------------------------------------------------------
await applyPackage(db);
const reapplied = await snapshot(db);
const redrift = diff(applied, reapplied, ["first apply", "apply after rollback"]);
assert.equal(redrift, "", `re-apply after rollback diverged:\n${redrift}`);
results.reappliableAfterRollback = "PASS";

// ---------------------------------------------------------------------------------------
// 3. No function is left with two arities, at any point in the sequence
// ---------------------------------------------------------------------------------------
const duplicateArities = async (d) =>
  (
    await d.query(`
      select n.nspname || '.' || p.proname as name, count(*) as n, array_agg(p.pronargs order by p.pronargs) as arities
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private')
      group by 1 having count(*) > 1`)
  ).rows;

assert.deepEqual(await duplicateArities(db), [], "duplicate function arities after re-apply");
results.noDuplicateArities = "PASS";

// ---------------------------------------------------------------------------------------
// 4. The copy branch survives the package. This is the defect that would have stopped every
//    submitted copy execution from ever settling, silently.
// ---------------------------------------------------------------------------------------
const loadDef = (
  await db.query(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'worker_load_submitted_executions'`)
).rows[0].def;

for (const needle of ["'call'::text", "'copy'::text", "dedupe_key", "app_private.copy_executions"]) {
  assert.ok(
    loadDef.includes(needle),
    `worker_load_submitted_executions lost ${needle} after the package is applied. ` +
      "server/engine/store.js:173 dispatches on execution.source and settles a copy leg " +
      "with execution.dedupe_key, so losing this branch strands every submitted copy trade.",
  );
}
assert.ok(
  loadDef.includes("subscriber_config_snapshot"),
  "worker_load_submitted_executions must still carry the per-subscriber config snapshot",
);
results.copyBranchSurvives = "PASS";

// Definition text is not enough. A `union all` whose two branches disagree on column count
// or type only fails when the function RUNS — which for this one is the worker's first
// tick, in production, with capital already committed. plpgsql does not validate the body
// at creation, so nothing before this line would have caught it. Execute it.
const loaded = (await db.query(`select public.worker_load_submitted_executions(10) as r`)).rows[0].r;
assert.equal(loaded.ok, true, "worker_load_submitted_executions must execute, not just parse");
assert.deepEqual(loaded.executions, [], "no fixture executions are submitted, so none should return");
results.loadSubmittedExecutionsRuns = "PASS";

// ---------------------------------------------------------------------------------------
// 5. CONTROL. Without the explicit drops, the documented prose rollback is broken. This must
//    FAIL in the way the header claimed it would not — otherwise the fix above is unproven.
// ---------------------------------------------------------------------------------------
const control = await freshDb();
await applyPackage(control);
const five = PACKAGE.find((s) => s.n === 5);
// The rollback exactly as the migration header originally documented it: reapply only,
// no explicit drop of the widened signatures.
for (const f of five.reapply) await control.exec(await read(`supabase/${f}`));

const dupes = await duplicateArities(control);
const byName = Object.fromEntries(dupes.map((d) => [d.name, d.arities.map(Number)]));
for (const { fn, from, to } of ARITY_CHANGES) {
  assert.deepEqual(
    byName[fn],
    [from, to],
    `control run did not reproduce the overload for ${fn}; the rollback defect this file ` +
      "exists to prevent may have been fixed elsewhere, in which case update this control.",
  );
}

let ambiguous = "";
try {
  await control.query(`select public.worker_open_position(
    'pk','wal','mint',1.0,1.0,'sig',300,null,0,null,0,null,'privy',null,null)`);
} catch (err) {
  ambiguous = err.message;
}
assert.match(
  ambiguous,
  /is not unique/,
  "control run: a 15-argument worker_open_position call should have been ambiguous",
);
results.controlProvesProseRollbackBroken = "PASS";
await control.close();

// ---------------------------------------------------------------------------------------
console.log(JSON.stringify({ verifier: "migration-rollback", results }, null, 2));
console.log(
  `\n${PACKAGE.length} migrations applied in order, rolled back in reverse, and re-applied.` +
    `\nBaseline restored exactly. ${ARITY_CHANGES.length} arity changes handled explicitly.` +
    `\nControl run confirms the previously documented rollback would have broken the worker.`,
);
await db.close();
