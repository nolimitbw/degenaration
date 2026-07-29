# DegenAration Architecture

Updated: 2026-07-26

## Target Runtime

```text
Browser
  -> Next.js authenticated APIs
      -> Privy JWT and verified wallet ownership
      -> allowlisted Supabase app bridge
      -> provider adapters for market, risk, quote, and chain state
  -> Supabase Postgres
      -> identity roles and grants
      -> versioned bot configurations
      -> signals, intents, executions, positions, lots
      -> immutable financial and commission ledgers
      -> outbox, jobs, leases, dead letters, audit events

Discord gateway
  -> verified guild/channel registry
  -> immutable raw events and parser results
  -> outbox delivery

Automation worker
  -> durable lease and job claim
  -> paper/devnet/mainnet execution adapter
  -> spend reservation and safety evaluation
  -> submission, confirmation, reconciliation, ledger posting
```

## Trust Boundaries

1. Browser input and Discord content are untrusted.
2. Privy access JWTs identify a user; signed identity tokens prove linked identities.
3. A verified identity is synchronized to a database role before admin authorization.
4. Bridge operations are explicit allowlists and never accept arbitrary RPC names.
5. Provider data is normalized server-side with freshness and availability metadata.
6. A quote is not a trade, submission is not confirmation, and confirmation is not
   reconciliation.
7. Commission and payout balances are derived from immutable integer ledger entries.

## Execution Modes

| Mode | Signing | Chain | Purpose |
| --- | --- | --- | --- |
| `paper` | None | Read-only market data | Product development and deterministic tests |
| `solana-devnet` | Explicit devnet signer | Devnet | Controlled integration verification |
| `solana-mainnet` | Gated delegated signer | Mainnet | Disabled until controlled mainnet review |

## Required State Machines

```text
Bot: DRAFT -> ACTIVE -> PAUSED -> STOPPING -> ARCHIVED
                                  \-> ERROR

Intent: CREATED -> VALIDATING -> READY -> CLAIMED -> SUBMITTING
        -> SUBMITTED -> CONFIRMED -> RECONCILED
        -> FAILED | EXPIRED | CANCELLED | QUARANTINED

Payout: REQUESTED -> REVIEWING -> APPROVED -> PROCESSING
        -> CONFIRMED | FAILED | REJECTED | REVERSED
```

## Accounting

- Store lamports and token base units as integers.
- Store fee rates as basis points.
- Snapshot platform rate, creator rate, creator ownership, bot version, and source on
  the execution.
- Post balanced ledger entries only after an eligible transaction is reconciled.
- Derive available, pending, paid, and reversed balances from ledger entries.
- Never update historical ledger amounts in place.

## Scanner

Adapters expose discovery, pool resolution, snapshot, and health contracts. Filter
evaluation consumes normalized snapshots and returns pass, reject, unavailable, or
unsupported with evidence. An enabled filter with unavailable data fails closed.
The UI lists only adapters with measured support and freshness.

