# DegenAration assistant instructions

Read these files before modifying product behavior:

- @docs/ai/FINAL_EXECUTION_HANDOFF.md — start here: state, status, exact next dependency
- @docs/ai/DEGENARATION_FINAL_FULLSCAN_FINANCE_ADMIN_MIZAR_UI_CLAUDE_PROMPT.md — the
  authoritative final execution instruction
- @docs/DEGENARATION_MASTER_SPEC.md
- @docs/launch/FINAL_LAUNCH_SPEC.md
- @docs/ai/IMPLEMENTATION_STATUS.md
- @docs/ai/ACCOUNTING_MODEL.md — one authoritative balance model
- @docs/ai/MIZAR_PARITY_MATRIX.md — row-level UI parity status
- @docs/ai/OPEN_BLOCKERS.md — what needs a credential, a host, or a decision
- @docs/ai/PENDING_DEPLOYMENT.md — unapplied migrations, in mandatory apply order
- @docs/coordination/IMPLEMENTATION_STATUS.md
- @docs/coordination/AI_HANDOFF.md
- @docs/coordination/CODEX_PLANS.md

Project commands live in `.claude/commands/`: `/degenaration-goal` continues from the first
failing dependency, `/fullscan`, `/finance-gate`, `/mizar-ui`, `/admin-console`,
`/release-audit`. Focused rules live in `.claude/skills/`.

**See what Codex planned before planning anything yourself:** `npm run codex:plans` reads
Codex's own `update_plan` calls out of its session logs. The `codex-plans` skill explains
when to run it. A plan step is Codex's intent, not proof the work exists — verify against
IMPLEMENTATION_STATUS.md.

Mandatory rules:

- Preserve working functionality and make targeted, reversible changes.
- Codex is the primary coder, product designer, implementation owner, and release coordinator.
- Claude Code is an optional assistant or independent reviewer only when the owner explicitly assigns it work.
- Never let two agents edit the same working tree concurrently.
- Normal-user navigation is Bots, Affiliate, and Portfolio only.
- Use the existing DegenAration logo and the approved black, gold, and white design system.
- No emoji icons, generic geometric Discord covers, fake production data, placeholder controls, or long engineering explanations in the primary UI.
- User principal withdrawals are self-service and server-authorized; routine admin approval is prohibited.
- Platform execution fee is 200 basis points per confirmed swap leg. Use integer arithmetic and immutable ledgers.
- Discord and KOL performance comes from durable signal and execution journals.
- Every Discord application command must be unique, purposeful, permissioned, documented, and tested.
- Never execute mainnet transactions in automated tests.
- Never weaken authentication, RLS, lint, typecheck, tests, idempotency, reconciliation, or financial invariants.
- Run targeted checks while editing and the complete release suite (`npm run check`) before completion.
- Do not report completion without code, test, browser, data, and screenshot evidence.
- Update the coordination files after every verified vertical slice.

Codex-owned implementation branches use the `codex/` prefix. An assistant must use a
separate worktree and branch and must not alter Codex's active working tree.
