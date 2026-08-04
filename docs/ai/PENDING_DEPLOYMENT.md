# Pending deployment package

Everything verified in the repository and **not yet applied to production**, in the order it
must be applied. Written 2026-08-04.

Nothing here has been deployed. Each item is presented so the owner can approve the set, or
any prefix of it, as one decision.

## Why the order matters

Four of these files replace `app_private.settle_execution_into_ledger()` in sequence, each
with a superset of the last. Applying them out of order leaves an earlier, less complete
version installed — no error, just a settlement that silently stops doing part of its job.
The verifiers apply them in exactly this order, so a run of `npm run check` is a rehearsal of
the deployment.

## Migrations, in apply order

| # | File | What it adds | Verifier |
|---|---|---|---|
| 1 | `degenaration-settlement-writer.sql` | the writer for `trade_executions`, `positions`, `position_lots` | `verify:settlement-writer` |
| 2 | `degenaration-signal-fanout.sql` | a delivery row per (signal, bot) — `signal_deliveries` had no writer | `verify:signal-fanout` |
| 3 | `degenaration-intent-reconciliation.sql` | expires abandoned intents; never one carrying a signature | `verify:intent-reconciliation` |
| 4 | `degenaration-execution-record-fields.sql` | slot, filled quantity, price, slippage, impact — §5.4 | `verify:settlement-writer` |
| 5 | `degenaration-exit-settlement.sql` | FIFO lot consumption, realized PnL, position closure, `proceeds_lamports` | `verify:exit-settlement` |
| 6 | `degenaration-creator-referral-allocation.sql` | resolves the creator and referrer at settlement — §13.2/13.3 | `verify:creator-referral` |
| 7 | `degenaration-performance-snapshots.sql` | the writer for `performance_snapshots`, the equity series the Portfolio chart reads, and the operator refresh | `verify:performance-snapshots` |
| 8 | `degenaration-admin-client-ledger.sql` | `admin_client_ledger`, `admin_business_summary` — §8 | `verify:admin-client-ledger` |
| 9 | `degenaration-position-exit-detail.sql` | `app_user_position_exits` — what closed a position and at what price, for the §18 card | `verify:exit-settlement` |
| 10 | `degenaration-admin-client-detail.sql` | `admin_client_detail` — the §8 per-client drill-down | `verify:admin-client-ledger` |

Files 1, 4, 5 and 6 each replace the settlement function. 1 → 4 → 5 → 6 is mandatory.

## Edge function

`supabase/functions/app-bridge/index.ts` — the deployed copy is **v11**. The repository adds
`admin_refresh_performance`, `app_user_position_exits` and `admin_client_detail`, which makes it **v12**. Without the redeploy the new Clients-tab
refresh returns `400 unknown operation`, exactly the failure mode the funds incident was.

Deploy with `verify_jwt: false`. The default is `true`, and flipping it 401s every call.

## Application release

`release/funds-runtime-hotfix-2026-08-04` @ `78a4af0` — wallet registration and withdrawal
idempotency, extracted as runtime-only application behavior. Still awaiting the promotion
decision; unchanged since it was prepared.

## What each migration is safe about

All ten are forward-safe by construction: additive nullable columns, widened rather than
narrowed CHECKs, new tables, and functions replaced with supersets. No file rewrites an
existing row, drops a column carrying data, or narrows an existing constraint.

Rollback for every one is recorded in the file header. Rows already written by a rolled-back
migration stay valid.

## What deploying them does NOT do

- **It does not start trading.** No worker is running (E-3), so nothing calls the queue.
- **It does not collect a fee.** `PLATFORM_FEE_ACCOUNT` is unset (E-4), so
  `current_platform_fee_bps()` returns 0 and every allocation computes to 0.
- **It does not populate the marketplace.** `raw_signals` = 0 because no Discord bot is
  deployed (E-2). The refresh writes no snapshot for a source with no executions, so the two
  approved sources keep showing "tracking" — which stays the honest state.

What it does do is make every one of those things work the moment its blocker is lifted,
instead of surfacing a fourth missing writer with live money moving.

## Verifying after deployment

```
npm run verify:bridge-live      # every operation must answer 401, never 400
npm run check                   # the full suite, including all eight migrations
```

Then, in the console's Clients tab, **Recompute performance** must return "No reconciled
trades yet" — the truthful answer while the ledger is empty. Any other answer means something
wrote a row that nothing should have written.
