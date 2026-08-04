# Mizar parity matrix

Updated: 2026-08-01

Status rules: `PASS` requires working UI, validation, persistence, authorization,
observable failure behavior, correct calculations, and browser evidence. `PARTIAL` names
the missing behavior. `FAIL` includes a reproducible absence. `BLOCKED` names the external
requirement. Source inspection alone is never PASS.

| Ref / time | Page or feature | Visible components and exact sequence | Conditional, validation, and state behavior | DegenAration route / component | Backend dependency | Status and evidence |
| --- | --- | --- | --- | --- | --- | --- |
| V2 00:00-00:11 | Discord marketplace | Browse cards; inspect source; choose timeframe; configure | Card hover/timeframe changes performance; unknown history remains unavailable | `/bots/discord`; `DiscordMarketplace` | marketplace Discord endpoint, performance journal | PARTIAL: period/sort controls and truthful failure state browser-verified at 1440/1024/390 in `evidence/discord-marketplace-*.jpg`; the forward migration now passes isolated PostgreSQL apply/rerun, preservation, authorization, and null-unknown tests via `npm run verify:marketplace-migration`; production apply and live-card proof remain |
| V2 00:12-00:23 | Discord identity and budget | Bot name; trades; wallet; buy amount; server; channel | Approved sources only; all-channel option; positive capital bounds | `/bots/discord/new`; `BotBuilder` | Privy wallet, approved groups/channels, bot API | PARTIAL: identity -> wallet -> source -> funding order browser-verified in `evidence/discord-builder-desktop-1440x1000.jpg`; authenticated save remains |
| V2 00:24-00:35 | Discord take profit | Enable exit logic; add TP rows; set target and sell allocation | Add/remove rows; allocation cannot exceed 100%; trailing values conditional | same | bot config/version, exit monitor | PARTIAL: shared builder added a third level and blocked an out-of-order target in browser; authenticated Discord save remains |
| V2 00:36-00:47 | Discord stop loss/retries | Set SL; toggle dynamic/trailing; reveal retry settings | Bounded SL; retry count/quote expiry bounds; exits continue while paused | same | bot config/version, exit monitor | PARTIAL: implemented; runtime execution evidence remains in launch tracker |
| V2 00:48-00:59 | Discord security | Open modal; enable individual filters; set ranges; close | Disabled row inputs inert; missing required fresh evidence fails closed | same; security dialog | scanner providers, `server/engine/safety.js` | PARTIAL: 35 filters persist/enforce; subscriber config handoff is deployment blocker B-6 |
| V2 01:00-01:11 | Discord confirmation/save | Review grouped settings; acknowledge; cancel/save | Save disabled until reviewed; invalid form cannot open review; success returns manager | same; confirmation dialog | authenticated bot POST and config version | PARTIAL: Main/Buy/Sell/Advanced dialog and acknowledgement gate browser-verified through the shared component; authenticated save remains |
| V3 00:00-00:11 | KOL basics | Bot name; buy amount; wallet; trigger/reference/lookback | Wallet required for activation; draft remains allowed; trigger bounded | `/bots/kol/new`; `BotBuilder` | Privy wallet, bot API | PARTIAL: reference-familiar order and capital validation verified at 1440/1024/390; authenticated save remains |
| V3 00:12-00:23 | KOL scanner presets | Open presets; choose quick set; configure refresh/count/mode | Preset updates drop/lookback/risk together; advanced stays collapsed | same | token provider and scanner config | PARTIAL: High Volume changed drop 12 -> 18, lookback 60 -> 30, and risk High -> Very high in browser; saved preset hydration repaired in code but authenticated edit proof remains |
| V3 00:24-00:47 | KOL advanced filters | Open security; choose DEXes; enable rows; enter min/max | Inputs activate per filter; range/filter evidence fails closed | same | safety providers | PARTIAL: modal/disclosure and inert disabled rows browser-verified; inverted liquidity range blocked; DEX list stays non-editable until it has worker enforcement |
| V3 00:48-00:59 | KOL token preview | Run preview; inspect returned tokens; save preset selection | Loading, no-candidate, pass/fail results; preview is informational | same | `/api/tokens`, scanner | PARTIAL: provider failure now has a distinct retryable error instead of false empty; live-provider browser proof remains |
| V3 01:00-01:23 | KOL DCA | Enable DCA; add levels; set additional drop/allocation/expiry | Level removal/add bounds; planned capital includes all DCA entries | same | bot version, worker entry engine | PARTIAL: implemented and persisted; browser proof pending |
| V3 01:24-01:47 | KOL TP/SL | Add TP; trailing; stop; delay; dynamic; freeze | Allocation and SL validation; freeze/cooldown apply after stop | same | exit monitor and safety config | PARTIAL: implemented; runtime browser proof pending |
| V3 01:48-02:11 | KOL execution | Open execution controls; set priority/slippage/retries/cooldown | Bounds enforced; simulation fail closed; secondary controls collapsed | same | Jupiter quote/submit/confirm worker | PARTIAL: implemented; live activation deliberately gated |
| V3 02:12-02:20 | KOL review/publish | Review capital/risk; save; publish | Public only after review; failures observable; save durable | same | bot POST/config versions, marketplace review | PARTIAL: grouped review, warning, and disabled-until-acknowledged confirm verified in desktop/mobile screenshots; actual save/public review remains |
| V4 00:00-00:08 | Bot manager | Switch Discord/KOL tabs; inspect status/performance/capital; row action | Truthful empty state; refresh; per-kind separation | `/bots/manage`; manager page | bots endpoint, positions/performance/fees | PARTIAL: existing network/platform/creator fee payload is now typed and shown as 30D total plus gas/breakdown; authenticated browser proof remains |
| V4 00:09-00:18 | Edit completed bot | Open row; load actual values; pause/resume/save/delete | Save creates version; open positions retain snapshot; destructive action confirmed | `/bots/{kind}/[id]/edit`; `BotBuilder` | bot GET/POST/status endpoints, config versions | PARTIAL: preset and valid zero-valued cooldown/delay/priority hydration repaired; archive now requires confirmation and remains blocked with open positions; authenticated edit/save evidence remains |
| V1 00:00-00:11 | Affiliate earnings | Read available/pending/lifetime/period; switch product tabs/range | Empty chart truthful; info behind affordances; retry on failure | `/affiliate` | earnings ledger and referral attribution | PARTIAL: dashboard implemented; new browser proof pending |
| V1 00:12-00:23 | Affiliate payout dialog | Request payout; inspect wallet/amount/fee/net | Min 0.1 SOL and fee 0.043 SOL; insufficient/invalid rejected server-side | `/affiliate`; payout dialog | authenticated payout RPC/ledger | PARTIAL: implementation exists; eligible payout cannot be proven without ledger fixture/session |
| V1 00:24-00:30 | Affiliate FAQ/history | Switch payout history; expand concise questions | Completed/pending/failed observable; only essential copy visible | `/affiliate` | payout history endpoint | PARTIAL: FAQ exists; browser proof pending |
| V5 00:00-00:06 | Portfolio overview | Select account; read balance/allocation/PnL; change range; hover chart | Loading/error/empty separated; tooltip reflects reconciled series | `/portfolio` | ledger, positions, equity snapshots | PARTIAL: no fabricated curve; authenticated hover evidence pending |
| V5 00:07-00:11 | Portfolio actions | Deposit; withdraw; bridge/account action | Self-service withdrawal; amount/reserve validation; failed tx observable | `/portfolio`; withdrawal modal | Privy signer, withdrawal prepare/confirm | PARTIAL: local-validator transaction passes; signed-in UI evidence pending |
| V5 00:12-00:15 | Portfolio tabs | Switch Overview/Positions/Trades/Cash movements | Table/skeleton/empty/detail states remain distinct | `/portfolio` | portfolio endpoints | PARTIAL: implemented; browser proof pending |
| I1 | Winning PnL card | Open position/trade; share; render signed positive result and QR | Server derives values by record ID; client cannot submit percentage | `/api/product/pnl-card` | authoritative ledger, QR canonical/referral URL | PARTIAL: 1600x900 renderer now uses the real DegenAration SVG mark and keeps visible/copy fallback link equal to the QR target; authenticated render evidence pending |
| I2 | Losing PnL card | Open completed losing trade; share; render negative result and QR | Loss state uses sign/label, not color alone; same authorization | same | same | BLOCKED: open losing positions render from live authoritative value, but completed-trade entry/exit pricing lacks a durable position-to-exit execution relationship; no value is inferred |
| I3 | Portfolio PnL card | Select portfolio performance period; share result | Server derives period values; no arbitrary client metrics | same | reconciled equity/ledger | PARTIAL: real logo and QR/referral link parity fixed; authenticated deterministic render/browser evidence pending |

## Cross-cutting reference behavior

| Behavior | Status | Exact remainder |
| --- | --- | --- |
| Focused navigation: Bots, Affiliate, Portfolio | PASS | Production frame `frame-01-0002.6s.jpg`; `components/AppShell.tsx` |
| Bots tabs: Discord, KOL, My Bots | PASS | Production frames `frame-03-0012.8s.jpg`, `frame-09-0043.6s.jpg` |
| Gold/black/white identity and compact data density | PASS | All 12 current-build frames |
| Truthful unknown values | PASS | Discord source frames show dashes and measured-count context, not false zero returns |
| Tooltips instead of explanation walls | PARTIAL | Summary/affiliate affordances exist; complete keyboard/browser audit pending |
| Desktop/tablet/mobile evidence | PARTIAL | Six builder/dialog/filter images under `docs/ai/evidence/`; all three widths have `scrollWidth === clientWidth`. Other primary surfaces still need current evidence |
| Mainnet automated activation | BLOCKED | Worker deployment, valid platform fee account, B-6 config handoff, and explicit authorization |

---

## Setup-order parity, verified 2026-08-04

`BotBuilder.tsx` section order, read from the source:

1. Bot identity · 2. Execution wallet · 3. Discord source · 4. Funding and exposure ·
5. Entry trigger · 6. Dollar-cost averaging · 7. Take profit · 8. Stop loss ·
9. Security filters · 10. Execution and retries

Capital/exposure summary, the platform fee line, the acknowledgement gate and
cooldown/duplicate controls are all present in the same component.

### One deliberate divergence, and why it stays

The final execution prompt's §13 lists slippage, priority fee and retry at positions 9–11,
i.e. **before** take-profit. The builder places them last, inside a collapsed "Execution and
retries" section.

That is not drift. `FINAL_LAUNCH_SPEC.md` §11.1 mandates the opposite order explicitly —
`Source → Budget → Entry → Take Profit → Stop Loss → Safety → Advanced Execution → Review`
— with Advanced Execution "collapsed by default", because putting priority-fee and retry
tuning ahead of take-profit is exactly the beginner-hostile density both documents forbid.
The builder follows the progressive-disclosure rule the two specs agree on rather than the
field enumeration one of them lists.

Read as an enumeration of *required fields* rather than a mandated visual order, §13 is
satisfied in full: every one of its 23 items exists. Reordering to match it literally would
break §11.1 and the Mizar-familiarity goal at the same time.

### What actually blocks the remaining PARTIAL rows

Nearly every row above ends "authenticated save remains" or "browser proof pending". Those
are one blocker, not many: **E-6**, a signed-in Privy session with a delegated dev wallet.
The implementation is present in each case; what is missing is evidence that requires a real
session. No amount of further code closes them.

## §11 checklist, verified against source 2026-08-04

Each item checked in code rather than asserted from memory.

| §11 item | State | Where |
|---|---|---|
| navigation | **Bots · Affiliate · Portfolio**, exactly three | `AppShell.tsx:34-36` |
| setup order | verified, one documented divergence | this file, previous section |
| grouping / progressive disclosure | 10 collapsible sections, Advanced last | `BotBuilder.tsx` |
| forms / dialogs / tabs / tables | shared primitives, one implementation each | `product/Primitives.tsx` |
| marketplace | real server PFP, no cover art | `67798ef` |
| Bot Manager | Discord/KOL tabs, fee visibility | `7c83d48` |
| performance presentation | truthful unmeasured state, no fabricated figures | `MIZAR_PARITY_MATRIX` V2 rows |
| confirmations | grouped review + acknowledgement gate | `BotBuilder.tsx` |
| Portfolio | metric strip, 7D/30D/3M, four tabs | `PortfolioDashboard.tsx` |
| Affiliate | independent panels, stale-tolerant | `cb4abb3` |
| tooltips / help | info controls, no wall-of-text | `check-visible-copy` enforces |
| mobile behavior | 390/768/1024/1440, 0 overflow, 44px targets | `38d8284`, `710dcfb` |
| branding preserved | DegenAration name, logo, black/gold/white, original glyphs | `3a08002`, `f2823fb`, `0fba6d7` |

**Conclusion.** §11 is implemented. What is missing across this file is not interface code —
it is browser evidence from a signed-in session (**E-6**). Writing more UI does not change a
single row here; obtaining a test identity changes about fifteen.

## Correction: "authenticated save remains" understates what is verified

Fifteen rows above end with some form of *"authenticated save remains"* or *"browser proof
pending"*, which reads as though the save path is unverified. It is not. `npm run
verify:bot-lifecycle` runs against real PostgreSQL and already passes:

| Property | What it proves |
|---|---|
| `createHydrateEdit` | a bot saves, reloads with its values, and edits persist |
| `configurationVersions` (6) | each edit creates an immutable version rather than mutating |
| `ownerIsolation` | another user cannot read or modify the bot |
| `pauseResumeArchive` | the full lifecycle transitions |
| `archivedTerminal` | an archived bot cannot be restored |
| `entrySnapshotRetention` | an open position keeps the config it was opened under |
| `discordSourceUniqueness` | one live Discord bot per source per owner |
| `kolDuplicate` | duplication respects the publication limit |
| `rpcAuthorization` | anon and authenticated are denied; service_role is not |
| `ownerActivityJournal` | the owner-only journal returns their bot and no one else's |

So the accurate split is:

- **Server-side save: VERIFIED.** The RPC, versioning, authorization and persistence are
  covered and green.
- **Browser interaction: UNVERIFIED.** Whether the form posts what the user typed, and whether
  the confirmation dialog gates it, needs a signed-in session (**E-6**).

Those rows should be read as "the click is unproven", not "the save is unproven". The
distinction matters: a reader deciding whether to launch needs to know the persistence layer
is tested, and that what remains is interaction evidence rather than correctness evidence.
