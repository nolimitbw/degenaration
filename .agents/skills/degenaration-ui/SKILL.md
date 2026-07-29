---
name: degenaration-ui
description: Applies the DegenAration senior UI system — information hierarchy, compact product copy, icon rules, responsive behavior, and visual verification. Use whenever frontend pages or components are changed.
---

# DegenAration UI system

Read `docs/launch/FINAL_LAUNCH_SPEC.md` §5–§8 before broad UI changes.

## Brand

Gold on dim-black. Gold is an **accent**, not a page wash. Off-white primary text, warm
gray secondary. Green and red only for factual positive and negative states.

Use semantic tokens (`--canvas`, `--surface-*`, `--gold-*`, `--text-*`, `--border-*`),
not raw hex. The legacy names `toxic` / `hotpink` / `cyber` describe a retired neon
palette but already hold warm gold values — prefer semantic names in new work and do not
"restore" the neon meaning those names imply.

## Copy

- Page subtitle: one short sentence, 50–100 characters
- Card description: one sentence, max two lines
- Field helper text: omit by default; use an info control when explanation helps
- No paragraph under every field, no filler eyebrow above every title, no repeating the
  same idea in heading, card, field, and footer
- Never expose internal architecture, database, worker, reconciliation, or release-gate
  language. Say what it means for the user instead.

Being honest about limits is required; sounding like an engineering changelog is not.
"Automated trading is not yet available" — not "activation locked pending controlled
release review".

## Icons

SVG only, from Lucide, with consistent stroke and optical size. Accessible names on
icon-only controls. **No emoji or Unicode pictograms as interface icons** — no `✓`, `⚠`,
`↗`. `npm run check:visible-copy` fails the build on these.

## Required states

Every async surface needs: skeleton shaped like the real content, bounded timeout, empty,
stale, error with retry, and populated. Never a spinner in a giant empty rectangle. Never
an empty state when data actually failed to load. Never an indefinite spinner.

Use `Promise.allSettled`, not `Promise.all` — one failing panel must not blank the page.

## Prohibited

Gradient page washes, glowing blobs, excessive glassmorphism, gradient text as
decoration, pill controls everywhere, cards inside cards without structural reason,
identical three-column feature grids, oversized marketing heroes inside the app, fake
activity, decorative charts with meaningless data, fabricated metrics.

## Verify by looking

Static checks miss what rendering reveals — internal copy has been found on screen that
grep did not catch. After a UI change:

1. `preview_start`, load the changed route
2. Read the console for errors and hydration warnings
3. Screenshot at 375, 768, 1024, and 1440
4. Check horizontal overflow, clipped content, focus order, contrast
5. `npm run check:visible-copy`

Stop the dev server before `npm run check` — `next build` clobbers a running dev
server's `.next` directory and produces a spurious failure.
