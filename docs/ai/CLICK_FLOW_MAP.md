# Click-flow map

Updated: 2026-08-01

This map translates each required reference workflow into the shortest expected user
path. Routes are DegenAration routes; no Mizar naming or assets carry over.

| # | Flow and exact interaction sequence | Route / component | API or worker dependency | Verification |
| --- | --- | --- | --- | --- |
| 1 | Bots -> Discord Bot -> search/filter source -> View | `/bots/discord` | Discord marketplace/performance | PARTIAL: responsive shell, 1D selection, drawdown sort, and failure state verified; local app bridge cannot return source cards |
| 2 | Source card -> Details -> inspect 1D/7D/30D, health, calls, returns, fees | `/bots/discord/[id]` | source detail/performance | PARTIAL: shared activity, count, and ledger-performance components implemented; live source detail pending migration/deployment |
| 3 | Configure -> identity -> wallet -> server -> channel -> buy -> max trades/capital -> exits -> safety -> execution -> review | `/bots/discord/new`, `BotBuilder` | source + bot API | PARTIAL: sequence responsive/browser-verified; authenticated save pending |
| 4 | Take profit -> Add TP level -> set target -> set sell allocation -> optionally enable trailing | `BotBuilder` | config/version, exit worker | PARTIAL: third level and ordering validation browser-verified; persistence proof pending |
| 5 | Stop loss -> set threshold -> trailing/dynamic -> debounce -> freeze/emergency | `BotBuilder` | config/version, exit worker | Pending |
| 6 | Security filters -> Configure filters -> enable row -> enter min/max -> Done | `BotBuilder` dialog | scanner/safety providers | PARTIAL: mobile disclosure/inert state/range validation verified; persistence proof pending |
| 7 | Sticky summary -> Review and save draft -> inspect grouped summary -> acknowledge -> confirm | `BotBuilder` dialog | authenticated bot POST | PARTIAL: grouped dialog and acknowledgement gate verified; final POST intentionally not sent |
| 8 | Bots -> My Bots -> Discord Bots | `/bots/manage` | bots list | PARTIAL: separate tabs/status/performance/capital/fee table implemented; authenticated browser evidence pending |
| 9 | Bot row -> Edit -> persisted fields load -> change -> review -> save | `/bots/discord/[id]/edit` | bot GET/POST, config version | Pending after hydration fix |
| 10 | Bot row status action -> Pause -> confirm -> Resume | `/bots/manage` | bot status endpoint | PARTIAL: pause and release-gated resume exist; archive now has explicit retained-history confirmation; authenticated lifecycle proof pending |
| 11 | Bots -> KOL Bot -> search/sort strategy -> View | `/bots/kol` | KOL marketplace | Pending |
| 12 | New KOL -> identity -> wallet -> budget -> trigger -> scanner -> DCA -> exits -> safety -> execution | `/bots/kol/new`, `BotBuilder` | bot API, token provider | PARTIAL: complete decision order verified at three widths; save pending |
| 13 | Entry trigger -> quick set/reference/drop/lookback -> DCA -> add level/drop/amount/expiry | `BotBuilder` | scanner + entry worker | PARTIAL: High Volume preset behavior verified; DCA save pending |
| 14 | Take profit/Stop loss -> levels/trailing -> threshold/dynamic/freeze | `BotBuilder` | exit worker | PARTIAL: multi-TP interaction verified; stop-loss persistence proof pending |
| 15 | Security filters -> Run preview -> inspect pass/fail/no-candidate state | `BotBuilder` | `/api/tokens`, providers | Pending |
| 16 | Review -> save private draft or request public review/publish | `BotBuilder` | bot version/review | PARTIAL: review and acknowledgement verified; save/publish pending |
| 17 | KOL marketplace -> Copy strategy -> subscriber wallet/budget/risk overrides -> confirm | `/bots/kol/[id]` | subscription API/version | Pending |
| 18 | My Bots -> KOL Bots -> subscriber settings -> edit risk -> save version | `/bots/manage` | subscriptions/config versions | Pending |
| 19 | Affiliate -> Discord/KOL/Referrals -> range -> inspect earnings/history | `/affiliate` | earnings ledger | Pending |
| 20 | Request payout -> destination/amount -> read fee/net -> confirm eligible request | `/affiliate` dialog | payout RPC/ledger | Pending fixture/session |
| 21 | Portfolio -> Overview -> range -> hover equity -> inspect statistics | `/portfolio` | equity snapshots/ledger | Pending |
| 22 | Positions -> row -> inspect entry/current/PnL/source/config snapshot | `/portfolio` | positions endpoint | Pending |
| 23 | Trades -> row -> inspect exit/fees/net/status | `/portfolio` | trades/ledger | Pending |
| 24 | Withdraw -> amount/Max -> review reserve/fee -> wallet sign -> confirmation | `/portfolio` dialog | withdrawal prepare/confirm + Privy | Local validator passes; UI pending |
| 25 | Winning open/closed record -> Share -> render/download card | PnL card action/API | authoritative record lookup | PARTIAL: authoritative render and matching QR/copy link implemented, and the card's arithmetic is now a tested module (`lib/pnl-card.js`, 26 tests) rather than untestable logic inside an async route; authenticated evidence pending (E-6) |
| 26 | Losing completed trade -> Share -> render/download card | PnL card action/API | authoritative record lookup | PARTIAL (was BLOCKED): `app_private.position_exits` supplies the durable exit linkage, so average entry and exit are divisions of recorded integers. A unit defect was found and fixed on 2026-08-05 -- the closed branch omitted 10^decimals, printing a price a billionth of the open card's for the same trade. Both branches now share one formula, asserted equal at 0/6/9 decimals; authenticated evidence pending (E-6) |
| 27 | Portfolio -> Share performance -> period -> render/download card | PnL card action/API | reconciled period ledger | PARTIAL: server-authoritative export; QR target and printed link are derived from one value and asserted identical; a period with no reconciled snapshot is refused with 409 rather than rendered as 0.00%; authenticated evidence pending (E-6) |

## Setup disclosure sequence

```text
identity -> execution wallet -> source/strategy -> funding and exposure
         -> entry trigger (KOL) -> DCA (KOL) -> take profit -> stop loss
         -> security filters -> execution and retries -> capital/risk review
         -> confirmation -> durable save/version
```

- The first four decisions are visible without opening advanced controls.
- TP and SL come after the budget is understandable.
- Security and execution controls stay collapsed until intentionally opened.
- The sticky summary remains visible on desktop and follows the form on narrow layouts.
- Editing uses the same sequence and actual saved values; it is not a separate mental
  model.

## Failure and recovery branches

- Source load failure -> inline unavailable state -> Try again; a genuine empty list uses
  a separate message.
- Preview provider failure -> observable error -> retry; no candidates uses a separate
  empty state.
- Validation failure -> affected section/error summary -> review cannot open.
- Save failure -> dialog remains recoverable -> error toast -> no false success.
- Worker/scanner evidence stale or missing -> fail closed -> journal reason remains
  observable.
- Pause blocks new entries but never stops exit management.
- Archive requires explicit confirmation and preserves financial history.
