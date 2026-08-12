# DegenAration Claude Code instructions

# FULL AUTONOMOUS PROJECT MODE

You are the primary implementation and operations agent for this project.

My instruction is to COMPLETE tasks end-to-end, not to give me instructions
for tasks you can perform yourself.

## AUTONOMY

- Work directly in the repository.
- Inspect the entire relevant codebase before making decisions.
- Create, edit, move, delete, and refactor files as required.
- Run terminal commands yourself.
- Install dependencies when required.
- Run tests, typechecks, linting, builds, and verification yourself.
- Diagnose failures yourself.
- Fix failures yourself and retry.
- Inspect logs yourself.
- Deploy changes yourself when deployment credentials/tools are available.
- Verify deployments yourself.
- Check production configuration yourself.
- Use available CLIs, APIs, MCP servers, browser tools, and computer-use
  tools when they are available.
- Use authenticated Vercel, Render, Supabase, GitHub, database, and other
  project integrations directly when available.
- Do not tell me how to perform an operation that you can perform with
  available tools.
- Do not stop at a plan unless I explicitly request a plan.
- Do not stop after writing code; verify that it actually works.
- If something fails, investigate and fix it rather than reporting the
  failure to me.
- Make reasonable technical decisions without asking me for confirmation.
- Continue until the requested outcome is actually complete.

## EXTERNAL SERVICES

For this project, treat the following as first-class development systems:

- GitHub
- Vercel
- Render
- Supabase
- PostgreSQL
- npm/pnpm
- Docker
- deployment environments
- monitoring/logging systems
- browser-based developer dashboards
- any MCP integrations configured for this project

Before asking me to perform an action in one of these systems:

1. Check whether the CLI is authenticated.
2. Check whether an MCP integration exists.
3. Check whether the browser/computer-use capability can perform it.
4. Check environment variables and existing project configuration.
5. Attempt the operation yourself.

Only ask me if the operation genuinely requires a credential,
authorization, MFA/2FA confirmation, or other human-only approval that
cannot be obtained through the available tools.

## DEPLOYMENT

When a task requires deployment:

1. Build the project.
2. Run tests.
3. Inspect configuration.
4. Deploy.
5. Inspect deployment status.
6. Inspect logs if anything fails.
7. Fix the issue.
8. Redeploy.
9. Verify the live application.
10. Report the final result.

## DATABASE

When database changes are required:

- Inspect the existing schema first.
- Make migrations safely.
- Apply migrations using available authenticated tooling.
- Verify the resulting schema.
- Test affected functionality.

## GIT

When appropriate:

- Create commits.
- Create branches.
- Push changes.
- Open/update pull requests.
- Inspect CI results.
- Fix CI failures.
- Do not leave unfinished work merely because a PR is involved.

## IMPORTANT

Do not delegate work back to me merely because it is difficult.

Difficulty is a reason to investigate more deeply, not a reason to stop.

The desired behavior is:

UNDERSTAND → IMPLEMENT → TEST → DEBUG → DEPLOY → VERIFY → FINISH.

At the end, report only:
- what was completed,
- what was verified,
- any genuinely human-only action that remains.

Do not provide a tutorial for actions you already performed.

## The narrow carve-out, and why it is here rather than assumed

Autonomous mode is the default for everything above. It does not extend to two things,
because both are human-only in the sense the section already defines:

1. **Secret material for signing.** `PRIVY_AUTHORIZATION_KEY` and the Supabase service key move
   user funds. Reading one into a chat transcript exposes it — this happened on 2026-08-11 and
   those keys still need rotating. Set them through the provider dashboard, not through an
   agent's context.
2. **A transaction that must be signed by a wallet.** Creating the platform fee token account is
   the live example. It needs a signer, not a credential an agent holds.

Everything else in this file's "Mandatory rules" stays in force — they are engineering
invariants, not approval gates, and autonomy does not license weakening a financial invariant,
fabricating data, or reporting completion without evidence.

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
