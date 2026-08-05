# Open blockers

Updated: 2026-08-04

External requirements are E-*. I-* are internal decisions that belong to the owner because
they change which record is authoritative for money — implementable, but not silently.

## Owner decisions

### I-1 — Two position ledgers exist and only one is written — **DECIDED 2026-08-04**

**Resolved as a decision. `app_private` is authoritative; the worker's journal is demoted to
an operational queue. The full inventory, rationale, formulas, invariants and a six-step
implementation sequence are in `docs/ai/ACCOUNTING_MODEL.md`.**

The inventory made the choice one-sided rather than balanced: `app_private.call_executions`
has **no fee column of any kind** and stores `amount_sol` as floating point, so World B
cannot carry the spec's invariants without being rebuilt into World A. And the problem is
wider than positions — `trade_intents`, `trade_executions`, `positions`, `position_lots`,
`cash_movements` and `performance_snapshots` **all** have zero writers, which means the
entire 200 bps fee apparatus is correct code hung on a table nothing writes.

The single most urgent consequence, not previously recorded: `app_user_withdrawable_state`
derives locked capital from `trade_intents`, so `lockedLamports` is **structurally always
zero** — a user can withdraw SOL the worker has already committed to a buy. Step 2 of the
sequence closes it.

**All six writers now exist.** `trade_intents` (`fcebe9c`), `trade_executions` /
`positions` / `position_lots` (`d554243`), `position_exits` (`a428857`),
`performance_snapshots` (`cbeabe5`). `cash_movements` remains unwritten and is the one item
of this blocker still open — it needs the withdrawal path to run against a real wallet
(E-6/E-3), not a decision. Every other consequence recorded here is closed and covered by a
verifier; none of the migrations is applied to production yet — `PENDING_DEPLOYMENT.md`.

The original framing is kept below for history.

---

`app_private.positions` and `app_private.position_lots` are the product ledger. The
Portfolio positions tab, the position PnL card, the admin open-position count and the bot
archival guard all read them. **Nothing inserts into either** — there is no INSERT in
`supabase/`, `server/`, `app/` or `lib/`. The worker opens positions in `public.positions`
through the deployed `public.worker_open_position`.

Consequences, in order of severity:

1. The bot archival guard could not fire, so a bot holding open funded positions archived
   cleanly. **Fixed** in `37d5e19` by checking both ledgers, which fails closed whichever
   ledger becomes authoritative.
2. The Portfolio positions tab would stay empty even with a deployed, trading worker.
3. Position PnL cards can never be produced for real trades.
4. `position_lots` is the lot ledger that would yield average entry and exit prices. It is
   never populated, which is the true root cause behind Priority 5 being recorded as
   BLOCKED — not a missing computation, a missing writer.

The decision: which ledger is authoritative? Either the worker writes the product ledger
(entry/exit legs, lots, executions — the richer model the Portfolio was designed against),
or the product read model projects `public.positions` (smaller change, loses the lot
model and with it durable average entry and exit prices).

Claude did not choose. Unifying them changes which record is authoritative for user money,
and no reversible half-measure exists.

**New evidence from the 2026-08-04 live audit, which narrows this decision considerably.**

Every financial table in production is empty — `trade_intents`, `trade_executions`, both
`positions` tables, `position_lots`, `cash_movements`, `commission_ledger_entries`,
`payout_requests` and `public.trades` all have 0 rows. **There is therefore no data to
migrate and no user record to invalidate**, which removes the usual reason this decision is
irreversible. Whichever ledger is chosen, nothing has to be rewritten.

A second finding constrains it further: `app_private.trading_wallets` is empty and
`app_user_upsert_wallet` — although allowlisted and deployed — has **no call site anywhere
in the application**. The server consequently cannot name any user's wallet address; wallet
identity exists only inside the per-request Privy identity token. So today *no* server-side
balance reconciliation is possible for any user, under either ledger. Persisting the wallet
on sign-in is a prerequisite for the authoritative model, not a detail of it.

### I-2 — A credential digest is committed to the repository

`supabase/admin-dashboard-secret-rpcs.sql:14` embeds a SHA-256 digest of `ADMIN_KEY`, and
`app_private.bot_secret_ok` does the same for the bot secret in production. A digest of a
shared secret in a repository is an offline brute-force target; the secret's strength is the
only thing standing between the file and full service-role RPC access.

Not changed here, because rotating `ADMIN_KEY` invalidates every deployed caller
simultaneously (web app, worker, both edge functions) and must be sequenced by the owner.
`bot_secret_ok` was deliberately **not** reproduced when its sibling function was captured
into `supabase/degenaration-legacy-discord-call-ingestion.sql`, so this weakness was not
extended.

## External requirements

| ID | Gate | Exact external requirement | State |
| --- | --- | --- | --- |
| E-0 | **Edge-function redeploy — the funds incident** | The deployed `app-bridge` (v9, 2026-07-28) is missing four operations the app calls, including `app_user_withdrawable_state`. Until it is redeployed, **no user can withdraw and no bot can be saved.** Nothing in the repository can fix this; the correction is one deploy of `supabase/functions/app-bridge/index.ts` to project `uqccguunmjabjheeivhx` with **`verify_jwt: false`** (the deploy default is `true`, and flipping it would 401 every bridge call — a worse outage than today). Full evidence, mechanism and rollback: `docs/ai/DEPLOYMENT_DRIFT_REPORT.md`. Reproduce any time with `npm run verify:bridge-live`. | **BLOCKED — awaiting deployment approval** |
| E-1 | Migration deployment proof | Four verified migrations remain unapplied — subscriber-config versioning, bot-lifecycle safety, Discord marketplace parity, Discord call performance. Production state re-read 2026-08-04 and recorded in `PENDING_DEPLOYMENT.md`; the eleven listed as applied there were confirmed object by object. All four are rerun-safe and preserve every fixture row. **Deploy order: the subscriber-config migration must be applied before the current worker build runs**, because `server/engine/store.js` selects `kill_switch`, `subscriber_config_version_id` and `subscriber_config_snapshot`, and PostgREST answers an unknown column with 400. That is no longer only a note — `npm run check:worker-schema-contract` fails if the worker reads a column neither production nor the package provides, and it fired on exactly this before the package was corrected. | BLOCKED |
| E-2 | Live Discord ingestion proof | **Root-caused 2026-08-05, and the quarantine rule was never the blocker.** A real mint was posted in an approved channel at 08:02. The bridge counters moved `attempts 2→4, accepted 1→3`, **`quarantined` unchanged at 55** — so nothing was quarantined. Both new events were `eventType: delete` with a null mint, journaled 3.5s apart; **no create was ever forwarded**. Our own listener logged *nothing at all* while handling a slash command two minutes later, so the gateway was alive. The defect was ours: `handleDetectedCall` ended a no-mint message with a bare `return null`, making three different faults — event never delivered, channel unreadable, parser found nothing — produce identical evidence. Fixed in `fb99bd5` and **deployed**: every ignored message now logs its *shape* (counts only, never content), so `contentLength: 0` with `embeds: 0` identifies a permission/intent fault and content-with-no-mint identifies a parser result. **The two messages were deleted within seconds of posting**, which is why only deletes reached the journal. Needs one message that stays up. | BLOCKED — one owner action |
| E-3 | Production worker | Provide a worker host, RPC/indexer configuration, Privy delegated-signing credentials, health alert destination, and deployment authorization. The Railway project `degenaration-worker` exists and is empty; the **signer credential is the blocker**, and it is not something this session can create or hold. | BLOCKED |
| E-2b | Retire the legacy `degencalls` listener | **Unblocked in code 2026-08-05.** The retirement plan required the Railway listener to cover `degencalls`'s other duties first. It did not sync guild profiles — the endpoint that writes `approved_groups.avatar_url`, which is where the marketplace card's real server avatar comes from — so retiring it would have frozen every avatar, name and member count silently. Now covered: `profileSync {attempts: 2, succeeded: 2, failed: 0}` in the heartbeat, and the `profile_synced_at` timestamps `09:48:20.346` / `09:48:21.667` fall inside our boot window, so those writes are ours. Retirement still waits on the listener being seen to receive one MESSAGE_CREATE — `degencalls` is currently the only process that has forwarded anything. | READY, pending that one observation |
| E-4 | Mainnet fee collection | Create/configure the correct Jupiter output-mint fee account or referral account; a wallet address alone is not a valid per-mint fee account. | BLOCKED |
| E-5 | Mainnet activation | Explicit controlled-mainnet authorization after staging, signer, reconciliation, provider, fee, withdrawal, alerting, and emergency-control gates pass. | BLOCKED |
| E-6 | Authenticated browser evidence | **CONSUMED 2026-08-05.** The owner signed in to a remote-debugging Chrome and 32 frames were captured across 8 private routes at four widths. Record: `docs/ai/AUTHENTICATED_EVIDENCE_2026-08-05.md`. It produced three real fixes, one harness fix, and two reclassifications — the PnL cards turn out to need **E-3**, not a session, and the builder rows need the **application deployed**, because production is ~80 commits behind. | **CLOSED** |
| ~~E-7~~ | ~~Application deployment~~ | **CLOSED 2026-08-05.** Production serves `a173ed8`, confirmed by `/api/build`, together with migrations 11 and 12 and `bot-bridge` v4. Every finding listed here as awaiting a deploy is now live. | **CLOSED** |
| **E-8** | **Railway listener not redeployed** | `degenaration-bot` still runs the pre-`a173ed8` build of `server/bot`. It builds from GitHub and did not pick up the push; forcing it through the Railway MCP tool would replace the service's GitHub source with an uploaded tarball, which is a configuration change nobody asked for. **Nothing is half-deployed** — the live listener was verified healthy across the migration (`watchedChannels: 2`, `deadLetters: 0`, "messages are arriving in watched channels and being parsed"), because the rebuilt `bot_approved_call_channels` serves it the correct narrower set and a caller that sends no guild is accepted and recorded as having sent none. Redeploying adds the guild/channel pair check at the listener and removes the widening bridge fallback — both already enforced server-side. | Redeploy the service from this branch, or confirm its GitHub source may be replaced |

---

## Recovery audit, 2026-08-05 — what already exists

Performed as deployment operator. No secret value was printed, and nothing was signed,
broadcast or transferred. Findings supersede the E-2/E-3/E-4 wording above.

### E-2 — the Discord bot is ALREADY DEPLOYED and healthy

`https://degencalls.onrender.com/health?format=json`, uptime 7.4 days:

| | |
|---|---|
| `discord.ready` | **true** |
| `discord.guilds` | **2** — both approved guilds visible |
| commands | 2 attempts, **2 succeeded, 0 failed**, registered in 2 guilds |
| `source_bridge.configured` | **true**, `approvedChannels: 2` |
| `approvedRefresh` | 21,337 / 21,341 succeeded |
| `profileSync` | 53 / 61 succeeded |

Application id `1525315046303858748` (public). Commands published: `/register` (exactly one),
`/alpha`, `/degen status|profile|referral|callers|channel-add`, `/onboard`, `/help`.

**So E-2 is not "deploy a bot". The bot runs, sees both guilds and both approved channels,
and its command set is correct.** The failure is isolated to one stage:

```
"ingestion": { "attempts": 0, "accepted": 0, "failed": 0,
               "quarantined": 50, "lastAttemptAt": null }
```

**50 candidate events were quarantined and the bridge has never once attempted to forward
one.** That is the entire reason `raw_signals` is 0, and why both approved sources show no
measured performance. The other two bridge directions work, so this is not connectivity.

The quarantine decision lives inside the `degencalls` program, which is not in this
repository and is not visible under the `nolimitbw` GitHub account, so its rule cannot be
read from here. One test message in an approved channel distinguishes the two possibilities:
`quarantined` increments and `attempts` stays 0 → the bridge rejects even well-formed calls;
`attempts` becomes 1 → the chain proceeds and the journal fills.

The receiving side is deployed and correct: `POST /api/ingest-call` answers **401** without
`x-bot-secret` and **405** to GET, leaks nothing, and validates the mint on chain
(`parsed.type === "mint"`) before journaling.

### E-3 — worker host exists but is not running

`automation: {configured: false, live: false, mode: "not-configured", network: null}` from
production `/api/platform/config`. Railway project `degenaration-worker` exists; Railway
`degenaration-bot` exists with `INGEST_URL` and `SUPABASE_URL` set but **no
`DISCORD_BOT_TOKEN`**, and both its deployments are `REMOVED` since 2026-07-08. `render.yaml`
declares both services. So the hosts are provisioned; the worker has never been started with
a signer.

### E-4 — the fee account is set, and collects nothing. PROVEN ON MAINNET.

`PLATFORM_FEE_ACCOUNT` **is** set — `/api/platform/config` reports `feeWalletConfigured:
true`, `platformFeeBps: 200`. But three unsigned mainnet swap builds against production
(SOL→USDC, SOL→BONK, USDC→SOL) every one returned:

```
platformFeeBps: 0    feeAccountSet: false
```

including the sell-side, whose output is wSOL. Transactions built (752 / 916 / 1016 base64
chars) and were never signed or sent.

Tracing `lib/server/fee-account.ts`, the branch being hit is the last one: the configured
value is a **wallet**, so the resolver derives its Associated Token Account for each fee
mint and finds **the ATA is not initialised**. It then skips the fee, because charging into
an uninitialised ATA makes the swap fail on chain. That guard is correct and is why trading
still works — but the consequence is that **0 bps is collected on every trade in both
directions**.

**A second defect follows from it.** `/api/quote` reports `platformFeeBps: 200,
feeAccountSet: true`, because it uses `configuredPlatformFeeBps()` — which only tests that
the env var is non-empty. `/api/swap`, which builds what actually executes, uses
`resolveFeeAccount()` and applies **0**. So the fee shown in the preview is not the fee
charged. Users are quoted more than they pay, which is the safe direction, but the two halves
disagree — the same defect class as the rest of this project.

**The fix is one wallet action:** initialise the Associated Token Account for the fee wallet
on the fee mints — wSOL first, which covers every sell, then USDC. Rent is roughly 0.00204
SOL per account. No transfer and no swap is involved.
