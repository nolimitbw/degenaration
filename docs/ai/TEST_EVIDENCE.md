# Test evidence

Updated: 2026-08-01

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
archive with open position     REJECTED
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
