# Final execution handoff

Required by §3 of `docs/ai/DEGENARATION_FINAL_FULLSCAN_FINANCE_ADMIN_MIZAR_UI_CLAUDE_PROMPT.md`.
The one file to read before touching anything. Written 2026-08-04.

## State

| | |
|---|---|
| Repository root | `/Users/axell/Documents/degenaration` |
| Branch | `claude/continue-codex-unfinished-2026-08-02` |
| Commit | `ca4eb43` |
| Suite | `npm run check` exit 0 — **213 tests**, 27 verifier suites, 2 contract gates |
| Modified, uncommitted | `docs/activity-log.md` (excluded from commits by policy) |
| Untracked | none |
| Deployed edge functions | `app-bridge` **v11**, `bot-bridge` |
| Migrations unapplied | **seven** — `docs/ai/PENDING_DEPLOYMENT.md`, status re-read from production 2026-08-04. Eleven previously listed as pending are in fact applied; three that were never listed were not, and three more were written in this session. |
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

## Exact next dependency

**None that is internally solvable.** Every remaining §17 acceptance item needs a credential,
a host, or a signed-in session:

- auto-trading staging/devnet proof → E-3
- fee collection → E-4
- Discord ingestion and command state → E-2
- every remaining parity row and browser evidence item → E-6
- `cash_movements` → the withdrawal path running against a real wallet, E-6/E-3
- the ten unapplied migrations and app-bridge v12 → owner approval, `PENDING_DEPLOYMENT.md`

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
