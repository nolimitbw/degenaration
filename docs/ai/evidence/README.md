# Reference parity evidence

Captured: 2026-08-01 against local `http://127.0.0.1:3000`

Base revision before this milestone: `e5d36a4`. The implementation was still a working
tree when captured. The local environment intentionally lacked product Supabase bridge
credentials, so the Discord screenshot demonstrates the truthful no-source development
state, not production marketplace data.

| Artifact | Route and viewport | State proved |
| --- | --- | --- |
| `discord-builder-desktop-1440x1000.jpg` | `/bots/discord/new`, 1440x1000 | Identity -> wallet -> server/channel -> funding order; sticky capital summary; truthful unavailable source state |
| `kol-builder-tablet-1024x768.jpg` | `/bots/kol/new`, 1024x768 | Core sections stack before the summary without page overflow |
| `kol-builder-mobile-390x844.jpg` | `/bots/kol/new`, 390x844 | Compact single-column order, mobile navigation, no horizontal overflow |
| `kol-confirmation-desktop-1440x1000.jpg` | `/bots/kol/new`, 1440x1000 | Main/Buy/Sell/Advanced grouping and acknowledged enabled confirm |
| `kol-confirmation-mobile-390x844.jpg` | `/bots/kol/new`, 390x844 | Scrollable mobile confirmation with financial/risk values intact |
| `security-filters-mobile-390x844.jpg` | `/bots/kol/new`, 390x844 | Advanced security dialog, per-row disclosure, sticky Done action |
| `discord-marketplace-desktop-1440x1000.jpg` | `/bots/discord`, 1440x1000 | Compact filters, period/sort controls, and truthful provider-failure state |
| `discord-marketplace-tablet-1024x768.jpg` | `/bots/discord`, 1024x768 | Header actions and filter controls wrap without horizontal overflow |
| `discord-marketplace-mobile-390x844.jpg` | `/bots/discord`, 390x844 | Mobile navigation, actions, tabs, and filters remain operable in one column |

## Browser assertions

- Widths 390, 1024, and 1440: `scrollWidth === clientWidth`; no horizontal page
  overflow.
- Browser console: zero warning or error entries for the final pass.
- Default valid KOL setup opens review.
- Confirm remains disabled until the acknowledgement is checked, then becomes enabled.
- Setting maximum capital to 0.1 SOL blocks review with the exact 3.000 SOL requirement.
- Adding a third TP level exposes unique accessible controls such as
  `TP 3 target gain`.
- Setting TP 3 below TP 2 blocks review with the increasing-target validation.
- Range filters reveal enabled inputs while disabled rows remain inert.
- Setting the liquidity minimum above its maximum blocks review.
- Choosing High Volume updates price drop from 12% to 18%, lookback from 60 to 30
  minutes, risk from High to Very high, and the sticky source summary.
- Discord marketplace widths 390, 1024, and 1440 each had
  `scrollWidth === clientWidth`.
- Selecting 1D changed the active period; selecting Lowest drawdown changed the native
  sort value to `drawdown`.
- Marketplace browser console: zero warning or error entries.
- The unavailable app bridge produced the visible retryable product state rather than a
  fabricated source or zero metrics. Live card rendering remains deployment evidence.

No bot was saved, activated, funded, traded, or withdrawn during this browser pass.

## Release verification

`npm run check` exited 0 after the browser fixes: typecheck, code quality, 170 tests,
fee-ledger invariants, performance-journal contract, Discord command registry, visible
copy, and production build all passed.
