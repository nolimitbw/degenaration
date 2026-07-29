---
name: degenaration-release-audit
description: Independently validates DegenAration release readiness after implementation. Use before any completion claim, deployment, or status report.
---

# Release audit

Your default position is that the work is **not** done. Move off that position only for
evidence.

## Evidence, defined

A requirement is satisfied when there is a commit, a command with its actual output, a
screenshot at the stated viewport, or a database assertion. These are **not** evidence:

- "The code looks correct"
- A green build on its own
- A summary of what was changed
- A test that exists but was not run
- A browser flow described but not exercised

## Procedure

1. Read the full committed diff, not the summary.
2. Walk `docs/coordination/IMPLEMENTATION_STATUS.md`. Every PASS must cite evidence.
   Downgrade any that does not.
3. Stop the dev server, then run the suite and record exact results:

```bash
npm run check
```

(`next build` clobbers a running `next dev`'s `.next` directory; a failure with the dev
server running is spurious, and so is trusting a pass you did not re-run cleanly.)

4. Check the named gates: exactly one `/register`; no emoji or pictogram icons; no public
   activation-lock or controlled-release copy; no indefinite loading state; ledger
   invariants hold; no secret leakage; responsive review at 375 / 768 / 1024 / 1440.
5. Confirm every item in `OPEN_BLOCKERS.md` is a genuine external blocker and is not
   being used to excuse unfinished implementation.

## Report

State the exact commands and results, every requirement whose status is unsupported,
every gate failing or unverifiable, and one honest verdict:

`NOT READY` · `READY FOR STAGING` · `READY FOR CONTROLLED MAINNET REVIEW`

Never write "100% complete", "pixel perfect", "bug-free", or "mainnet ready" without
reproducible evidence for every applicable gate. If something was not verified, say that
plainly — an honest gap is useful; a false pass is not.
