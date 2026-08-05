# Final execution handoff

Required by §3 of `docs/ai/DEGENARATION_FINAL_FULLSCAN_FINANCE_ADMIN_MIZAR_UI_CLAUDE_PROMPT.md`.
The one file to read before touching anything. Written 2026-08-04.

## State

| | |
|---|---|
| Repository root | `/Users/axell/Documents/degenaration` |
| Branch | `claude/continue-codex-unfinished-2026-08-02` |
| Commit | `e9aa8c3` |
| Suite | `npm run check` exit 0 — **267 tests**, 30 verifier suites, 6 contract gates, 1 browser audit |
| Modified, uncommitted | `docs/activity-log.md` (excluded from commits by policy) |
| Untracked | none |
| Deployed edge functions | `app-bridge` **v13** (deployed 2026-08-05), `bot-bridge` v3 |
| Migrations unapplied | **three — 8, 9 and 10, added 2026-08-05 second pass.** Each corrects a defect in code that is already live; see `PENDING_DEPLOYMENT.md`. The earlier seven were applied to production 2026-08-05 with owner approval, one at a time, each verified by `md5(prosrc)` against this repository before the next was started. |
| Deployed application | `claude/degenaration-launch-remediation` @ `29291c9` — **not** `master` |
| Release awaiting promotion | `release/funds-runtime-hotfix-2026-08-04` @ `78a4af0` |

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
| E-6 | No signed-in Privy session | Walk `docs/ai/BROWSER_VERIFICATION_RUNBOOK.md` |
| — | `78a4af0` promotion | Explicit approval; irreversible |

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

### Migrations added, all awaiting approval

8, 9 and 10. All `create or replace` at unchanged arity, no DDL, no DML, no grant change.
8 and 9 are independent of everything. **10 supersedes 4 and must follow it.** Executable
rollbacks for all three; `verify:migration-rollback` now covers ten migrations.

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
