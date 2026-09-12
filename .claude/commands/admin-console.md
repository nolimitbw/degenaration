---
description: Work on the DegenAration Admin Console — client balances, volume, histories, audited controls
---

Work on the owner-only Admin Console.

Authorization is three-deep and every layer is load-bearing:

1. `requireAdmin` proves a verified Google identity server-side. Never a client-side email
   comparison.
2. The route refuses the weaker legacy session path.
3. The RPC itself calls `require_app_admin` on the actor — this is the one that matters if the
   route is ever called by something other than the console.

The primary admin identity is normalized for case. A normal user must not see admin
navigation, reach admin routes, call admin APIs, or read another user's data.

What the console must show:

- **Dashboard** — users and active users, client principal, available and locked, pending
  withdrawals, open-position notional, volume today / 7D / 30D / lifetime, platform fees,
  Discord and KOL allocations, referral allocations, the DegenAration remainder, active bots,
  approved and pending sources, worker health, reconciliation warnings, failed withdrawals and
  executions, stale scanners.
- **Client table** — searchable, sortable, paginated, with the balances, volumes, PnL, fees,
  bots and referral status per client.
- **Client detail** — balance breakdown, wallet history, deposits, withdrawals and their
  intents, trade intents, executions, positions and lots, fees, commissions, referrals,
  subscriptions, bot lifecycle, failed operations, reconciliation, audit events.

**Volume means confirmed executed notional.** Never a quote, a simulation, a failed or
cancelled transaction, or a duplicate. Document the definition wherever it is displayed.

There is deliberately **no client balance column** and that is not an omission: the product is
non-custodial, the SOL sits in a wallet the client controls, and SQL cannot read a chain
balance. Show the wallet address for lookup and say so on the screen.

Never add an "edit balance" control. Never expose a key or a secret. Every emergency action
records admin, reason, timestamp and result in the audit log.

Allowed audited actions: approve / reject / suspend / remove / restore a Discord source, pause
a compromised source, pause new entries while preserving exits, inspect failures, retry an
idempotent job, export a report, read the audit log.
