# Test evidence

Updated: 2026-08-02

## Fixtures are generated from production, not hand-written

Every `verify-*.mjs` script used to hand-write its PGlite fixture schema. That is how a
release-blocking defect reached a PASS: the subscriber-config fixture declared
`copy_subscriptions.size_sol` as `numeric`, production declares it `double precision`, and
`float8 → numeric` is an assignment cast, so PostgreSQL could not resolve the trigger's
call and every write to that table would have raised.

`scripts/lib/production-schema.mjs` now holds the captured production shapes and generates
the DDL. `scripts/lib/README-schema-capture.sql` is the read-only re-capture query.
`assertSchemaParity()` re-checks the live fixture against the capture before and after each
migration, so a fixture cannot drift without that file changing.

Rule: if a parity assertion fails, either production changed (re-capture) or the migration
is wrong (fix the migration). Never edit the capture to make a verification pass.

## Subscriber configuration versioning

Repository migration: `supabase/degenaration-subscriber-config-versioning.sql`.

Read-only production preflight: `app_private.subscriber_config_versions` does not exist;
`subscriptions`=1 row, `copy_subscriptions`=0, `kol_subscriptions`=0, `call_executions`=0,
`copy_executions`=0, `bot_config_versions`=0, `trading_wallets`=0;
`has_schema_privilege('service_role','app_private','USAGE')` is **false**. No production
DDL or DML was executed.

```text
npm run verify:subscriber-config
```

Result: PASS, 19 checks.

```text
schema parity                        PASS (7 tables, before and after)
row preservation + double apply      PASS
legacy compatibility baseline        PASS
double precision copy path           PASS
integer clamp before cast            PASS
KOL effective configuration          PASS
versioned builder payload            PASS
invalid configuration                REFUSED
subscription with no owner           NOT EXECUTABLE
durable versions per subscription    PASS
execution snapshot mutation          REFUSED
forged snapshot write                DISCARDED
kill switch blocks execution         PASS
daily spend does not version         PASS
triggers are security definer        PASS
service_role without app_private     PASS
invoker-rights control               FAILED, as required
anon/authenticated direct read       REJECTED
```

The last two matter together. The service_role case reproduces production's grant model —
`service_role` writing `public.subscriptions` and `public.copy_subscriptions` with
`app_private` closed to it. The control then recreates one trigger function with invoker
rights and asserts it fails with `permission denied`. Without the control, the definer
result would be unfalsifiable.

### Pre-fix reproduction

Applying the migration as it stood before the fix, to a production-shaped fixture:

```text
function app_private.legacy_subscriber_config(text, text, double precision,
double precision, integer, numeric, integer, numeric, integer, integer,
boolean, boolean) does not exist
```

The backfill would have aborted part-applied.

## Discord marketplace migration

Repository migration: `supabase/degenaration-discord-marketplace-parity.sql` from commit
`18f4f23`.

### Safe database validation

The production project was queried read-only to confirm its pre-migration state and exact
schema compatibility. No production DDL or DML was executed.

- Existing marketplace RPC: present, parity fields absent.
- Approved sources: 2; calls: 1; subscriptions: 1.
- Call executions, performance snapshots, and commission entries: 0.
- Every column referenced by the migration exists.
- Required indexes exist for calls by source/time, call executions by call/subscription,
  performance snapshots by subject/period/time, channels, followers, and marketplace
  visibility.
- RPC authorization before migration: `public=false`, `anon=false`,
  `authenticated=false`, `service_role=true`; `SECURITY DEFINER`; empty `search_path`.
- `anon` and `authenticated` have no `USAGE` on `app_private` and no direct reads on the
  execution or performance tables.

An isolated PostgreSQL-compatible PGlite database then recreated the current
pre-migration function and representative rows. The checked-in command is:

```text
npm run verify:marketplace-migration
```

Result: PASS.

```text
approved_groups       2 -> 2
calls                  4 -> 4
subscriptions          2 -> 2
call_executions        1 -> 1
performance_snapshots 2 -> 2
trade_executions       1 -> 1
commissions            1 -> 1
rerun                  PASS
authorization          PASS
unknown metrics null   PASS
accepted/rejected/executed fixture counts 2/2/1
7D net PnL fixture     500 lamports
```

The test applies the parity migration twice, calls the marketplace query as
`service_role`, proves `anon` and `authenticated` denial, verifies measured output, and
proves that unavailable return/PnL/freshness fields remain `null` rather than false zero.

### Dependency record

`@electric-sql/pglite@0.5.4` is pinned as a development-only dependency. It supplies a
real PostgreSQL engine for repeatable migration tests where Docker, `psql`, and the
Supabase CLI are unavailable. It is not imported by product code or shipped in the web
bundle.

Installation and audit command:

```text
npm install --ignore-scripts --offline --cache /private/tmp/degen-npm-cache
```

Result: one development package added; 960 packages audited; 0 vulnerabilities.

### Deployment state

The migration has not been applied to production. The production function remains the
pre-migration definition, so live-card evidence remains pending. This is deliberate: the
task forbids deployment without a confirmed target, and no safe staging branch is
currently available through the connected project.

## Bot lifecycle and owner journal

Repository migrations:

- `supabase/degenaration-bot-lifecycle-safety.sql`
- `supabase/degenaration-bot-activity.sql`

Read-only production preflight found zero duplicate live Discord source/profile sets and
zero existing private-ledger bot positions missing a configuration version or entry
snapshot. It also confirmed that neither new migration is deployed. No production DDL or
DML was executed.

The checked-in isolated PostgreSQL command is:

```text
npm run verify:bot-lifecycle
```

Result: PASS for the tested database contract.

```text
migration rerun                 PASS
owner isolation                PASS
create, hydrate, edit           PASS
immutable config versions      PASS (v1 remains unchanged through v6)
activate, pause, resume         PASS
archive with open position     REJECTED (product ledger)
archive with worker position   REJECTED (public.positions)
archive after close            PASS
restore archived bot           REJECTED
entry snapshot retention       PASS
entry snapshot mutation        REJECTED
duplicate live Discord source  REJECTED
KOL duplicate as new bot       PASS
owner signal/execution journal PASS
anon/authenticated RPC access  REJECTED
service-role bridge access     PASS
```

The test executes the actual bot save/list/get RPC definitions, the mainnet-draft wrapper,
and both new migrations. It uses two simulated authenticated subjects and a position tied
to version 2, then proves later edits through version 6 do not alter that position's version
or configuration snapshot. A journal fixture proves the owner can inspect a signal and its
latest reconciled execution while another subject receives a 404-shaped denial.

The manager now links separately to owner-only signals/executions and Portfolio positions.
Authenticated HTTP/browser evidence is not claimed yet; it still needs a non-production
Privy test identity or an existing authenticated test browser session.

### The archive guard was unfireable

`enforce_bot_lifecycle()` blocked archival by querying `app_private.positions`, which no
code path writes — the worker opens positions in `public.positions`. A bot holding
genuinely open, funded positions would therefore archive cleanly.

Control run, with the guard restored to its previous form:

```text
AssertionError: Missing expected rejection: archival must fail closed on the
worker's position ledger too
```

With the fix, archival is refused and then permitted once the worker position closes. The
guard now checks both ledgers. Root cause is recorded as I-1 in `OPEN_BLOCKERS.md`.

## Discord marketplace, additional coverage

The marketplace fixture was rebuilt from production shapes, which exposed three gaps in
what the previous run could reach:

```text
schema parity                        PASS
integration grace window (degraded)  PASS
expired grace window (delisted)      PASS
orphaned call does not inflate       PASS
```

`approved_groups.profile_sync_grace_started_at` is `NOT NULL DEFAULT now()` in production;
the fixture had it nullable and NULL, and the listing rule is
`coalesce(profile_sync_failed_at, profile_sync_grace_started_at) >= now() - interval
'7 days'`. `coalesce(null, null) >= …` is NULL, never true, so the seven-day integration
grace window was unreachable in every previous run — and both live sources carry a
non-null grace timestamp, so that is the branch production takes.
