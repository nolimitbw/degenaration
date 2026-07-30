# DegenAration Reference Coverage

Updated: 2026-07-30 (Claude Code) · previous revision 2026-07-26 (Codex)

This matrix is the implementation contract between the supplied references and the
product. The references define **workflow depth and information hierarchy only**.
DegenAration keeps its own brand, palette, copy, components, and visual treatment.

## Source index

Codex extracted the five `.mov` recordings into timestamped contact sheets, which is how
the video content is reviewable at all — Claude Code cannot process video directly.

| ID | Source | Extracted frames | Reviewed by |
| --- | --- | --- | --- |
| R1 | `DISCORD BOT AND KOL BOT AFFILIATE .mov` | `~/.codex/tmp/degen-sheets/affiliate/` (3 sheets) | Codex |
| R2 | `DISCORD BOT PLAN FULL VIDEO OF VISION.mov` | `~/.codex/tmp/degen-sheets/discord/` (6 sheets) | Codex |
| R3 | `FULL VIDEO OF IDEA OF FULL DESIGN AND FUNCTIONAL OF KOL BOT.mov` | `~/.codex/tmp/degen-sheets/kol/` (12 sheets) | Codex, **Claude (sheet 03)** |
| R4 | `How it looks like when its done, you can edit your setups .mov` | `~/.codex/tmp/degen-sheets/manager/` (2 sheets) | Codex |
| R5 | `PORTFOLIO FULL PLAN.mov` | `~/.codex/tmp/degen-sheets/portfolio/` (2 sheets) | Codex, **Claude (sheet 01)** |
| R6 | `explanation on KOL BOT.png` | source image | Codex, **Claude** |
| R7–R9 | Winning / losing / portfolio PnL card references | source images | Codex, **Claude** |

> The contact sheets live in `~/.codex/tmp/`, which is temporary. **Copy them somewhere
> durable before they are cleared**, or the only reviewable form of the video references
> is lost.

## What Claude verified directly (2026-07-30)

### R5 — Portfolio (sheet 01)

Three-column workspace above a tabbed table:

- **Performance** column: 30D Total PnL, 30D Realized PnL, Unrealized PnL, Available
  Balance, Total Balance
- **Realized PnL** column: chart with a hover tooltip showing cumulative realized PnL
- **Main Stats / MC Distribution** tabbed column: Total Swaps, Gas Fees, Buys vs Sells Tx,
  Buys vs Sell Volume, Wins vs Losses, Last Swap, Unique Tokens, Scams
- Tabs: **Portfolio · Trades · Swaps**
- Wallet selector with inline copy / export / edit / bridge actions
- Timeframe segmented control (1D / 7D / 30D) plus a currency toggle
- Empty state is deliberately plain: one line, one sentence, one primary button

### R3 — KOL security filters (sheet 03)

The reference exposes roughly **24 filters** in a scrollable modal, each row being
`[checkbox] label [timeframe] [min] [max]`:

market cap, liquidity, volume, volatility index, smart buy volume, smart buy wallets,
smart sell volume, smart sell wallets, smart money inflow, price change, risky wallets,
fresh wallets, total holders, top-10 concentration, phishing holders, bundler holders,
sniper holders, bot holders, KOL holders, smart money holders, dev holders, degen bot
holders, only-Latin-letters, DEX paid.

**The pattern that keeps 24 filters from overwhelming**: every row is unchecked by
default and its min/max inputs stay inert until the row is enabled. Disclosure happens
per row, not per section — the user only engages with what they deliberately turn on.
DegenAration currently surfaces 15 checks; the gap is coverage, not structure.

### R6 — Volatility mechanic

Buy immediately after a price drop, sell on rebound; speed of entry is the stated
differentiator. This matches the price-drop trigger and rebound exit already in
`BotBuilder`.

### R7–R9 — PnL cards

Structure taken: hero percentage dominates the card, pair name beneath it, duration
label, average entry vs current price as labelled rows, referral QR plus link, logo, and
a landscape aspect.

**Explicitly not taken**: the green / red / teal palettes, the Pepe-style mascot, the
starfield and mountain artwork, and every third-party logo (WagieBot, Binance,
TealStreet). §18 forbids copying them and the owner's own filenames say "make your own
design".

`app/api/product/pnl-card/route.tsx` already satisfies this: 1600×900, gold on black,
code-generated geometric backdrop, DegenAration wordmark, 106px hero percentage,
entry / current / duration / source tiles, referral QR, risk disclaimer. No borrowed art.

## Palette rule

Every reference is another product's branding — Mizar blue, WagieBot green/red,
TealStreet teal, Binance yellow. **None of it carries over.** DegenAration stays gold,
white, and dim-black. Gains and losses use restrained emerald and crimson with a sign or
label so state never depends on colour alone.

## Visual rules extracted

- Compact, data-first shell with minimal decorative chrome
- Two-column desktop builders: configuration left, live context right; single-column
  mobile preserves decision order
- Dense tables for bot management and financial history
- Row-level progressive disclosure for large filter sets
- Segmented controls for timeframes, never free-form buttons
- Gold reserved for focus, selection, and primary actions
- Empty states state the next available action and never fabricate values

## Coverage status

The previous revision's FAIL rows are largely stale — the KOL builder, bot manager,
affiliate dashboard, portfolio workspace, security-filter editor, and PnL card renderer
all exist now. Rather than restate them here, requirement-level status with evidence
lives in `docs/coordination/IMPLEMENTATION_STATUS.md`, which is the single tracker.

Remaining reference-specific gaps, after verifying each against the code rather than
against the previous revision's claims:

| Gap | Reference | Status |
| --- | --- | --- |
| Security filter coverage | R3 | **CLOSED.** The earlier "~9 filters short" claim was wrong — it misread "15 checks enabled" as the total available. Actual inventory is 25 ranges + 10 flags = 35, exceeding the reference's 24. A one-to-one diff found exactly one missing, DEX Paid, now added. |
| Filters were never enforced | R3 | **CLOSED in the enforcement layer.** Nothing read `safetyFilters`; `rugCheck` hardcoded a $10,000 liquidity floor. `server/engine/safety.js` now applies the user's own bounds and fails closed on missing evidence. Handing it per-subscriber config at execution time is OPEN_BLOCKERS B-6. |
| Portfolio Main Stats column | R5 | **CLOSED.** The earlier "not implemented" claim was also wrong — a Statistics panel already existed. Buy/sell volume, wins/losses counts, and separated gas fees were genuinely missing and are now added via `lib/portfolio-stats.js`. |
| MC Distribution view | R5 | **NOT IMPLEMENTED, deliberately.** Needs per-position market cap data that no wired provider returns. Inventing the distribution is what §9.6 and §23 forbid. |
| Swaps tab | R5 | **Equivalent exists.** R5 has Portfolio / Trades / Swaps; DegenAration has Overview / Positions / Trades / Deposits & withdrawals, which covers the same records with an extra cash-movement view. |
| Stored screenshot evidence per surface | §22.6 | Open. Authenticated routes need a real session. Responsive audit results are in `docs/launch/RELEASE_EVIDENCE.md`. |
| Affiliate metric explanations and FAQ | R1 | **CLOSED.** R1 puts an info affordance on every metric and answers recurring questions as collapsed inline items. Both added; answers are generated from the account's real rate, minimum payout, and processing fee. |
| Bot manager operational columns | R4 | **PARTIAL.** 30D volume, max capital, and trades-used-of-max added — `volumeLamports` was already in the payload and simply never rendered. **Gas fees is genuinely absent from `ProductBot`** and was not invented; it needs an API field. |

## Lesson recorded

Two of the gaps above were asserted from this document's previous revision rather than
from the code, and both were wrong. Verify a claim against the implementation before
reporting it — a stale tracker is worse than no tracker, because it reads as evidence.
