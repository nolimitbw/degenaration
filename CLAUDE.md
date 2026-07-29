# DegenAration Claude Code instructions

Read these files before modifying product behavior:

- @docs/launch/FINAL_LAUNCH_SPEC.md
- @docs/coordination/IMPLEMENTATION_STATUS.md
- @docs/coordination/AI_HANDOFF.md

Mandatory rules:

- Preserve working functionality and make targeted, reversible changes.
- Claude Code is the primary implementer; Codex is an independent reviewer of committed checkpoints.
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

Working branch for the launch remediation: `claude/degenaration-launch-remediation`.
