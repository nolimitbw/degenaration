---
name: degenaration-admin-operations
description: Rules for the DegenAration owner console — admin authorization, client balances and volume, audited actions, and what must never be exposed or editable. Use when changing any admin route, RPC, or console surface.
---

# Admin operations

## Authorization is three-deep, and each layer matters

1. `requireAdmin` — a verified Google identity, checked server-side. **Never** a client-side
   email comparison, and never a client-supplied user ID.
2. The route refuses the weaker legacy session path explicitly.
3. The RPC calls `require_app_admin` on the actor. This is the layer that holds if the route
   is ever called by something other than the console: the shared secret authenticates the
   edge function, the role check authorizes the person.

A normal user must not see admin navigation, reach an admin route, call an admin API, or read
another user's data. Test the denial, not just the grant.

## Volume has one definition

**Confirmed executed notional.** Not a quote, not a simulation, not a failed or cancelled
transaction, not a duplicate. Write the definition on any screen that shows the number.

## There is no balance column, deliberately

The product is non-custodial. A client's SOL is in a wallet they control and the database
cannot read a chain balance. Show the wallet address for lookup and state the custody model on
the screen. A column of numbers the database cannot verify is worse than no column.

## Never

- add an "edit balance" control, or any arbitrary balance mutation
- expose a private key, seed phrase, service-role key, OAuth secret or signing material
- perform an emergency action without recording admin, reason, timestamp and result
- present an admin-only diagnostic in a normal user's UI

## Audited actions that are allowed

Approve, reject, suspend, remove and restore a Discord source. Pause a compromised source.
Pause new entries while preserving exits. Inspect failures. Retry an idempotent job. Export a
report. Read the audit log.

## Snapshots and freshness

`app_private.performance_snapshots` is recomputed from the ledger by
`admin_refresh_performance`, exposed in the console's Clients tab. It writes no row for a
subject with no executions — which is what keeps a source showing "tracking" rather than a
fabricated zero. If that action ever reports snapshots for an empty ledger, something wrote a
row that nothing should have written.

```bash
npm run verify:admin-client-ledger
npm run verify:performance-snapshots
```
