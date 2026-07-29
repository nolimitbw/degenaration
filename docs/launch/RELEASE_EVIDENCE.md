# Release evidence

What was actually verified, and how. Anything not listed here was **not** verified —
this file exists so a completion claim can be checked rather than believed.

Branch `claude/degenaration-launch-remediation` · last updated 2026-07-30

## Commands

| Command | Result | When |
|---|---|---|
| `npm run check` | **exit 0** — typecheck, 70 server tests, fee-ledger invariants, Discord command registry, visible-copy scan, production build | after every slice |
| `npm run verify:fee-ledger` | all invariants hold across 48 notional × source × referral combinations | slice 2 |
| `npm run check:discord-commands` | registry clean — 6 unique commands, one `/register`, single scope, global cleanup present | Phase 4 |
| `npm run check:visible-copy` | clean across 186 files in `app/`, `components/`, `lib/` | Phase 5/6 |

Test count went 41 → 70 over this work (fee model, JS↔SQL parity, withdrawals).

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

- **No captured screenshot set** at 375 / 768 / 1024 / 1440 for the routes §22.6 lists
  (Discord marketplace, source details, bot form and review, KOL marketplace and
  builder, My Bots, Affiliate tabs, Portfolio populated and empty, withdrawal modal,
  Wallet, PnL cards, Admin diagnostics). Most require an authenticated session with real
  data.
- **Withdrawal flow not exercised end to end.** Logic has 11 unit tests; it has not run
  against a funded wallet or a real Privy signature.
- **Migrations not applied.** `degenaration-fee-allocation-integrity.sql` and
  `degenaration-user-withdrawals.sql` are written and reviewed but have not run against a
  database, so the trigger and the RPC are unproven at runtime.
- **Discord global-command cleanup unobserved.** Correct by construction and covered by
  the static check, but not seen against a live Discord application.
- **Signal journal untraced.** Requires database access — see `OPEN_BLOCKERS.md` B-4.
- **No lint, e2e, migration dry run, or RLS test run.**

## Readiness

**NOT READY.** Both audit-identified release blockers now have tested implementations,
but nothing here has run against a live database, a funded wallet, or a real Discord
application, and Phases 3, 6, and 7 remain substantially incomplete.
