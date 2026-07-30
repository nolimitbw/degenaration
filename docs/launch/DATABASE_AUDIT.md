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
