# AI handoff

Single place to learn the current state before either agent starts work.

- **Branch:** `claude/degenaration-launch-remediation` (branched from `master` @ `2f03090`)
- **Last verified commit:** see `git log -1` on the branch
- **Active agent:** Claude Code (primary implementer)
- **Codex status:** unavailable — usage limit, resets 2026-08-05. Recorded per §26A as
  `Codex review unavailable due to usage limit`. Implementation continues without waiting.
- **Active work area:** Phase 2 slice 1 (fee centralization) complete. Slice 2 is next.
- **Migrations run:** none yet.
- **Commands run:** `npm run check` — exit 0 at baseline *and* after slice 1
  (typecheck + 54 server tests + fee-ledger invariants + production build).

## Decision log

**Worker cannot import `lib/`.** `render.yaml` deploys the worker with `rootDir: server`,
so `server/engine/jupiter.js` has no access to `lib/fee-model.js` at runtime. The rate is
mirrored there deliberately and guarded by the test "worker fee rate never drifts from the
canonical fee model", which fails the suite if the two values ever disagree. Do not
"fix" this by adding a cross-directory import — it would break the deployed worker.

## Exact next action

Phase 2, slice 2 — persist the allocation to the ledger:

1. Find the existing commission/ledger write path
   (`supabase/degenaration-authoritative-commission-accrual.sql`,
   `lib/recordTrade.ts`) and inspect the current accrual columns.
2. Add a forward-safe migration for the fee-config snapshot, creator allocation, and
   referral allocation per §13.5 / §21, preserving existing data.
3. Write allocations through `allocatePlatformFee()` with an idempotency key per
   execution leg; store the bps snapshot alongside every entry.
4. Extend `scripts/verify-fee-ledger.mjs` to assert persisted debits equal credits.
5. Run `npm run check`, commit, update `IMPLEMENTATION_STATUS.md`.

Then slice 3: self-service user withdrawal (F-3), which is the other release blocker.

## Ownership notes (check before editing these areas)

| Area | Owner | State |
|---|---|---|
| `app/api/{quote,swap,simulate,platform}/**` | Claude | pending Phase 2 |
| `components/product/PortfolioDashboard.tsx` | Claude | pending Phase 2 (withdrawal) |
| `server/bot/index.js` | Claude | pending Phase 4 |
| Design tokens / `tailwind.config.ts` | Claude | pending Phase 6 |

## Uncommitted working-tree state inherited from `master`

Left deliberately untouched — not created by this remediation:

- `docs/activity-log.md` (modified; excluded from commits by policy)
- `public/video/launch-source.mp4` (deleted by a prior session; **not** committed —
  awaiting owner confirmation)
- `tsconfig.tsbuildinfo` (build cache noise)
