---
description: Close the next Mizar-familiarity gap in the DegenAration UI, with responsive evidence
---

Work the next UI gap so a former Mizar user recognises the workflow immediately, without
copying anything of Mizar's.

Read first, in this order — they already hold the decoded reference material, so do not
re-decode video:

- `docs/ai/MIZAR_PARITY_MATRIX.md` — every reference workflow, its DegenAration route, and its
  status. The exact remainder is written in each row.
- `docs/ai/CLICK_FLOW_MAP.md` — control order per screen.
- `docs/ai/FINAL_REFERENCE_INVENTORY.md` and `docs/ai/REFERENCE_COVERAGE.md`.

Take the first `PARTIAL` or `FAIL` row whose remainder is not "authenticated session" (that is
blocker E-6 and no amount of code closes it). Implement it, then capture evidence at 390, 768,
1024 and 1440 into `docs/ai/evidence/` and update the row.

Hold to the design system:

- deep black canvas, layered near-black surfaces, gold from the existing logo, warm white
  text, muted secondary text, emerald gains and crimson losses used sparingly
- compact cards, strong alignment, tabular numerals, professional spacing
- one professional SVG icon set plus the original DegenAration product glyphs

Reject on sight: emoji as icons, random gradients, meaningless polygons, fake Discord cover
art, decorative `D/A` initials, giant empty cards, excessive uppercase, walls of technical
copy, fake glassmorphism, and any control that does not persist or is not disabled with a
truthful reason.

Copy rules: concise and beginner-readable. Secondary guidance goes behind an info affordance.
Fee, risk and confirmation information stays visible — never hide what costs money.

Every state must exist and be distinct: loading, empty, error, provider-unavailable, and
populated. An unknown value says what is unknown; it never renders as zero.
