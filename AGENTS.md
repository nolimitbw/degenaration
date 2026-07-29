# DegenAration repository instructions

Read `docs/launch/FINAL_LAUNCH_SPEC.md` before modifying product behavior.

Two agents share this repository: Claude Code (primary implementer) and Codex
(independent reviewer of committed checkpoints). Never edit the same working tree
concurrently. Codex findings go in `docs/coordination/CODEX_REVIEW.md`.

Mandatory rules:

- Preserve working functionality; make targeted, reversible changes.
- Normal-user navigation is Bots, Affiliate, and Portfolio only.
- Public UI must use the DegenAration logo and the approved black, gold, and white design system.
- No emoji icons, generic geometric Discord covers, fake production data, placeholder controls, or long engineering copy in the primary UI.
- User principal withdrawals must be self-service and server-authorized; routine admin approval is not allowed.
- Platform execution fee is 200 bps per confirmed swap leg. Use integer arithmetic and immutable ledgers.
- Discord/KOL performance must come from durable signal and execution journals.
- Every Discord application command must be unique and purposeful.
- Run targeted tests while editing and the complete release suite (`npm run check`) before completion.
- Never execute mainnet transactions in automated tests.
- Never weaken auth, RLS, lint, typecheck, tests, idempotency, or reconciliation.
- Do not report a requirement as complete without code, test, browser, and data evidence.
