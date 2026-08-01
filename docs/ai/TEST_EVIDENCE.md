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

