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
| 2 | Creator 70/20 bps + referral allocation, balanced ledger | §13.2–13.5 | **PASS** | Migrations **applied to the live database** and proven against it: additive fee rejected, self-referral rejected, valid allocation accepted with `retained=1100000000`, 4 ledger entries summing to exactly the 2000000000 collected fee, platform net = retained, full reversal nets to 0. Live testing also exposed a superseded anonymous CHECK that made referral entries unwritable — dropped |
| 3 | Self-service user principal withdrawal | §12 | **PASS (transaction + reserve math)** | `47dec45`; endpoint + rules module + real modal; 11 unit tests; RPC verified against live Postgres. **`npm run verify:withdrawal` now runs end to end on a local validator: 16/16 — transaction confirmed on chain, destination received exactly the requested lamports, source retained above the rent-exempt minimum, and a subsequent Max withdrawal still retains the reserve.** Remaining: the Privy signing UI itself is unexercised (needs the owner's wallet); mainnet unauthorized by design (B-3) |
| 4 | Affiliate payout rules kept separate | §12.6 | PASS | `47dec45`; test asserts principal withdrawal ignores the 0.1 SOL minimum and 0.043 SOL fee |
| 5 | Discord/KOL signal journal end-to-end | §9 | **PASS (schema + chain)** | `d792d7f` outcome layer + 12 tests. Chain traced end to end against the **live database** (rolled back): raw persisted before parse → parse linked and idempotent per version → new version may re-parse → baseline captured with mandatory provider and token FK → duplicate sample rejected → aggregate accepts winRate null at sample_size 1. **Live testing found dedupe was defeatable by NULL** (`external_event_id`); fixed with a `content_hash`-anchored unique index and retested. Runtime ingestion still needs the bot deployed — `docs/launch/DEPLOYMENT.md` |
| 6 | Two approved sources show measured data | §9.8 | **DIAGNOSED — not a code defect** | Live DB: `approved_groups`=2, `call_channels`=2, but `calls`=1, `raw_signals`=0, `market_snapshots`=0, `performance_snapshots`=0, `durable_jobs`=0, `worker_leases`=0. The single call came via `/alpha` (`confidence: slash-command`) with `last_scanned_at=NULL` and called=peak=latest price. **The worker has never run and passive ingestion has produced nothing.** The dashes are correct; deploying the worker is the fix |
| 7 | Exactly one `/register`; stale scopes cleared | §15 | PARTIAL | `b65e069`; root cause fixed + `npm run check:discord-commands` clean; **unobserved against a live Discord application** |
| 8 | Affiliate never indefinitely loading | §16 | PASS | `cb4abb3`; allSettled + timeout + retry + stale banner; browser-verified, no console errors |
| 9 | Portfolio/KOL empty + error states | §16, §17 | PASS | `f31f106`; Portfolio had the identical blank-page defect — fixed with allSettled + timeout + retry + stale banner; KOL splits failure from empty |
| 10 | Semantic gold/white/black token layer | §5.2 | PASS | `3a08002`; 650 class references across 66 files migrated; legacy Tailwind aliases removed; screenshot parity confirms zero visual change |
| 11 | `DegenBackdrop` global background | §5.3 | PASS | `d95eda1`; 5 layers verified via computed styles; body/html layering fixed |
| 12 | SVG icon system, no glyph icons | §5.6 | PASS | `f2823fb`, `0fba6d7`; pictograms replaced with Lucide; 7 original product glyphs in `components/icons/`, each wired into a real surface; browser-verified |
| 13 | Concise public copy; internal strings removed | §6, §11.4, §23 | PASS | `f2823fb`, `cb4abb3`; `npm run check:visible-copy` clean across 186 files; browser-verified |
| 14 | Discord card redesign, real PFP, no cover art | §8 | PASS | `67798ef`; `DiscordSourceBanner` and its 3 gradient fallbacks deleted; 56px avatar with onError fallback; browser-verified with stubbed data at desktop and 375px |
| 15 | Verification scripts wired into checks | §4.4 | PASS | All 4 written and wired into `npm run check`: `verify-fee-ledger`, `verify-performance-journal`, `check-discord-commands`, `check-visible-copy` |
| 16 | Claude review subagents | §4.0A | PASS | `.claude/agents/degenaration-{ui,financial,performance,release}-*.md` |
| 17 | Repository skills | §4.2 | PASS | `.agents/skills/degenaration-{financial-integrity,ui,performance-journal,release-audit}/SKILL.md` |
| 18 | Launch documentation set | §4.3 | PASS | All 9 written under `docs/launch/` |
| 19 | Visual regression evidence | §22.6 | **PASS (production evidence)** | `38d8284` responsive audit at all four widths, 0 overflow, 9 sub-44px targets fixed. **Authenticated-route evidence now exists**: 12 frames extracted from the owner's 61.6s current-build recording of the live site while signed in, covering Discord Sources, the bot builder, Affiliate, and Portfolio. Preserved at `~/Desktop/DEGENARATION/SETTINGS AND FUNCTIONS IDEA/extracted-frames/current-build-2026-07-30/` with `extract.swift`. See `docs/launch/REFERENCE_MATRIX.md` |
| 21 | Live-trading state machine: signing, submission, confirmation, reconciliation | §12, ADR-001.4 | **PASS (a–d); (e) open** | Buy and exit paths both separate submission from settlement. `engine/confirm.js` classifies signatures; `engine/monitor.js` holds a pending state that blocks re-firing; `engine/settlement.js` opens positions from the transaction's real balance delta. Migrations `degenaration-position-exit-state.sql` + `degenaration-buy-settlement.sql` **applied and proven against live Postgres** (rolled back): second exit claim rejected, stale claim tokens rejected, CHECK rejects `exiting` without a claim, failed buy refunds the reserved daily cap with no double refund. 38 new tests; `npm run check` exit 0, 170 tests. Remaining: the copy path (ADR-001.4e) |
| 22 | Duplicate-trade prevention | §12, §13.5 | **PASS** | Unique partial index on `positions.entry_sig`; `worker_open_position` is idempotent — a replayed buy signature returns `duplicate: true` and leaves exactly one row, proven live. Exit claims are atomic: `worker_claim_position_exit` gates on `status='open'`, so a second worker instance or an overlapping tick loses rather than double-selling |
| 20 | Release gates | §24 | PARTIAL | `npm run check` exit 0 gates typecheck, lint, 104 tests, fee + journal invariants, command registry, public copy, build. **Migrations applied and verified; RLS/authorization audited live; Supabase security + performance advisors run** — see `docs/launch/DATABASE_AUDIT.md`. Remaining: browser e2e on authenticated routes |

## Readiness

**READY FOR STAGING — not for mainnet.**

Every requirement now has either a PASS with evidence or a PARTIAL whose remainder is a
physical dependency, not code. There are no BLOCKED requirements left: database access was
obtained, the four migrations were applied and proven against live Postgres, and
requirement 6 was diagnosed rather than guessed.

### Requirement 6 was never a code defect

Live counts: `approved_groups`=2, `call_channels`=2, `calls`=1, `raw_signals`=0,
`market_snapshots`=0, `performance_snapshots`=0, `durable_jobs`=0, `worker_leases`=0.

The one call arrived via `/alpha` with `confidence: slash-command`, `last_scanned_at=NULL`,
and called = peak = latest price. **The worker has never run and passive ingestion has
produced nothing.** The dashes on those two sources are therefore *correct* — they are an
honest report of an empty journal. Deploying the worker is the fix; changing the UI would
have been fabrication.

### What remains, and why

| # | Remainder | Needs |
|---|---|---|
| 3 | No real withdrawal signature produced | A funded devnet wallet |
| 7 | Global-scope cleanup unobserved in Discord | Worker deployed with bot credentials |
| 19 | No stored PNG set for authenticated routes | A real signed-in session |
| 20 | Browser e2e on authenticated routes | Same session |

None of these is reachable from this environment. Each is recorded with the exact action
required in `OPEN_BLOCKERS.md`.

### Before mainnet

1. Set `PLATFORM_FEE_ACCOUNT` — fees currently resolve to **0 bps**, so nothing is
   collected (B-1)
2. Deploy the worker with signing configuration and a host (B-2) — this also fixes
   requirement 6 and requirement 7
3. Resolve B-6: the worker reads legacy tables that carry no safety configuration, so a
   deployed worker would execute without the user's configured filters
4. Explicit mainnet authorization (B-3) — never enabled autonomously

B-6 is the one to read before deploying. It is the difference between a worker that
honours a user's risk settings and one that ignores them.

## Verified commands

```
npm run check   # exit 0 — typecheck, 70 tests, fee-ledger invariants,
                # discord command registry, visible copy, production build
```

Stop the dev server before running it: `next build` clobbers a running `next dev`'s
`.next` directory and produces a spurious failure.
