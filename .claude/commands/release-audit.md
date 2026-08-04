---
description: Audit DegenAration release readiness — migrations, RLS, invariants, evidence, rollback
---

Audit release readiness. Assume nothing is proven until you have seen the evidence yourself;
a passing build is not a passing release.

```bash
npm run check              # typecheck, lint, tests, every verifier, production build
npm run verify:bridge-live # deployed edge function: every operation 401, never 400
git log --oneline -30
```

Then check each of these and record the result with its evidence path:

- **Migrations** — every file in `docs/ai/PENDING_DEPLOYMENT.md` is forward-safe, has a
  rollback in its header, and is applied in the recorded order. Four of them replace the same
  function in sequence; out of order silently installs an earlier version.
- **RLS and authorization** — `app_private` closed to `anon` and `authenticated`; every
  privileged RPC re-checks the actor; cross-user reads denied.
- **Financial invariants** — the ledger balances; no floating-point money; no fee without a
  confirmed fill; no duplicate trade, fee, reward or withdrawal.
- **Secrets** — nothing in the diff, the logs, or the docs. No `.env`, no key, no token.
- **Dependencies** — no unresolved release-blocking advisory.
- **Browser and responsive** — evidence at 390, 768, 1024, 1440 for each primary surface, with
  no horizontal overflow and no console error.
- **Truthfulness** — no permanent spinner, no fabricated figure, no unknown rendered as zero,
  no decorative control, no public activation-lock copy.
- **Rollback** — documented for every production action, including the edge function.

Report honestly. State the exact missing dependency for every PARTIAL and BLOCKED item, and
name the blocker ID. Never report complete, production-ready, mainnet-ready or bug-free
without reproducible evidence for each claim.

A finding that only one person could reproduce is not a finding — write the reproduction down.
