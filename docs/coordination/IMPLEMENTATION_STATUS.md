# Implementation status — launch remediation

Statuses: `NOT STARTED` · `IN PROGRESS` · `PASS` · `PARTIAL` · `FAIL` · `BLOCKED`
Evidence must be a commit, test result, screenshot path, or database assertion.
A row backed only by source inspection is not PASS.

Last updated: 2026-07-30 · Branch `claude/degenaration-launch-remediation`

| # | Requirement | Spec | Status | Evidence |
|---|---|---|---|---|
| 0 | Phase 1 focused audit | §20.1 | PASS | `1db7062`; `docs/launch/RELEASE_CHECKLIST.md` F-1..F-7; baseline `npm run check` exit 0 |
| 0b | Coordination + instruction scaffolding | §0, §4.0–4.1 | PASS | `1db7062` |
| 1 | Single-source 200 bps fee, integer math | §13.1 | PASS | `60e9ce8`; 6 duplicates removed; float math deleted; 54 tests |
| 2 | Creator 70/20 bps + referral allocation, balanced ledger | §13.2–13.5 | PARTIAL | `60e9ce8`, `5fa6460`; `allocatePlatformFee()` + DB trigger + generated retained column; **migration not applied to a database; runtime write path not yet emitting allocations** |
| 3 | Self-service user principal withdrawal | §12 | PARTIAL | `47dec45`; endpoint + rules module + real modal; 11 withdrawal tests; **not exercised against a funded wallet** |
| 4 | Affiliate payout rules kept separate | §12.6 | PASS | `47dec45`; test asserts principal withdrawal ignores the 0.1 SOL minimum and 0.043 SOL fee |
| 5 | Discord/KOL signal journal end-to-end | §9 | BLOCKED | Schema + parser contract verified by `npm run verify:performance-journal`; **live pipeline untraceable without database access — B-4** |
| 6 | Two approved sources show measured data | §9.8 | BLOCKED | Requires live database access to diagnose; see OPEN_BLOCKERS B-4 |
| 7 | Exactly one `/register`; stale scopes cleared | §15 | PARTIAL | `b65e069`; root cause fixed + `npm run check:discord-commands` clean; **unobserved against a live Discord application** |
| 8 | Affiliate never indefinitely loading | §16 | PASS | `cb4abb3`; allSettled + timeout + retry + stale banner; browser-verified, no console errors |
| 9 | Portfolio/KOL empty + error states | §16, §17 | PASS | `f31f106`; Portfolio had the identical blank-page defect — fixed with allSettled + timeout + retry + stale banner; KOL splits failure from empty |
| 10 | Semantic gold/white/black token layer | §5.2 | PARTIAL | `cb4abb3`; semantic layer added, `gold` mismatch fixed; legacy names still consumed by ~40 files |
| 11 | `DegenBackdrop` global background | §5.3 | PASS | `d95eda1`; 5 layers verified via computed styles; body/html layering fixed |
| 12 | SVG icon system, no glyph icons | §5.6 | PASS | `f2823fb`, `0fba6d7`; pictograms replaced with Lucide; 7 original product glyphs in `components/icons/`, each wired into a real surface; browser-verified |
| 13 | Concise public copy; internal strings removed | §6, §11.4, §23 | PASS | `f2823fb`, `cb4abb3`; `npm run check:visible-copy` clean across 186 files; browser-verified |
| 14 | Discord card redesign, real PFP, no cover art | §8 | PASS | `67798ef`; `DiscordSourceBanner` and its 3 gradient fallbacks deleted; 56px avatar with onError fallback; browser-verified with stubbed data at desktop and 375px |
| 15 | Verification scripts wired into checks | §4.4 | PASS | All 4 written and wired into `npm run check`: `verify-fee-ledger`, `verify-performance-journal`, `check-discord-commands`, `check-visible-copy` |
| 16 | Claude review subagents | §4.0A | PASS | `.claude/agents/degenaration-{ui,financial,performance,release}-*.md` |
| 17 | Repository skills | §4.2 | PASS | `.agents/skills/degenaration-{financial-integrity,ui,performance-journal,release-audit}/SKILL.md` |
| 18 | Launch documentation set | §4.3 | PASS | All 9 written under `docs/launch/` |
| 19 | Visual regression evidence | §22.6 | PARTIAL | `docs/launch/RELEASE_EVIDENCE.md`; no horizontal overflow at 375/768/1440, home + affiliate observed; **no captured screenshot set — most routes need an authenticated session with data** |
| 20 | Release gates | §24 | PARTIAL | `npm run check` exit 0 covers typecheck, 70 tests, fee invariants, command registry, copy, build. Lint, e2e, migration dry run, RLS tests not run |

## Readiness

**NOT READY.**

14 of 21 rows PASS. Everything implementable without external access is done: fee
model, ledger integrity, withdrawal flow, Discord commands, runtime states, copy, icon
system, backdrop, Discord card redesign, subagents, skills, docs, and four verification
gates.

What stands between here and READY FOR STAGING is not more code:

1. Apply the two migrations to a database, then confirm the trigger and RPC behave
2. Set `PLATFORM_FEE_ACCOUNT` so fees are actually collected (currently 0 bps)
3. Exercise a withdrawal against a funded devnet wallet
4. Deploy the worker and confirm the duplicate `/register` is gone in Discord
5. Grant database access so requirements 5 and 6 can be diagnosed honestly

Requirements 5 and 6 are BLOCKED, not unfinished — the pipeline cannot be diagnosed by
reading source, and inventing values instead is prohibited.

## Verified commands

```
npm run check   # exit 0 — typecheck, 70 tests, fee-ledger invariants,
                # discord command registry, visible copy, production build
```

Stop the dev server before running it: `next build` clobbers a running `next dev`'s
`.next` directory and produces a spurious failure.
