# Final execution handoff

Required by §3 of `docs/ai/DEGENARATION_FINAL_FULLSCAN_FINANCE_ADMIN_MIZAR_UI_CLAUDE_PROMPT.md`.
The one file to read before touching anything. Written 2026-08-04.

## State

| | |
|---|---|
| Branch | `claude/continue-codex-unfinished-2026-08-02` |
| Vercel production | **`cd60b3c`** — `/api/build` confirms it |
| Railway `degenaration-bot` | **`543e419`**; `server/bot` is byte-identical at HEAD, which is why Railway correctly skipped the later rebuilds |
| Railway `degenaration-worker` | **never deployed.** No source connected, last deployment 2026-07-08, `DELEGATED_SIGNING=off`, `WORKER_NET=devnet` |
| Suite | `npm run check` exit 0 — **295 tests**, 34 verifiers, 6 contract gates, 11 surfaces × 4 widths, production build 65 pages |
| Edge functions | `app-bridge` v13, `bot-bridge` v4 |
| Migrations | **thirteen applied**, each verified by `md5(prosrc)` against this repository |
| Bot-control contract | **32 enforced / 23 pending** (was 13 / 33 at the start of this work) |

## Session 2026-08-06 — the capital figures, the listener, and two defects I introduced

### The minimum-capital calculation

The builder rendered "Maximum exposure 0.50 SOL" directly above "Minimum planned capital
5.50 SOL" for one configuration. The expressions were inline, three hundred lines apart, and
only one counted DCA. `lib/planned-capital.js` is now the only implementation, in integer
lamports:

```
perPosition = entry + every ENABLED DCA allocation
planned     = perPosition × maximumOpenTrades
```

Exits are excluded — they close a position, they do not fund one. The rent and fee reserve is
reported separately. The screen shows the working, because a total with no derivation is what
let 0.50 and 5.50 sit together unnoticed.

It also exposed a third defect: the default per-token exposure is 0.50 against a 0.55 position,
so the entry claims and the first DCA leg is refused, leaving the position half-built. Now a
blocking validation error naming both numbers.

**A correction to my own work.** I first asserted the double path was inexact here. It is not —
`0.05 + 0.25 + 0.25` is exactly 0.55, and a search over 232,000 in-range combinations found no
case where the old path disagreed after rounding. The test says so. Integer arithmetic is the
specification's requirement made into a guarantee, not a rounding bug that was shipping.

### Two defects I introduced earlier in this work, found by auditing production

| What | How it was found |
|---|---|
| Six `LimitField` switches shipped at **25×44** — a third of the minimum wide | An audit against the deployed site. `verify:responsive` never covered the builder routes, the densest surfaces in the product. Both are now in it: 11 surfaces × 4 widths, 44 screenshots |
| `worker.js` never passed `subscriberExecution` to the call watcher | Reading the worker while assessing E-3. The resolver existed, the engine accepted it, every unit test passed — and the priority-fee cap and quote window would have resolved to null in production, because the dependency defaults to "not configured" |

### An emoji flag that was right to leave alone

The production audit reported an emoji on the Discord builder. It was `🍆` inside a Discord
**channel name** the owner's server actually uses. The rule forbids emoji as an interface icon —
our icon language — not text we relay from someone else, and stripping it would have shown a
channel that does not exist. The detector now measures our own copy only, scoped per element by
`data-user-content` rather than blanket, so a real emoji icon in a dropdown still fails.

### Registered-channel enforcement, observed live

A message arrived in an **unapproved** channel on the new listener build:
`messagesReceived: 1`, `emptyPayload: 0` — so it had content, which is live proof of the Message
Content intent on this build — and `unapprovedMessages: 1`. It created nothing: `raw_signals`
still 3 with its newest row hours older, `calls` 1, `parsed_signals` 3, `trade_intents` 0,
`call_executions` 0.

### What E-3 actually is

The worker service already holds Privy delegated-signing credentials. The signer was never the
blocker. What is missing is a connected source and the deliberate act of enabling signing —
`server/worker.js` gates the entire trading stack behind `DELEGATED_SIGNING === "on"`, so
watch-only cannot claim, sign or trade.

## Session 2026-08-05, fourth pass — the switches became real, and the two gates were reconciled

Four commits, `4c69e4e`..`a173ed8`, all deployed. The bot-control contract went from
**13 enforced / 33 pending** to **31 / 24**.

### What was wrong

| Where | Defect | How it presented |
|---|---|---|
| `worker_claim_call_execution` | Maximum open trades, maximum capital, per-token exposure, the token cooldown and first-call-only were persisted, versioned, reloaded into the editor — and enforced by **nothing**. One limit existed: the daily cap | A bot set to "maximum open trades 3" would open thirty, and the editor showed 3 every time |
| `bot_ingest_discord_signal_v2` | The journal's gate checked the CHANNEL row and left-joined the source for its name only, while the listener's cached map checked the source's approval state too. **The two gates disagreed** | Removing a source did not stop calls until the cache refreshed — and the gate would have accepted them even then |
| `admin_decide_call_channel` | Approving a channel on a previously REMOVED source set `active = true` and left `verification_status`, `removed_at`, `suspended_at` untouched | Ingestion resumed from a source removed for cause while every marketplace surface, which reads `verification_status`, kept it hidden |
| `monitor.js` | `takeProfit.trailing` had no reader. Per-level `trailingBps` applied whether the master was on or off | A user who switched trailing off still had levels that armed at the target and waited for a retracement |
| `jupiter.js` | `prioritizationFeeLamports` was hard-coded `"auto"`, and the engine applied its own quote window to every bot | The priority-fee strategy, its cap, and the quote expiry could not affect a submission |
| `attach_call_execution_config` | RAISED on any insert for a subscription with `kill_switch = true` | **The emergency stop could not write the row explaining why it stopped.** `calls.js` caught a generic CLAIM_ERROR and the journal recorded nothing — indistinguishable from a broken worker |
| `app_user_save_bot` | Writes fourteen columns and not `kill_switch`, while the versioning trigger builds the snapshot's `killSwitch` from that column | The new emergency-stop switch would have been decorative — the same defect, reintroduced by its own fix |
| `server/bot/store.js` | The approved-channel fallback queried `call_channels?status=eq.approved`: no `removed_at`, no group join | **A bridge outage WIDENED what the listener watched.** Removed; it keeps its last known good map, which can only be narrower |

### Why the enforcement is in SQL

Every entry limit is a question about a SET of executions. A check in the worker before the
claim is not merely slower, it is wrong: ten calls in one tick each read "0 open trades" and
each claim. `worker_claim_call_execution` already takes `for update` on the subscription and is
the instant capital stops being free, so the limit is now atomic against a burst, a retry and a
second worker instance — and there is exactly one implementation rather than a JS pre-check and
a SQL backstop that would drift.

`check:bot-control-contract` was extended to accept that one NAMED file as an execution file,
listed file by file rather than by directory, with the reason recorded in
`lib/bot-control-contract.js`. Widening it to a `supabase/` glob would restore the mistake it
exists to catch.

### The limit switches

The specification requires an ON/OFF control per limit. The number cannot simply be cleared —
`subscriber_config_valid` requires several of them present and numeric — so `config.limits` is
the flag layer the claim reads before applying each cap. Absent reads as ON. The daily cap keeps
**accruing** while its switch is off, so turning it back on does not hand the bot a fresh day's
budget it has already spent.

### New gates

| Gate | Properties | What its control run proves |
|---|---|---|
| `verify:bot-entry-limits` | 19 | Reinstalling the shipped claim body lets a third entry through a maximum of two |
| `verify:registered-channel` | 13 | Reinstalling the previous gate accepts and journals a call from a REMOVED source |

`verify:registered-channel` also found, through its own control run, that reapplying the
17-argument predecessor without dropping the 18-argument function makes **every** call raise
"function is not unique". That is now its own property, and the rollback script drops the wide
signature first in both directions.

### The one step not applied

`degenaration-bot` on Railway builds from GitHub (`server/bot`) and did not pick up the push.
Forcing it through the Railway MCP tool would upload a tarball and **replace the service's
GitHub source**, which is a configuration change nobody asked for, so it was not done.

Nothing is half-deployed. The live listener was verified healthy across the migration —
`watchedChannels: 2`, `deadLetters: 0`, "messages are arriving in watched channels and being
parsed" — because the rebuilt `bot_approved_call_channels` serves it the correct narrower set,
and a caller that sends no guild is accepted and recorded as having sent none.

What the listener deploy would add: the guild/channel pair checked at the listener as well as at
the gate, and the removal of the widening fallback. Both are already enforced server-side.

## Requirements, against §17 acceptance

### Financial — §5

| Requirement | Status | Evidence / exact remainder |
|---|---|---|
| One authoritative balance model | PASS | `docs/ai/ACCOUNTING_MODEL.md`; `verify:withdrawable-state`, 12 properties |
| Wallet identity from the verified session | PASS, **deployed** | `2ef4d03`; `verify:wallet-registration`, 12 properties |
| Durable trade intents, capital reserved | PASS | `fcebe9c`; `verify:trade-intent-fanout`, 12 properties |
| Abandoned-intent recovery | PASS | `52dbc28`; `verify:intent-reconciliation`, 5 properties |
| Execution and settlement writer | PASS | `d554243`; `verify:settlement-writer`, 8 properties |
| Partial exits, realized PnL, position close | PASS | `a428857`; `verify:exit-settlement`, 13 properties |
| Principal withdrawal, idempotent | PASS (code) | `verify:withdrawal-idempotency`; local-validator transaction passes. Signed-in UI unproven — **E-6** |
| 200 bps per confirmed leg | PASS (code) | `verify:fee-ledger`, `verify:creator-referral`. Collects 0 bps in production — **E-4** |
| Creator / referral / platform allocation | PASS | `7480b4c`; four balanced entries summing to exactly the collected fee |
| `cash_movements` written | **FAIL** | No writer. Needs the withdrawal path to run against a real wallet — E-6/E-3 |

### Auto-trading — §6

| Requirement | Status | Remainder |
|---|---|---|
| Signal → intent → execution → settlement → fees → position | PASS (code), never executed | **E-3** worker host and signer |
| Subscriber fan-out | PASS | `5c1012a`; `verify:signal-fanout` |
| Duplicate-signal and duplicate-trade protection | PASS | content-hash dedupe; unique `entry_sig`; idempotent settle |
| Staging/devnet proof | **BLOCKED** | E-3. §6 is explicit that this is not PASS without it |
| `AUTOMATED_MAINNET_RELEASE` | disabled, by design | Requires the controlled approval gate |

### Admin console — §8

| Requirement | Status | Remainder |
|---|---|---|
| Server-side admin only, three-deep | PASS | `requireAdmin` → legacy refusal → `require_app_admin` |
| Client table: balances, volume, positions, fees, bots | PASS | `370e07d` mounted it — it existed and was imported by nothing |
| Performance refresh | PASS | `admin_refresh_performance`, Clients tab |
| Client **detail** view | PASS | `admin_client_detail` + `ClientDetail.tsx`, opened from the table. Balances, wallet history, positions with lots and exits, executions, withdrawals, movements, commissions, referrals, bots, failures, audit events. `verify:admin-client-ledger`, 7 detail properties |
| Audited actions, audit log | PASS | Existing console sections |
| No balance editor, no secrets | PASS | Deliberate; recorded on screen |

### UI and parity — §11–13

`docs/ai/MIZAR_PARITY_MATRIX.md` is the row-level authority. Every remaining row's remainder
is authenticated browser evidence (**E-6**) except the KOL DEX list, which needs worker
enforcement (E-3). The losing PnL card was BLOCKED and is now PARTIAL: `261bab4` gave it the
position-to-exit relationship it was missing.

### Commands and skills — §14

PASS. `.claude/commands/` holds `degenaration-goal`, `fullscan`, `finance-gate`, `mizar-ui`,
`admin-console`, `release-audit`. `.claude/skills/` holds the five named skills. `/goal` is
reserved by the harness, so `/degenaration-goal` is used as §14 permits.

## The §4 scan

`docs/ai/FULL_SCAN_2026-08-04.md`. One product defect was found and fixed in the same pass:
thirteen retired trading surfaces that navigation and robots.txt had stopped advertising but
that still served working pages (`b7ff573`). Everything else was already passing or blocked.

## The defect class that produced most of this work

Four times, the root cause was **a table several surfaces read and nothing writes**. It never
raises: a left join renders a dash. `trade_intents`, then `trade_executions` / `positions` /
`position_lots`, then `signal_deliveries`, then `performance_snapshots`. When something shows
a dash or a zero here, check the writer before checking the reader.

## External blockers — nothing in the repository lifts these

| ID | Blocker | Owner action |
|---|---|---|
| E-2 | Discord bot not deployed | Deploy with bot credentials |
| E-3 | No worker host, no signer | Provision host + signing configuration |
| E-4 | `PLATFORM_FEE_ACCOUNT` unset | A valid Jupiter output-mint fee **token account**, not a wallet |
| ~~E-6~~ | ~~No signed-in Privy session~~ | **CLOSED 2026-08-05** — captured; see `AUTHENTICATED_EVIDENCE_2026-08-05.md` |
| **E-7** | **Application not deployed** — production is `29291c9`, ~80 commits behind | Deploy the app. Every remaining authenticated defect is already fixed in code and closes on deploy |
| — | `78a4af0` promotion | Explicit approval; irreversible |

## Session 2026-08-06 — Admin Revenue, RUN, and the fifth unwritten table

Eight commits, `20b488a`..`1043b1e`. Migrations **19, 20, 21 and 22 authored, applied and
verified**; app-bridge **v16**; production application at `1043b1e`.

### Section 3 — Admin Revenue and Withdraw fees

`admin_revenue_summary` (migration 18, applied) and `admin_open_revenue_withdrawal` +
signature/settle/list (migration 21, applied). Both surfaced in a new owner-only Revenue tab.

The withdrawal ledger is a **fourth** money table, deliberately. Reusing `payout_requests` —
the obvious candidate, and what an earlier draft of the summary did — would report CREATOR
payouts as company withdrawals and double-count the creator allocation that
`creator_fee_lamports` already removes once. It draws against `sum(retained_fee_lamports)` and
nothing else, so it cannot reach client principal or the creator and referral shares by
construction rather than by policy.

Two defects the fixture caught before either shipped:

| Where | Defect |
|---|---|
| `admin_revenue_summary` | filtered creator payouts on `status = 'paid'`, which the CHECK does not permit — it allows requested/reviewing/approved/processing/confirmed/failed/rejected/reversed. Would have reported 0 for ever while looking correct |
| `21-revenue-withdrawal.sql` | the refusal guard was one `IF` with a subquery in it. PL/pgSQL plans an IF condition as a single SQL expression, so `to_regclass(...) is not null and exists (select 1 from t)` resolves the table at plan time and fails on the rerun after the drop — the guard would have broken the rerun-safety it is part of |

**`trade_executions` has no `fee_mint` column.** Its fee columns are lamports with no
denomination anywhere on the row, so a per-mint revenue figure cannot be sourced from it.
`revenue_available` returns **NULL — not answerable** for any mint other than wSOL, and the
open refuses on NULL. Zero would have been equally wrong: it reads as "nothing earned yet", and
an operator would have withdrawn the wSOL total under a USDC label.

### Sections 4 and 5 — the simple first screen, RUN, and Save and use later

The three strings the directive names as failed acceptance evidence are gone. Not reworded:
all three were computed on the CLIENT from a frozen constant, so a user with no wallet, a user
4.5 SOL short and a user whose only blocker was the fee account read the identical sentence.

`lib/bot-readiness.js` replaces them with fourteen ordered checks. RUN shows exactly one — the
first failure — and the order runs from "the user can fix this now" to "only an operator can",
because telling someone the fee account is not ready while their wallet is unconnected makes
them wait for us when the fix was theirs. Unknown facts fail closed; a check that throws fails
closed. A test asserts six different faults give six DISTINCT messages.

`lib/bot-states.js` adds the eight states. `Validated` and `Ready` are DERIVED from a draft,
never stored — storing "Ready" freezes a verdict that goes stale the moment the worker, the fee
account or the balance changes. `Exit-only` is the stored `stopping`, projected rather than
migrated.

The builder now shows Buy amount, Take profit, Stop loss and Auto re-entry first, with
everything else behind one collapsed `Optional settings` group.

### `worker_leases` — the fifth table nothing writes, and the first to produce a FALSE INFERENCE

"Is the worker healthy?" had no answerable form. `public.worker_heartbeat` has been deployed
since `degenaration-product-rpcs.sql` and **had never been called by anything**.

The other four unwritten tables rendered a dash. This one was read as a **measurement**:
`docs/coordination/IMPLEMENTATION_STATUS.md` cited `worker_leases`=0 as proof "the worker has
never run", which was sound when written and is now wrong — the worker is live with signing
enabled. Both citations are corrected in place rather than deleted.

`server/worker.js` now heartbeats every 30s against a 90s lease. Heartbeat failure is counted
and logged and stops nothing: a worker that cannot write a status row can still be mid-exit on
a real position.

### Migration 19 — auto re-entry, and why it is not `firstCallOnly` renamed

Section 4's one new control. The risk with a new entry switch is not that it fails to refuse;
it is that it refuses in the same circumstances as an existing one, giving two controls one
meaning. `firstCallOnly` is about the SIGNAL (a repeat call for a token already acted on);
`autoReentry` is about the POSITION (a fresh entry after one has closed). The test asserts the
middle behaviour that proves them distinct: with auto re-entry off and first-call-only off, a
second call while the position is still OPEN is still allowed.

Contract: **37 enforced / 19 pending**, from 36/19.

### Migration 22 — DCA placement, the only unenforced control that reserved the user's money

`dca.enabled`, `dca.levels`, `dca.expirationMinutes` and `dca.maximumEntries` were persisted,
validated, versioned, reloaded, **counted toward the minimum planned capital the builder tells
the user to fund** — and never placed. A bot with a 0.05 entry and two 0.25 levels asked for
0.55 SOL per position and spent 0.05. Every other pending control cost the user nothing.

`server/engine/dca.js` is the pure decision; `worker_record_dca_fill` is the write. The unit is
pinned by test: `dropBps` is an additional drop below the position's **average entry**, not
below the previous level's price — read the other way, levels at 3000 and 5000 place the second
at −65% instead of −50%. Same class as the take-profit unit defect that liquidated at entry.

Four ways adding to a position corrupts its exit plan, all closed and all asserted: the average
entry is volume-weighted, `original_amount_raw` grows so take-profit shares stay the size the
user configured, the peak is rebased so trailing does not fire against a drawdown that never
happened, and a stale stop breach is cleared. The fill goes through the **same guarded path an
entry takes** — quote, bind quote to intent, freshness, simulate, sign under policy — bounded
by that level's own allocation.

**Two defects the gates caught before apply.** `positions.opened_at` does not exist in
production (only in `degenaration-product-ledgers-operations.sql`), so the worker would have
taken a 400 on its first read of every tick — `check:worker-schema-contract`'s third real
catch. And `positions.updated_at` does not exist either, so the migration would have failed to
apply; the fixture caught that one, because it is generated from the captured production shape
rather than written by hand.

Contract: **41 enforced / 15 pending**, from 37/19.

### What is blocked, and by what

| | |
|---|---|
| **Worker redeploy** | The Railway MCP connection lost its project link this session and every project-scoped tool refuses with "No linked project". The heartbeat code is committed and pushed at `26128f4`; until the worker redeploys, `worker_leases` stays empty and RUN correctly reports the execution service as not reporting. **Owner action: redeploy `degenaration-worker`,** or confirm it auto-deploys from this branch |
| E-2 | one Discord message that stays up in an approved channel |
| E-4 | the fee-account ATA — the final irreversible owner action |

---

## Session 2026-08-05, third pass — deployed, observable, and what is genuinely left

Production now serves current code (`/api/build` reports it), the Discord listener is
observable, and every milestone of `DEGENARATION_FINAL_GOAL_4000.md` is complete to the limit
of what does not need a credential.

### Defects found and fixed in this pass

| Where | Defect | How it would have surfaced |
|---|---|---|
| `server/bot/index.js` | `log()` wrote bare `JSON.stringify(...)`. Railway parses a valid-JSON line into attributes and leaves `message` **empty** — every structured event rendered as a blank line and matched no text search | The listener looked silent for a week while it was logging. Most of why E-2 took three rounds |
| `server/bot/handlers.js` | A no-mint message ended in a bare `return null` | Gateway-never-delivered, channel-unreadable and parser-found-nothing produced *identical* evidence |
| `server/bot/store.js` | The listener never synced guild profiles — only the legacy `degencalls` did | Retiring `degencalls` would have frozen every marketplace avatar and member count, silently |
| `lib/publicSource.ts` + source profile | Call price, market cap and liquidity were never surfaced; `called_liquidity_usd` was not even selected | The per-call history showed a token and a multiple with no price it was called at |
| `app/not-found.tsx`, `app/error.tsx` | Brand wordmark was a 32px tap target | Under the minimum on every 404 |
| source profile table | `Risk report`, the row's only action, was **16px** tall | Under a third of the minimum at 390px |
| `server/engine/jupiter.js` | `Math.floor(sol * 1e9)` — the last float money arithmetic in the engine | A user configuring 1.001 SOL bought 1.000999999. **271** values in the offered range diverge |

### Two of my own measurements were wrong, and both are recorded

The responsive audit was pointed at `/source/alpha-desk`, a slug that does not exist, so it
measured the **404 page** at four widths while reporting `source-profile` — its readiness
predicate (`innerText.length > 200`) was weak enough to let that through. Fixed to a real slug
asserting the profile's own heading, after which it immediately found the 16px Risk-report
link.

The buy-size defect was first written up citing `0.29 SOL`; the test failed because
`Math.floor(0.29 * 1e9)` is 290000000. The defect is real, the example was not, so the offered
range was searched for a case that genuinely holds rather than adjusting the assertion to fit.

### Where each milestone stands

| # | Milestone | State |
|---|---|---|
| 1 | Discord | Chain proven end to end by `verify:discord-replay` against real PostgreSQL, driving the deployed handlers. Listener observable and syncing profiles. **Residual: one `MESSAGE_CREATE` observation** |
| 2 | Marketplace | Call price / market cap / liquidity added and **deployed**. Aggregates, distribution, best/worst, 1D/7D/30D, peak *and* current return all present; unknowns say Collecting data |
| 3 | Settings + auto-trading | Settings reach the intent snapshot and the quote — traced, not assumed. Unsigned mainnet simulation PASS (72,071 CU). Signing and submission boundaries need **E-3** to exercise |
| 4 | Mizar UI | Builder order, disclosure and gating PASS on the deployed build. Responsive audit clean across **9 surfaces × 4 widths** |
| 5 | Portfolio / PnL / Admin | Verified signed in. PnL cards need one settled position — **E-3**, not a UI gap |
| 6 | Deploy + verify | No verified fix left undeployed. `npm run check` exit 0 |

## Session 2026-08-05, second pass — composing the stages, and what that found

Five commits, `21361f9`..`e9aa8c3`. Every one of them found a defect in code **already live in
production**, and every one was found the same way: by making two stages that each had a
passing verifier run against each other for the first time.

| # | Defect | Where it would have surfaced | Fix |
|---|---|---|---|
| 1 | `fan_out_parsed_signal` joined `call_channels.channel_id = raw_signals.source_ref`, and ingestion writes `source_ref` as `discord:<guild>:<channel>`. **The join can never match.** | On the first automated call, silently. The call journals as accepted, the marketplace counts it, and it reaches **zero** subscribers — `fan_out_on_parse` is an AFTER INSERT trigger that discards the return value | migration 8 |
| 2 | The edit branch superseded the previous call **before** the same-token cooldown could refuse the edit. When it refuses, the previous call is retracted with no successor, and the response says `accepted:false, "duplicate"` | Silently. A measured call disappears from a source's record. Also a lever: call a winner, then within 60s edit an older losing message to name it, and the loss is erased | migration 9 |
| 3 | Every marketplace return figure was a **peak** multiple, with nothing saying so. `current_x` was computed per call and used only for drawdown | On every card. A source whose ten calls each touched 2x and went to zero reads `Win rate 100% · Average return 2.00x` | migration 10 |
| 4 | **33 of 44 bot controls save, version, reload — and change nothing.** Per-token exposure, max open trades, max capital, priority-fee cap, retries, quote expiry, cooldown, simulation, dynamic stop, stop delay, freeze-after-stop, emergency exit, trailing TP, the whole KOL trigger, DCA, scanner cadence | Silently, forever. The control persists, so the editor shows the user their own value back | `check:bot-control-contract` + truthful notices |
| 5 | `admin-dashboard-secret-rpcs.sql` ends with `grant execute ... to anon, authenticated` on all five admin functions, two of which approve or reject a Discord source — three lines below revoking them | **Not in production** (a later migration revoked them). In the file, on any replay: a rebuild, a new environment or a disaster restore re-grants the admin API to anonymous callers | both files corrected |

### Why these were invisible until now

Each stage had a verifier and none of them proved the stages **compose**. `verify:discord-
ingestion` starts at the RPC, one step after the listener; `verify:signal-fanout` starts at
`parsed_signals`, one step after that. And the listener's own decision logic was unreachable
by any test at all, because `index.js` registered its handlers at module scope and called
`client.login()` on import — so the exact code deployed to Railway was the one stage nothing
had ever executed outside production.

Defect 1 was green for weeks because `verify:signal-fanout`'s fixture wrote
`source_ref = 'chan-1'`, a bare channel id ingestion has never once produced. **The fixture
agreed with the reader instead of with the writer.**

### New gates

| Gate | What it makes impossible |
|---|---|
| `verify:discord-replay` | The chain breaking between stages. Drives 10 stored Discord events through the real handlers, payload builder, route transformation and RPC into the journal, the call price, fan-out and the config snapshot. Its control run reproduces defect 1 |
| `check:bot-control-contract` | A control that persists and changes nothing. Undeclared controls fail; enforced claims must resolve to a real token **and terminate in an execution file**; pending controls must stay unread, so implementing one forces its promotion |
| `check:admin-authorization` | A balance editor, an unpinned `search_path`, and a grant to `anon` anywhere in a file that defines an admin function. Control run confirms it fires |
| `verify:responsive` | A UI change shipping unverified. Headless Chrome against a local build with a stubbed API: 4 surfaces × 4 widths, zero overflow, zero sub-44px targets, peak **and** current return both on screen, no console errors, 16 screenshots |

Two extractions made three of those possible: `server/bot/handlers.js` (the listener's
decisions, previously unimportable) and `lib/discord-ingest.js` (the route's decisions,
previously inside a `.ts` body the plain-node runner cannot require).

### Corrections to this repository's own record

- `PENDING_DEPLOYMENT.md` claimed every admin RPC pins `search_path` to the empty string,
  "0 exceptions". **Four pin it to `public, pg_temp`.** `pg_temp` is last, which is the
  documented mitigation, but it is not what was claimed.
- `lib/call-outcomes.js` has no production consumer and is now one definition behind the SQL;
  it says so, so nobody wires it up without closing the gap.

### Migrations 8, 9 and 10 — APPLIED 2026-08-05

Owner approved and applied sequentially, each verified before the next. All `create or replace`
at unchanged arity: no DDL, no DML, no grant change, every row count identical to the pre-flight
baseline, `mainnet_execution_enabled` still `false`, nothing signed or broadcast.

Migration 8 has a functional proof on the real production row rather than a parse: the source
reference the old join could never match now resolves to its approved group. Migration 10's new
aggregates were executed against real rows — the source with one flat call reports
`currentWinRate 0.00`, and the source with none reports `measuredCurrent 0` with all three
statistics **null** rather than fabricated zeros.

Full record, including the digests and the before/after counts, in `PENDING_DEPLOYMENT.md`.
Executable rollbacks remain for all three; `verify:migration-rollback` covers ten migrations.

## Session 2026-08-05 — deployment, rollback, and the PnL unit defect

Four commits, `c70b6f3`..`71afaaa`. The database half of this project is now deployed.

**Parts B and C shipped.** The owner approved the package; all seven migrations were applied
one at a time, each verified before the next was started, and `app-bridge` went to **v13**.
Verification was stronger than "the object exists": `scripts/deploy-checksums.mjs` applies
the package to PGlite from the files on disk and emits a query asking production for
`md5(prosrc)` of every function it defines. All seven returned empty — 22 function bodies
byte-identical to this repository. `worker_load_submitted_executions(5)` was **executed**
against production, not merely parsed. Full per-migration record in `PENDING_DEPLOYMENT.md`.

**Three defects were found and fixed before they shipped**, all of the same shape this
project keeps hitting — two individually correct halves never checked against each other:

| # | Defect | How it would have surfaced |
|---|---|---|
| 1 | The documented rollback for `exit-plan-state` leaves BOTH function arities installed, because `create or replace` at a different arity creates an overload. Every worker call would then fail *"function is not unique"* | only during an incident, when rolling back — leaving the worker unable to open **or** settle any position, with no further rollback to recover with |
| 2 | The same migration's `worker_load_submitted_executions` was written from `buy-settlement` without noticing `copy-execution-integrity` had superseded it hours later with a union over `copy_executions` | silently: `store.js:173` dispatches on `execution.source`, so every submitted **copy** execution would stop being returned, never settle, and hold its reserved capital forever with nothing raising |
| 3 | The PnL card computed average entry twice — the open branch applied `10^decimals`, the closed branch did not | the same "AVERAGE ENTRY" label reading `2.0000 SOL` open and `2.0000e-9 SOL` closed, on an image the user publishes under their own name |

### New gates

- `verify:migration-rollback` — applies the package, rolls it back through executable
  scripts in `supabase/rollback/`, asserts a byte-identical baseline catalog including
  function bodies, re-applies, and proves via control run that the previously documented
  prose rollback was broken. Nine properties.
- `scripts/deploy-checksums.mjs` — production must match the repository, function body by
  function body. Existence is not the same as correctness.
- `lib/pnl-card.js` + 26 tests — the card's arithmetic was untestable because it lived in an
  async route and `server/test/run.js` is synchronous by design. It says so, and says what
  to do instead: extract the pure logic.

## Exact next dependency

**None that is internally solvable.** Every remaining §17 acceptance item needs a credential,
a host, or a signed-in session:

- auto-trading staging/devnet proof → E-3
- fee collection → E-4
- Discord ingestion and command state → E-2
- every remaining parity row and browser evidence item → E-6
- `cash_movements` → the withdrawal path running against a real wallet, E-6/E-3
- ~~the unapplied migrations and app-bridge~~ → **DONE 2026-08-05.** All seven applied and
  app-bridge is v13; see `PENDING_DEPLOYMENT.md`

The correct next action is the owner's: approve the deployment package, or supply one of the
four blockers above.

**Deployment is reachable from this environment**, through the Supabase MCP connection —
there is no CLI and no credential in the shell, but the MCP tools can apply a migration and
deploy an edge function. So the gate is not capability; it is the owner's standing
instruction not to make an irreversible production change without explicit approval. Saying
"it cannot be done from here" would be false.

Step 12 is written and ready: `docs/ai/POST_DEPLOY_VERIFICATION.md`, with the production
baseline read before deployment so the after-comparison is against a record rather than a
memory.

---

## Session 2026-08-04, second pass — controller milestones 1–7

Seven commits, `fb2ee6b`..`ca4eb43`. Every one closed a defect where two individually
correct halves had never been checked against each other. That is now the confirmed
signature of this codebase's failure mode, and three of the seven fixes are gates rather
than patches, so the class is narrowing rather than recurring.

| # | Finding | Where it would have surfaced |
|---|---|---|
| 1 | Discord edit/delete ingestion had no caller; embeds and webhook messages were never read; one failed POST lost a call permanently | silently — `raw_signals` stays 0 and looks like a quiet channel |
| 2 | "Win rate" was the 2x rate on one page and labelled correctly on another; no `-50%` bucket, so a rug and a +40% call shared a cell | on every marketplace card, understating every source |
| 3 | The worker reads three columns that do not exist in production; the migration adding them was in no deployment package | 400 on the worker's first subscriber load, every tick |
| 4a | **Take-profit fired at 2% of entry, not 2x** — the writer stores a multiple, the reader divided by 100 | 75% of every position liquidated at entry, immediately |
| 4b | Multi-level TP, trailing TP and trailing stops were collected, validated, persisted — and read by nothing | controls that do nothing, silently |
| 5 | The client table could not say whether a client's volume was today or last month | an operator judging activity on a lifetime number |
| 7 | `cash_movements` had no writer; a submitted withdrawal never settled | history empty, and the user's spendable headroom reduced permanently |

**4a is the one that mattered most.** No user was affected — `public.positions` has 0 rows
and the worker has never run — but it would have been the first thing to happen after
deploying it, and the test suite was green because the fixture used the same wrong unit as
the reader.

### New gates

- `check:worker-schema-contract` — every column the worker reads must exist in production
  or in the deployment package. Fired on the real defect before the package was corrected.
- `verify:exit-plan-state` — caught, on its first run, that adding a defaulted argument
  creates an overload rather than a replacement, after which the old call fails with
  "function is not unique". Both superseded signatures are now dropped explicitly.
- `verify:withdrawal-settlement` — asserts the released headroom against the real
  withdrawable-state function, not against the intent row.

### What did not change

Milestones 6 (Mizar parity) and the UI half of 7 (PnL card rendering) are unchanged, and
deliberately so: `MIZAR_PARITY_MATRIX.md` establishes that §11 is implemented and that every
remaining PARTIAL row needs a signed-in Privy session (**E-6**), not more interface code.
Writing more UI would not close a single row.
