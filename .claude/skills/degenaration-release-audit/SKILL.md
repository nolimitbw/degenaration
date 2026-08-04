---
name: degenaration-release-audit
description: Rules for validating DegenAration release readiness — the suite, migrations, RLS, secrets, evidence, rollback, and honest reporting of what is not proven. Use after a milestone and before any completion claim or production action.
---

# Release audit

The review checklist and its severity rules live in
`.agents/skills/degenaration-release-audit/SKILL.md`. This file covers what to run and what
must not be claimed.

## The gate

```bash
npm run check               # typecheck, lint, tests, every verifier, production build
npm run verify:bridge-live  # deployed edge function: every operation 401, never 400
```

`npm run check` failing for any reason ends the audit. Stop the dev server first — `next build`
clobbers a running `next dev`'s `.next` directory and produces a spurious failure.

## Migrations

`docs/ai/PENDING_DEPLOYMENT.md` is the authority on what is unapplied and in what order.
Several files replace the same function in sequence, so applying them out of order installs an
earlier version **silently** — no error, just a settlement that stops doing part of its job.
Every file needs a rollback in its header and must be additive: nullable columns, widened
rather than narrowed CHECKs, functions replaced with supersets.

## What must be true before any completion claim

- No unresolved BLOCKER or HIGH finding.
- Migrations, RLS and authorization verified — including the denial cases, not only the grants.
- Financial invariants proven by a verifier that can fail.
- Secret scan clean: no `.env`, key, token or credential in the diff, the logs or the docs.
- Browser evidence at 390, 768, 1024 and 1440 with no horizontal overflow and no console error.
- Rollback documented for every production action.

## Honest reporting

State the exact missing dependency and blocker ID for every PARTIAL and BLOCKED item. A
requirement whose remainder is a credential, a host or a signed-in session is blocked — say
so, and do not write code that pretends to satisfy it.

**Never** report complete, fully functional, production-ready, mainnet-ready or bug-free
without reproducible evidence for each claim. A passing build is not a passing release, and a
chat claim is not evidence — a commit, a test result, a screenshot or a database assertion is.
