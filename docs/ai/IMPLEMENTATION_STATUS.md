# Implementation status

Updated: 2026-08-02

`PASS` requires reproducible evidence. Deployment-dependent behavior remains `PARTIAL` or
`BLOCKED` even when its local implementation passes.

| Priority | Requirement | Status | Evidence / exact remainder |
| --- | --- | --- | --- |
| 1 | Subscriber configuration and copy safety | PASS (contract) | `0d40b15`. `npm run verify:subscriber-config` runs 19 checks against a fixture generated from the captured production schema, including the `double precision` copy path, clamp-before-cast, refusal of an invalid configuration, a discarded forged snapshot, a subscription with no owner being non-executable, `service_role` writing with `app_private` closed to it, and an invoker-rights control that must fail. Five migration defects and one worker defect were found and fixed; the pre-fix migration is proven to abort on production types. **Not applied to production** (E-1). |
| 2 | Discord marketplace migration safety | PASS | `10942cf`. Fixture rebuilt from production shapes, which exposed that the seven-day integration grace window was unreachable in every prior run and that orphaned calls were impossible to model. Both sides of the grace window and an orphaned call are now asserted. Production is intentionally unchanged. |
| 3 | Authenticated Discord/KOL lifecycle | PARTIAL | `a0c8359` covers create, hydrate, edit, immutable versions, activate, pause, resume, safe archive, terminal archive, KOL duplication, Discord source uniqueness, position snapshot retention, owner denial and the owner-only journal. `37d5e19` fixes the archive guard, which read a ledger nothing writes and therefore never fired — proven by control run. Authenticated HTTP/browser, provider-failure, insufficient-balance and responsive evidence remain (E-6). |
| 4 | Discord ingestion and journal | PARTIAL | Static and unit coverage exists. Live application-command state and a controlled event-to-marketplace proof need E-2. |
| 5 | Durable losing-trade PnL | BLOCKED on I-1 | Root cause identified: not a missing computation, a missing writer. `app_private.position_lots` would yield average entry and exit prices and no code path populates it. `37d5e19` stops the card from blaming price providers for this limit and refuses to infer an exit price. Unblocking requires the I-1 ledger decision. |
| 6 | Principal withdrawals | PARTIAL | Local-validator transaction path passes. Authenticated browser states and signer/reconciliation failure cases remain. |
| 7 | Fee and reward reconciliation | PARTIAL | Integer allocation invariants pass at the data layer. Confirmed-leg eligibility and full reversal/state integration still need adversarial verification. |
| 8 | Worker readiness | PARTIAL | Durable execution paths exist. Provider credentials, worker host, signer, fee destination and alerting remain gated (E-3, E-4). Deploy order for E-1 is recorded. |
| 9 | Mizar-familiar UX review | PARTIAL | Builder and Discord marketplace evidence exists at 390/1024/1440. Authenticated primary surfaces and a full 768/1024/1440/390 pass remain (E-6). |
| 10 | Independent release review | PARTIAL | `npm run check` exits 0 with 174 tests and all five verifiers. Codex has not reviewed `0d40b15`, `10942cf` or `37d5e19`. |

## Method note

Priorities 1, 2 and 3 each surfaced defects that had previously passed verification. In all
three cases the cause was the same: fixtures were hand-written and had drifted from
production. Fixtures are now generated from `scripts/lib/production-schema.mjs`, and each
verifier asserts parity before and after the migration under test.

Three findings were each proven by a control run that fails without the fix, so none rests
on inspection alone:

- the pre-fix subscriber-config migration aborts on production column types,
- invoker-rights trigger functions are denied `app_private` as `service_role`,
- the previous archive guard permits archiving a bot with a live worker position.
