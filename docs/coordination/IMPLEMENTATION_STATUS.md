# Implementation status — launch remediation

Statuses: `NOT STARTED` · `IN PROGRESS` · `PASS` · `PARTIAL` · `FAIL` · `BLOCKED`
Evidence must be a commit, test result, screenshot path, or database assertion.

Last updated: 2026-07-30 · Branch `claude/degenaration-launch-remediation`

| # | Requirement | Spec | Status | Evidence |
|---|---|---|---|---|
| 0 | Phase 1 focused audit | §20.1 | PASS | `docs/launch/RELEASE_CHECKLIST.md`; baseline `npm run check` exit 0 |
| 0b | Coordination + instruction scaffolding | §0, §4.0–4.1 | PASS | `CLAUDE.md`, `AGENTS.md`, `docs/coordination/*`, `docs/launch/FINAL_LAUNCH_SPEC.md` |
| 1 | Single-source 200 bps fee, integer math | §13.1 | PASS | `lib/fee-model.js`; 6 duplicates removed; `npm run check` exit 0; 54 tests pass |
| 2 | Creator 70/20 bps + referral allocation, balanced ledger | §13.2–13.5 | PARTIAL | `allocatePlatformFee()` + `npm run verify:fee-ledger` all invariants hold; **not yet persisted to ledger tables** |
| 3 | Self-service user principal withdrawal | §12 | NOT STARTED | F-3 |
| 4 | Affiliate payout rules kept separate | §12.6 | NOT STARTED | — |
| 5 | Discord/KOL signal journal end-to-end | §9 | NOT STARTED | — |
| 6 | Two approved sources show measured data | §9.8 | NOT STARTED | — |
| 7 | Exactly one `/register`; stale scopes cleared | §15 | NOT STARTED | F-4 |
| 8 | Affiliate never indefinitely loading | §16 | NOT STARTED | — |
| 9 | Portfolio/KOL empty + error states | §16, §17 | NOT STARTED | — |
| 10 | Semantic gold/white/black token layer | §5.2 | NOT STARTED | F-6 |
| 11 | `DegenBackdrop` global background | §5.3 | NOT STARTED | — |
| 12 | SVG icon system, no Unicode glyph icons | §5.6 | NOT STARTED | F-7 |
| 13 | Concise public copy; internal strings removed | §6, §11.4, §23 | NOT STARTED | F-5 |
| 14 | Discord card redesign, real PFP, no cover art | §8 | NOT STARTED | — |
| 15 | Verification scripts wired into checks | §4.4 | PARTIAL | `scripts/verify-fee-ledger.mjs` written and wired into `npm run check`; 3 scripts pending |
| 16 | Claude review subagents | §4.0A | NOT STARTED | — |
| 17 | Repository skills | §4.2 | NOT STARTED | — |
| 18 | Launch documentation set | §4.3 | PARTIAL | `FINAL_LAUNCH_SPEC.md`, `RELEASE_CHECKLIST.md` written; 7 docs pending |
| 19 | Visual regression evidence | §22.6 | NOT STARTED | — |
| 20 | Release gates | §24 | NOT STARTED | — |

Readiness: **NOT READY** — audit complete, implementation not started.
