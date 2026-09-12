# Scorecard — DegenAration workspace, 2026-08-11

Surface audited: `/bots`, `/bots/discord`, `/bots/discord/new`, `/affiliate`, `/portfolio`
Primary user: a memecoin trader who wants a Discord caller's trades copied into their own wallet.
Primary task: **pick a source, set how much it may spend, and have it trade.**

Evidence is first-hand from this session: browser captures at 390/768/1024/1440, live production
API responses, direct Solana mainnet reads, and the production database.

---

**1. Innovative — 2/3**
Evidence: peak-vs-current pairing shipped on both the marketplace card and the overview table
(`app/bots/discord/page.tsx`, `app/bots/page.tsx`), asserted by `verify:responsive`.
Justification: refreshes a category pattern with a real improvement — most copy-trade
marketplaces publish only the best-case multiple — but the surrounding product imitates the
standard trading dashboard, so not a 3.

**2. Useful — 1/3**
Evidence: `components/product/BotBuilder.tsx` is 1,783 lines carrying ~60 controls; the task
"copy this server" crosses 10 sections before it can be saved.
Justification: the task completes, but through detours a beginner does not need.

**3. Aesthetic — 1/3**
Evidence: **18 distinct type sizes** in use, across two parallel scales — Tailwind names
(`text-xs` ×300, `text-sm` ×227, `text-base`, `lg`, `xl`, `2xl`, `3xl`) *and* pixel literals
(`text-[12px]` ×194, `[11px]` ×95, `[13px]`, `[14px]`, `[15px]`, `[17px]`, `[22px]`, `[25px]`,
`[10px]` ×22, `[9px]` ×7, **`[8px]` ×2**). Plus 20+ hardcoded hex values in components despite a
token layer.
Justification: a system is visible but two competing scales and orphan colors are well past five
inconsistencies. **This session's redesign added the second scale rather than replacing the first.**

**4. Understandable — 1/3**
Evidence: shipped labels include `Retracted`, `Watching`, `Signals`, `Hit rate peak / now`,
`Median peak / now`, `Down 50%+`.
Justification: the primary path is clear; the metrics that decide which source to trust are jargon.

**5. Unobtrusive — 2/3**
Evidence: hairline rules replaced panel borders; gold reduced to one action per screen
(`app/globals.css`, `components/AppShell.tsx`).
Justification: chrome is quiet but still present — the header, rail, tab row and banner all
precede content.

**6. Honest — 0/3  ← load-bearing failure**
Evidence, all live:
- UI states **`Platform fee 2.00%`** (`/api/platform/config` → `feeLabel: "2.00%"`), while a live
  quote returns **`platformFeeBps: 0, feeAccountSet: false`**.
- Marketplace lists both sources as **Approved / Connected** with performance columns, while
  **1,780 of 1,781 calls have no price** and `performance_snapshots` = 0.
- The builder lets a user configure, review and **save a bot that cannot trade**:
  `mainnet_execution_enabled = false`, `worker_leases` = 0, worker host returns 404. The only
  warning is a **dismissible one-line banner**.
Justification: a funded user can complete the whole flow and reasonably conclude their bot is
trading. Nothing on the builder or portfolio says otherwise once the banner is dismissed. Score 0
is the anchor for a deceptive flow regardless of intent.

**7. Long-lasting — 2/3**
Evidence: `backdrop-blur-xl` on the header, `.glass` in `globals.css`.
Justification: one dated marker (glassmorphism); the type and rule system will not read as 2026.

**8. Thorough — 2/3**
Evidence: empty/loading/error/disabled/focus all present (`EmptyState` ×47, `LoadingRows` ×13,
global `:focus-visible`). But this session shipped 36px tap targets, a 768px overflow, and two
surviving `text-[8px]` captions — all caught only by the gate.
Justification: states are covered; edges are not.

**9. Environmentally friendly — 1/3**
Evidence: `/bots` First Load JS **608 kB** (build output); `prefers-reduced-motion` honored,
dark mode honored, motion gated to loading.
Justification: 500 kB–2 MB band.

**10. As little design as possible — 1/3**
Evidence: 6-tile rail where 2 tiles are permanently empty signed-out; `My Bots` exists as a tab
and as a nav item; the builder's 60 controls for a copy task.
Justification: 3–5 removable elements on the audited surface.

---

## Total: **13 / 30**
