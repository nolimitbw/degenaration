# DegenAration Reference Coverage

Updated: 2026-07-26

This matrix is the implementation contract between the supplied visual references
and the product. The references define workflow depth and information hierarchy;
DegenAration must retain its own brand, copy, components, and visual treatment.

## Source Index

| ID | Source | Duration / scope | Extracted evidence |
| --- | --- | --- | --- |
| R1 | `DISCORD BOT AND KOL BOT AFFILIATE .mov` | 00:00-00:30 | `/Users/axell/.codex/tmp/degen-sheets/affiliate/` |
| R2 | `DISCORD BOT PLAN FULL VIDEO OF VISION.mov` | 00:00-01:11 | `/Users/axell/.codex/tmp/degen-sheets/discord/` |
| R3 | `FULL VIDEO OF IDEA OF FULL DESIGN AND FUNCTIONAL OF KOL BOT.mov` | 00:00-02:20 | `/Users/axell/.codex/tmp/degen-sheets/kol/` |
| R4 | `How it looks like when its done, you can edit your setups .mov` | 00:00-00:18 | `/Users/axell/.codex/tmp/degen-sheets/manager/` |
| R5 | `PORTFOLIO FULL PLAN.mov` | 00:00-00:15 | `/Users/axell/.codex/tmp/degen-sheets/portfolio/` |
| R6 | `explanation on KOL BOT.png` | Full image | Source image reviewed at original resolution |
| R7 | Winning PnL card reference | Full image | Source image reviewed |
| R8 | Losing PnL card reference | Full image | Source image reviewed |
| R9 | Portfolio PnL card reference | Full image | Source image reviewed |

## Functional Coverage

| Reference state | Timestamp | Required DegenAration component | Status | Product evidence |
| --- | --- | --- | --- | --- |
| Affiliate tabs and earnings summary | R1 00:00-00:12 | Discord/KOL affiliate analytics | FAIL | `/affiliate` only lists referral links |
| Earnings history and timeframe controls | R1 00:08-00:22 | Affiliate chart | FAIL | Not implemented |
| Payout modal | R1 00:22-00:30 | SOL payout workflow | FAIL | Not implemented |
| Discord source marketplace | R2 00:00-00:15 | Discord marketplace cards and sorting | PARTIAL | `app/calls/CallsBody.tsx` |
| Discord two-column builder | R2 00:15-00:59 | Source, wallet, risk, TP/SL builder | PARTIAL | Entry-only profile exists |
| Discord security filters | R2 00:52-01:03 | Shared risk-filter editor | FAIL | Three static checks only |
| Discord confirmation summary | R2 01:03-01:09 | Activation review dialog | FAIL | Not implemented |
| KOL strategy builder | R3 00:00-01:00 | KOL create/edit form | FAIL | Not implemented |
| KOL security-filter modal | R3 00:15-00:50 | Shared scanner filter editor | FAIL | Not implemented |
| Scanner quick presets | R3 00:53-01:40 | Preset and advanced-filter dialog | FAIL | Not implemented |
| KOL DCA, retries, cooldown | R3 01:40-02:20 | Strategy execution controls | FAIL | Not implemented |
| Bot manager table | R4 00:00-00:18 | Discord/KOL manager | FAIL | Not implemented |
| Portfolio performance workspace | R5 00:00-00:12 | Balance, PnL, stats, chart | PARTIAL | Balance and trades only |
| Portfolio/Trades/Swaps tabs | R5 00:12-00:15 | Portfolio activity tabs | PARTIAL | Trade history exists |
| Volatility explanation | R6 | Transparent trigger definition | FAIL | Not implemented |
| Winning share card | R7 | Original DegenAration winner card | FAIL | Not implemented |
| Losing share card | R8 | Original DegenAration loser card | FAIL | Not implemented |
| Portfolio share card | R9 | Original DegenAration portfolio card | FAIL | Not implemented |

## Visual Rules Extracted

- Compact, data-first app shell with minimal decorative chrome.
- Two-column desktop builders with configuration on the left and live context on the
  right; single-column mobile order preserves decision flow.
- Dense tables for bot management and financial history.
- Advanced controls use progressive disclosure and exact enabled/disabled summaries.
- Timeframes use segmented controls, not free-form text buttons.
- Gold is reserved for focus, selection, and primary actions.
- Gains and losses use restrained emerald and crimson with text/sign indicators.
- Empty states explain the next available action without fabricated values.
- The reference product's blue, branding, assets, wording, and layout details must not
  be copied.

## Browser Evidence

Production and local screenshot evidence will be added here per completed surface.

| Surface | Desktop | Mobile | Result |
| --- | --- | --- | --- |
| App shell | Pending | Pending | Not yet verified for revised IA |
| Bots landing | Pending | Pending | Not yet implemented |
| Discord marketplace/builder | Pending | Pending | Not yet verified |
| KOL marketplace/builder | Pending | Pending | Not yet implemented |
| Bot manager | Pending | Pending | Not yet implemented |
| Affiliate | Pending | Pending | Not yet implemented |
| Portfolio | Pending | Pending | Not yet implemented |
| PnL cards | Pending | Pending | Not yet implemented |
| Admin console | Pending | Pending | Existing console only |

