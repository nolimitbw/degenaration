# UI system

Tokens: `app/globals.css`, `tailwind.config.ts`. Backdrop: `components/DegenBackdrop.tsx`.
Spec: `FINAL_LAUNCH_SPEC.md` §5, §7.

## Palette

Gold on dim-black. Gold is an **accent**, not a page wash.

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#0d0e0f` | page base (set on `html`) |
| `--surface-1` … `--surface-3` | `#151617` → `#201e1a` | panels, elevation |
| `--gold-400` | `#c29463` | primary interactive accent |
| `--gold-300` / `--gold-500` | `#d9b487` / `#a2784b` | hover / pressed |
| `--text-primary` | `#f3f0eb` | primary text |
| `--text-secondary` / `--text-muted` | `#cbc6bd` / `#9d9992` | supporting, metadata |
| `--success` / `--danger` | `#55b987` / `#d56f6f` | factual gain / loss only |
| `--border-subtle` / `-default` / `-strong` | gold at 10% / 16% / 30% | restrained separation |

### A naming trap

The legacy tokens `toxic`, `hotpink`, and `cyber` are named for a **retired neon
palette** but already hold warm values (`--toxic-rgb: 194 148 99` is gold). The colors
are correct; the names are not. Use the semantic names above in new work, and never
"restore" the neon meaning those legacy names imply. They remain as aliases only until
their ~40 usages are migrated.

The Tailwind `gold` color was `#f0b429` — a brighter yellow that did not match anything
the product renders. It now resolves to `--gold-400`.

## Backdrop

`DegenBackdrop` is fixed, `aria-hidden`, `pointer-events-none`, at `z-index: -10`, with
five layers: warm radial illumination, a 56px grid at 2.2%, two gold signal paths at
3.5–5%, SVG film grain at 2.5%, and an edge vignette.

All code-generated — no bitmap to blur at large sizes, no animation, no particles or
blobs, no layout shift. `body` is transparent and the canvas color lives on `html` so the
backdrop is visible and there is no flash before paint.

It should feel like depth, not decoration. If you notice the background while reading a
table, it is too strong.

## Layout

- Header 60–64px desktop, 56px mobile
- Content max ~1480–1560px; gutters 24–32 desktop, 20–24 tablet, 14–16 mobile
- Spacing scale 4, 8, 12, 16, 20, 24, 32, 40, 48
- Panel radii 10–14px; card radii ≤ 8px; no pill-shaped controls by default
- Control height 36–42px; table rows 44–52px; minimum 44px touch target
- Page title 26–32px desktop, 22–26px mobile; body 13–15px
- Tabular numerals for all financial values

## Icons

Lucide only, consistent stroke and optical size, accessible names on icon-only controls.
**No emoji or Unicode pictograms** — `npm run check:visible-copy` fails the build on
them. Bespoke product glyphs (Discord automation, KOL strategy, scanner, referral, risk)
are not yet built.

## Motion

120–180ms hover/focus, 180–240ms dialogs and drawers, skeleton shimmer only during real
loading. No continuous decorative movement on trading screens. Respect
`prefers-reduced-motion`.

## Required states

Every async surface: skeleton shaped like the real content, bounded timeout, empty,
stale, error with retry, populated. Never a spinner in a giant empty rectangle, never an
empty state when data failed to load, never an indefinite spinner. Use
`Promise.allSettled` so one failing panel cannot blank a page.
