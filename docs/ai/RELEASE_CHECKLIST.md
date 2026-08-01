# Release checklist

Updated: 2026-08-01

| Gate | Status | Evidence / remainder |
| --- | --- | --- |
| Preserve checkpoint commits | PASS | `3dce6b8`, `18f4f23`, `7c83d48`, and `be55ced` remain in history. |
| Reference media inventory | PASS | `MIZAR_REFERENCE_INVENTORY.md` accounts for all 49 files. |
| Generated/reference-file hygiene | PASS | `.references/` and `tsconfig.tsbuildinfo` are ignored; reference media and environment files are not staged. |
| Marketplace migration local apply/rerun | PASS | `npm run verify:marketplace-migration`. |
| Marketplace production apply/live query | BLOCKED | Requires confirmed deployment target or authorization; see E-1. |
| Strict typecheck/lint/unit/integration suite | PENDING | Rerun after each financial vertical slice and once at final gate. |
| Authenticated browser lifecycle | PENDING | Secure test session and browser fixtures still required. |
| Subscriber configuration integrity | PENDING | Audit/migration/tests not yet complete. |
| Discord end-to-end ingestion | BLOCKED | Controlled application credentials/guild required for live proof; fixtures remain internally testable. |
| Losing PnL integrity | PENDING | Durable sell-leg/exit-price linkage not yet complete. |
| Withdrawal browser/reconciliation | PENDING | Local validator exists; authenticated/failure-state coverage remains. |
| Fee/reward invariants | PENDING | Full confirmed-leg and reversal audit remains. |
| Worker readiness | PENDING | Architecture and gate review remains; activation stays closed. |
| Responsive/accessibility evidence | PENDING | Full 390/768/1024/1440 primary-surface pass remains. |
| Security/dependency/secret scan | PENDING | Run after implementation and resolve BLOCKER/HIGH findings. |
| Production deploy or push | NOT AUTHORIZED | Do not push or deploy in this task. |

