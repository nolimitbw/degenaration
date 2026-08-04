# Final execution handoff

Required by §3 of `docs/ai/DEGENARATION_FINAL_FULLSCAN_FINANCE_ADMIN_MIZAR_UI_CLAUDE_PROMPT.md`.
The one file to read before touching anything. Written 2026-08-04.

## State

| | |
|---|---|
| Repository root | `/Users/axell/Documents/degenaration` |
| Branch | `claude/continue-codex-unfinished-2026-08-02` |
| Commit | `1381464` |
| Suite | `npm run check` exit 0 — 180 tests, 24 verifier suites |
| Modified, uncommitted | `docs/activity-log.md` (excluded from commits by policy) |
| Untracked | none |
| Deployed edge functions | `app-bridge` **v11**, `bot-bridge` |
| Migrations unapplied | ten — `docs/ai/PENDING_DEPLOYMENT.md` |
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
