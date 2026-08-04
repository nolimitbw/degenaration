# Post-deployment verification — §16 step 12

"After approved deployment, verify affected-user balances and controlled flows."

This is that procedure, written **before** deployment so the comparison is against a recorded
baseline rather than a remembered one. Every check below is read-only. Nothing here signs,
broadcasts, or mutates.

## Capability, stated accurately

Deployment is **reachable from this environment** through the Supabase MCP connection —
project `uqccguunmjabjheeivhx`, `ACTIVE_HEALTHY`, Postgres 17.6. There is no Supabase CLI, no
Vercel CLI and no credential in the shell, but the MCP tools can apply a migration and deploy
an edge function directly.

So the gate on steps 11–12 is **not capability**. It is the owner's standing instruction:

> Do not promote release 78a4af0 or make another irreversible production change without
> presenting one precise approval package and receiving my explicit approval.

The package is presented. Approval has not been given. That is the only thing outstanding.

## Baseline, read from production 2026-08-04, before any deployment

```
app_users                 5
trading_wallets           0
trade_intents             0
trade_executions          0
positions                 0
position_lots             0
withdrawal_intents        0
cash_movements            0
commission_ledger_entries 0
performance_snapshots     0
raw_signals               0
```

Five real users. Every financial table empty. **This is what makes step 12 tractable:** any
non-zero count afterwards is attributable, and any row that appears without a user action is a
defect, not a coincidence.

## After Part B — the ten migrations

Additive only, so the counts above must be **unchanged**.

```sql
-- 1. No row was created by a schema change.
select 'trade_executions' t, count(*) n from app_private.trade_executions
union all select 'positions', count(*) from app_private.positions
union all select 'position_exits', count(*) from app_private.position_exits
union all select 'performance_snapshots', count(*) from app_private.performance_snapshots;
-- expect: 0, 0, 0, 0

-- 2. The functions exist and are owned correctly.
select proname, pronargs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where proname in ('settle_execution_into_ledger','apply_exit_to_position',
                   'refresh_performance_snapshot','current_referral_share_bps',
                   'admin_client_detail','app_user_position_exits','admin_refresh_performance')
 order by proname;
-- expect: all seven present

-- 3. The settlement function is the FINAL version, not an earlier one in the chain.
--    Applying files 1, 4, 5, 6 out of order installs an earlier body silently.
select prosrc like '%apply_exit_to_position%' as has_exit_path,
       prosrc like '%v_referral_fee%'         as has_referral_path
  from pg_proc where proname = 'settle_execution_into_ledger';
-- expect: true, true.  false anywhere means the order was wrong — reapply 5 then 6.

-- 4. Nothing was granted to the public roles.
select grantee, privilege_type, table_schema, table_name
  from information_schema.role_table_grants
 where table_schema = 'app_private' and grantee in ('anon','authenticated');
-- expect: zero rows
```

## After Part C — app-bridge v12

```bash
npm run verify:bridge-live
```

Every operation must answer **401**, never 400. A 400 is "unknown operation" and means the
deployed function does not know it — the exact shape of the funds incident. The probe sends a
deliberately invalid secret, so no credential is transmitted.

Then, signed in as the owner, open the console's **Clients** tab and press **Recompute
performance**. The truthful answer against the baseline above is:

> No reconciled trades yet, so there is nothing to measure.

Any other answer means something wrote a row that nothing should have written. Do not treat a
number here as success.

## After Part A — application release

```bash
curl -s https://<production-host>/api/build
```

The reported SHA must be `78a4af0`. If it is `29291c9`, the deployment did not take.

Then the affected-user walk, in this order and no further:

1. Sign in as one affected user. `app_private.trading_wallets` gains **exactly one** row for
   that user — the defect being fixed is that it gains none.
   ```sql
   select privy_user_id, address, is_primary, status, created_at
     from app_private.trading_wallets order by created_at desc limit 5;
   ```
2. Confirm the address matches the wallet Privy shows in the UI. A mismatch is release-blocking:
   it means identity was taken from somewhere other than the verified session.
3. Open Portfolio. The balance shown must equal the on-chain balance of that address. It is
   read by direct `getBalance`, so a difference is a display defect, not an accounting one.
4. Open **Withdraw**. Available, locked and pending must be present and consistent with
   `app_user_withdrawable_state`.
5. Enter an amount and reach the confirmation screen. **Stop there.** Do not sign. Do not
   broadcast. The purpose is to prove the flow reaches confirmation with correct figures, and
   §2 forbids a funded mainnet transaction outside an explicit separate approval.
6. Cancel. `withdrawal_intents` may hold a `created` row from step 5; it must not hold two for
   one request.
   ```sql
   select id, state, amount_lamports, destination_address, created_at
     from app_private.withdrawal_intents order by created_at desc limit 10;
   ```

## What must still be zero afterwards

`trade_executions`, `positions`, `position_exits`, `commission_ledger_entries`,
`performance_snapshots`, `raw_signals`. None of them can legitimately gain a row until a
worker runs (E-3) and a Discord bot is deployed (E-2). **A row in any of them after this
deployment is a defect to investigate, not progress.**

## If something is wrong

| Symptom | Action |
|---|---|
| Any bridge operation answers 400 | Redeploy v12 with `verify_jwt: false` |
| `has_exit_path` or `has_referral_path` is false | Reapply migrations 5 then 6, in that order |
| A financial table gained a row | Stop. Do not continue the walk. Capture the row and its `created_at` before anything else |
| `/api/build` reports `29291c9` | The release did not take; redeploy Part A |
| Wallet address does not match Privy's | Release-blocking. Roll back Part A to `29291c9` |
