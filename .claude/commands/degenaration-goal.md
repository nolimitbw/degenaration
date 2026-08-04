---
description: Continue DegenAration from the first failing dependency, implementing rather than planning
---

Continue the DegenAration build. `/goal` is reserved by the harness, so this is the project's
own entry point.

1. Read `docs/ai/FINAL_EXECUTION_HANDOFF.md` and `docs/ai/IMPLEMENTATION_STATUS.md`. They name
   the current state and the exact next dependency. Do not re-derive it by scanning.
2. Read `docs/ai/OPEN_BLOCKERS.md`. Anything listed there needs a credential, a host, or a
   decision — skip it and do not attempt a workaround that fakes the dependency.
3. Take the first requirement that is `PARTIAL` or `FAIL` for a reason that is *not* an open
   blocker, and implement the root cause fix.
4. Prove it against real PostgreSQL with a verifier in `scripts/`, wired into `npm run check`.
   A verifier that passes on first write is suspect: run a control that breaks the fix and
   confirm the assertion fails.
5. Run `npm run check`. Commit the milestone on its own.
6. Update the status documents, then continue to the next dependency.

Rules:

- Do not present a menu of options or stop after planning.
- Do not restart completed work or rescan unchanged areas.
- Do not weaken a test, a check, or an authorization rule to get a green result.
- Stop only at an external blocker or an irreversible production action, and when you stop at
  a production action, present the approval package from `docs/ai/PENDING_DEPLOYMENT.md`.
