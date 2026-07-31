# Database audit

Live audit of the Supabase project (`uqccguunmjabjheeivhx`, Postgres 17.6, ACTIVE_HEALTHY)
performed 2026-07-30. Satisfies the §21 requirement for Supabase security and performance
advisor review, and the §24 RLS / authorization gate.

## Correction to an earlier claim

An earlier report in this session called RLS being disabled on
`app_private.call_executions` "the most serious open item in the whole project". **That
was an over-escalation.** The advisory text is generic ("fully exposed to the anon and
authenticated roles"); I repeated it without checking whether the schema is reachable.

Verified:

```
has_schema_privilege('anon','app_private','USAGE')            = false
has_schema_privilege('authenticated','app_private','USAGE')   = false
has_table_privilege('anon','app_private.call_executions','SELECT') = false
```

`anon` and `authenticated` have **no USAGE on `app_private` at all**, so no table in that
schema is reachable through the client libraries regardless of its RLS state. Enabling RLS
on `call_executions` is still correct defence-in-depth — every sibling table has it — but
it is a low-severity consistency gap, not an exposure.

Remediation, for the owner to apply with policies alongside it (enabling RLS with no
policies denies all access, which is fine for a service-role-only table but should be a
deliberate choice):

```sql
ALTER TABLE app_private.call_executions ENABLE ROW LEVEL SECURITY;
```

## How authorization actually works here

This matters for reading the audit correctly. Every `public` policy is written against
`auth.uid()`, which is **Supabase Auth**. The application authenticates with **Privy**, so
`auth.uid()` is null for real users and these policies deny by default. Live traffic
reaches data through `security definer` RPCs called with the `service_role` key via the
`app-bridge` edge function.

So RLS here is a backstop, not the primary control. The primary control is the RPC
allowlist in `supabase/functions/app-bridge/index.ts` plus `app_private.admin_secret_ok`.
That is a defensible design, but it means "RLS is enabled" is weaker evidence of safety
than it looks, and the RPC allowlist deserves the closer review.

## `public` schema — reachable surface

| Table | RLS | Policies | anon SELECT | Assessment |
|---|---|---|---|---|
| `calls` | on | 1 · `USING (true)` for `public` | yes | **World-readable.** See finding S-1 |
| `approved_groups` | on | 1 · `active = true` for `public` | no (no grant) | Intentional marketplace read |
| `profiles`, `trades`, `journal_entries`, `limit_orders`, `copy_subscriptions`, `subscriptions`, `daily_pnl`, `wallet_pnl_snapshots` | on | 1 each · `auth.uid() = user_id` | grant present, policy denies | Correctly scoped to own rows |
| `call_channels`, `server_applications`, `privy_profiles` | on | **0** | grant present, policy denies | Deny-all. Safe, if incidentally |

## S-1 — `public.calls` is world-readable

The policy is `USING (true)` for role `public`, and `anon` holds SELECT. Anyone with the
anon key can read every row, including:

- `caller` — Discord display names
- `raw` — the raw message content
- `message_id`, `channel_id`, `channel_name`
- pricing and market-cap figures

Public call *performance* is intentional — the marketplace ranks communities on it. Raw
message bodies and caller identities are a different matter and are probably not intended
to be world-readable.

Impact today is negligible: the table holds **1 row**. It scales with ingestion, so it is
better decided now than after the worker starts writing.

Options, for the owner to choose:
1. Restrict the policy to the columns the marketplace actually needs (drop `raw`, `caller`)
2. Serve marketplace reads through an RPC or view and remove the blanket public policy
3. Accept it as intended and record that decision

## S-2 — `anon` holds TRUNCATE, which RLS does not cover

**This corrects the table above.** Its Assessment column reads "grant present, policy
denies" for eleven tables. That is true for SELECT, INSERT, UPDATE and DELETE. It is **not**
true for TRUNCATE: Postgres checks the TRUNCATE privilege and skips row policies entirely,
so no policy can deny it.

Re-checked 2026-07-31 with `has_table_privilege`:

| Tables | anon TRUNCATE | anon policies |
|---|---|---|
| `trades`, `profiles`, `journal_entries`, `subscriptions`, `daily_pnl` | true | 0 |
| `limit_orders`, `copy_subscriptions`, `wallet_pnl_snapshots` | true | 0 |
| `calls`, `call_channels`, `server_applications` | true | 0 |
| `approved_groups`, `privy_profiles` | **false** | 0 |

The last row matters: two tables in the same schema carry no anon grants at all, so this is
the broad default rather than a decision anyone made.

**Not exploitable through the REST API.** PostgREST exposes no TRUNCATE verb and supabase-js
has no truncate method, so there is no known path from the publishable key to these
statements. Recorded as defense in depth, not a breach — the point is that RLS is doing all
the protective work here and this is the one operation outside it.

Migration written and **not applied**:
`supabase/degenaration-revoke-anon-destructive-grants.sql`. Tracked as B-9.

### Method note

The first probe written for this reported three tables as blocked when they were not. It
did `SET ROLE anon`, ran the SELECT, then inserted the result into a temp table — while
still `anon`. The insert failed, the handler caught it, and the failure was recorded as
though the SELECT had been denied. Rewritten to `RESET ROLE` before recording.

A check that fails for the wrong reason is indistinguishable from a check that passes. This
is the third time in this project that pattern has produced a confident wrong answer, after
the `[^>]*` JSX regex and the `%b` git trailer split.

## Two database decisions to make before the worker runs

S-1 and S-2 are both cheap now and expensive later, for the same reason: the tables are
nearly empty, and the worker is what fills them.

| | Decision | If deferred |
|---|---|---|
| S-1 | Whether raw Discord message bodies and caller names stay world-readable | Every ingested call becomes publicly readable as it is written |
| S-2 | Whether to revoke anon TRUNCATE/REFERENCES/TRIGGER | Grant keeps widening as new tables inherit the default |

Neither blocks the worker. Both are easier to settle before it starts writing than after.

## Performance advisor

All findings are `INFO`, all of the form "index has never been used" — roughly 45 of them,
across `trade_intents`, `positions`, `signal_deliveries`, `referral_*`, and others.

That is exactly what an unexercised database looks like: `trade_executions` = 0,
`raw_signals` = 0, `calls` = 1. The indexes are unused because the product has not run, not
because they are wrong. **No action; do not drop them.** Re-run this advisor after the
worker has been live for a while, when the numbers will mean something.

## Auth advisor

`auth_leaked_password_protection` is disabled (WARN). The application uses Privy for
identity, not Supabase Auth passwords, so this is very likely inapplicable. Worth enabling
anyway if any Supabase Auth path exists or is planned.

## Migration state

Applied this session and verified present:

| Migration | Verified |
|---|---|
| `degenaration_fee_allocation_integrity` | 4 fee columns; `retained_fee_lamports` is `GENERATED ALWAYS` |
| `degenaration_commission_allocation_balance` | accrual trigger + `commission_revenue_summary` view |
| `degenaration_user_withdrawals` | `app_user_withdrawable_state` present, service_role only |
| `degenaration_drop_superseded_ledger_owner_check` | superseded anonymous CHECK gone |

Ledger behaviour proven against the live database in a rolled-back transaction: additive
fee rejected, self-referral rejected, valid allocation accepted with retained = 1100000000,
four entries summing to exactly the 2000000000 collected fee, platform net = retained, and
full reversal netting to zero.
