# AI handoff

Single place to learn the current state before either agent starts work.

- **Branch:** `claude/degenaration-launch-remediation` (branched from `master` @ `2f03090`)
- **Last verified commit:** see `git log -1` on the branch
- **Active agent:** Claude Code (primary implementer)
- **Codex status:** unavailable — usage limit, resets 2026-08-05. Recorded per §26A as
  `Codex review unavailable due to usage limit`. Implementation continues without waiting.
- **Active work area:** Phase 1 complete. Phase 2 (financial correctness) is next.
- **Migrations run:** none yet.
- **Commands run:** `npm run check` — passed at baseline (typecheck + 41 server tests +
  production build, exit 0) before any edits.

## Exact next action

Phase 2, slice 1 — centralize the platform fee:

1. Create a single fee module exporting `PLATFORM_FEE_BPS = 200`,
   `DISCORD_CREATOR_BPS = 70`, `KOL_CREATOR_BPS = 20`,
   `REFERRAL_SHARE_BPS_OF_PLATFORM_FEE = 1000`, with integer lamport/bps helpers and
   defined rounding.
2. Replace the four duplicate declarations and one bare literal listed in
   `docs/launch/RELEASE_CHECKLIST.md` F-1.
3. Remove the floating-point fee computation at `app/api/simulate/route.ts:34`.
4. Add deterministic fee vectors per §22.1 and wire `scripts/verify-fee-ledger.mjs`.
5. Run `npm run check`, commit the slice, update `IMPLEMENTATION_STATUS.md`.

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
