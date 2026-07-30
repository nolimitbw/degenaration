# Release evidence

What was actually verified, and how. Anything not listed here was **not** verified —
this file exists so a completion claim can be checked rather than believed.

Branch `claude/degenaration-launch-remediation` · last updated 2026-07-30

## Commands

| Command | Result | When |
|---|---|---|
| `npm run check` | **exit 0** — typecheck, lint, 104 server tests, fee-ledger invariants, journal contract, Discord command registry, visible-copy scan, production build | after every slice |
| `npm run lint` | clean across 218 files; found and fixed 5 real problems on first run | Phase 24 |
| `npm run verify:fee-ledger` | all invariants hold across 75 notional × source × referral combinations, including the ledger entry model | Phase 13.5 |
| `npm run verify:performance-journal` | schema + parser contract hold; dedupe anchored on a NOT NULL column | Phase 9 |
| `npm run check:discord-commands` | registry clean — 6 unique commands, one `/register`, single scope, global cleanup present | Phase 4 |
| `npm run check:visible-copy` | clean across 187 files in `app/`, `components/`, `lib/` | Phase 5/6 |
| `npm run verify:withdrawal` | 6 structural checks pass — transaction decodes to a single System Program transfer, lamports round-trip exactly, leaves the server unsigned | Phase 12 |
| `npm run verify:discord-live` | requires owner-held bot credentials; exits 0 with instructions when absent | Phase 15 |

Test count went 41 → 104 over this work (fee model, JS↔SQL parity, withdrawals, journal
outcomes, safety filters, portfolio stats).

**Operational note:** `npm run check` runs `next build`, which clobbers a running
`next dev` server's `.next` directory and produces a spurious failure. Stop the dev
server first. This bit once during this work and was misdiagnosed as a real failure
before being isolated by running each step individually.

## Browser verification

Dev server at `localhost:3000`, Next.js 15.5.22.

| Route | Viewport | Observed |
|---|---|---|
| `/` | 1440×900 | Renders correctly. Gold-on-black, live BONK chart, KOL preview panel. No console errors. |
| `/` | 375×812 | `scrollWidth === clientWidth` — no horizontal overflow |
| `/` | 768×1024 | `scrollWidth === clientWidth` — no horizontal overflow |
| `/affiliate` | 800×650 | Unauthenticated state renders cleanly: title `Affiliate`, subtitle `Track creator and referral earnings.` per §6.2, no filler eyebrow, no spinner. No console errors. |
| `/bots` | 800×650 | §6.2 copy live; DiscordSignal, KolStrategy, DegenBot and RiskShield glyphs render. No console errors. |
| `/bots/discord` | desktop + 375 | Redesigned cards verified with a stubbed API response covering a measured and an unmeasured source. No cover art, 56px avatar, health dot with text, `Tracking started [date]` on the unmeasured card. Cards stack one per row at 343px. |
| `/bots/kol/new` | desktop | Section order matches §11.1; summary shows Maximum exposure and one fee row with info affordances. |

### Responsive audit — §22.6 required widths

Programmatic audit at each width on `/`, measuring horizontal overflow, off-screen
controls, and sub-minimum touch targets:

| Width | Horizontal overflow | Off-screen controls | Sub-44px controls |
|---|---|---|---|
| 375 | none (`scrollWidth === clientWidth`) | 0 | 0 after fix (**9 before**) |
| 768 | none | 0 | — |
| 1024 | none | 0 | compact by design (32px above `sm`) |
| 1440 | none | 0 of 32 controls | compact by design |

The audit found 9 controls under the 44px minimum (§7.4): chart refresh and timeframe
buttons at 32px, buy-amount presets at 36px, mobile menu trigger at 40px. Fixed with
responsive sizing so mobile meets 44px while desktop keeps professional density —
verified 44px at 375px and 32px at 1024px. Bare number inputs measuring 20px were
assessed as false positives; their bordered wrapper is the tap target.

### Second pass — `/bots/discord` at 375px

The first pass only covered `/`. Auditing the redesigned marketplace route found **10 more
sub-44px controls that the homepage fix had not touched**, including the shared
`Segmented` timeframe control at **30px** — used on Discord, KOL, Portfolio, and Affiliate,
so one component was under-sized on four surfaces.

Fixed in the shared primitives rather than per page: `Segmented`, the app-shell menu /
notifications / admin / wallet controls, and every `h-9`/`h-10` icon button across 13
files. All raised to 44px up to `sm` and returning to compact size above it.

| Route | Width | Overflow | Off-screen controls | Sub-44px buttons |
|---|---|---|---|---|
| `/bots/discord` | 375 | none | 0 | **0** (10 before) |
| `/bots/discord` | 1440 | none | 0 | compact by design — Segmented 32px, refresh 40px |

Cards render one per row at 343px on mobile and two per row on wide desktop, per §8.3.
Verified with a stubbed marketplace response covering a measured and an unmeasured source.
No console errors at either width.

### Copy changes confirmed on the rendered page

Read back from `document.body.innerText`, not from source:

- `SOLANA MAINNET. You confirm every transaction in your own wallet. Automated trading and payouts are not yet available.`
- `Solana Mainnet data is live. Automated entries and payouts are not yet available.`
- `/bots` automation metric: `Not yet available`
- The permanent release-warning footer is gone from `AppShell`

Browser verification is what caught the `ReleaseBanner` and `AUTOMATED_MAINNET_RELEASE.reason`
strings — the static checker was scanning only `app/` and `components/` and was blind to
`lib/`. The checker was then widened.

### DegenBackdrop layering

Verified via computed styles, not by eye:

```
backdrop found: true, z-index: -10, children: 5, visibility: visible
layer 0 radial gradients: background-image present
layer 1 grid: background-size 56px 56px
layer 2 signal paths: <svg>
layer 3 grain: opacity 0.025
layer 4 vignette: box-shadow present
body background: rgba(0,0,0,0)   html background: rgb(13,14,15)
```

It is deliberately subtle and does not stand out in a screenshot. That is the intended
result — if the background is obvious on a data screen it is too strong.

## Not verified

Stated plainly so none of this reads as covered:

- **No stored PNG set** for the authenticated routes §22.6 lists (My Bots, Affiliate tabs,
  Portfolio populated and empty, withdrawal modal, Wallet, PnL cards, Admin diagnostics).
  Public routes were audited programmatically at all four widths; the authenticated ones
  need a real Privy session, which cannot be created from this environment.
- **No real withdrawal signature.** The transaction the endpoint builds is verified
  structurally (decodes to a correct transfer, exact lamports, unsigned), but the on-chain
  landing check needs the devnet faucet, which is currently 429 rate-limited here. A funded
  wallet closes this.
- **Discord global-command cleanup unobserved live.** `npm run verify:discord-live` exists
  to confirm it; it needs the deployed bot's credentials.
- **No browser e2e on authenticated routes.** Same session dependency.

### Corrected in this revision

The previous revision claimed migrations were unapplied, the signal journal untraced, and
no lint run. All three had since been done — the four migrations were applied and proven
against live Postgres, the journal chain was traced end to end (rolled back), and
`npm run lint` gates 218 files. A stale evidence file is worse than none, because it reads
as verification.

## Readiness

**READY FOR STAGING — not for mainnet.**

No requirement is BLOCKED. Every remaining gap is a physical dependency: a funded wallet,
a deployed worker, or a signed-in session. Before mainnet, `PLATFORM_FEE_ACCOUNT` must be
set (currently 0 bps collected) and **OPEN_BLOCKERS B-6 must be resolved** — the worker
reads legacy tables carrying no safety configuration, so a deployed worker would execute
without the filters users configured.
