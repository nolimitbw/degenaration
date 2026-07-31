# Open blockers

Only genuine external blockers belong here: missing credentials, unavailable provider
access, or irreversible business decisions. Everything else is implementation work.

## B-1 — `PLATFORM_FEE_ACCOUNT` is not set (blocks fee collection end-to-end)

Every fee path is gated on this env var. When unset, `platformFeeBps` resolves to `0`
and `app/admin/commissions/page.tsx:142` surfaces "Fees are currently disabled in
production". Fee logic, ledger allocation, and tests can all be implemented and verified
against fixtures without it, but **no fee is actually collected in production until the
owner supplies the fee wallet address.**

**UPDATED 2026-07-30 — setting this is now SAFE, and there is an exact next step.**

The original danger was that `PLATFORM_FEE_ACCOUNT` must be a TOKEN ACCOUNT, not a wallet,
and Jupiter does not validate it — a wallet address would build transactions fine and then
fail EVERY SWAP on chain. Verified: a plain wallet and a known-bogus wallet were accepted
identically by Jupiter's swap endpoint.

`lib/server/fee-account.ts` (web app) and the startup probe in `server/engine/jupiter.js`
(worker) now resolve this before requesting a fee:

- configured value is already a token account for the fee mint → use it
- configured value is a wallet → derive its associated token account and use that if it
  exists on chain
- otherwise → **skip the fee entirely**, so the swap still succeeds

Collecting nothing is recoverable; breaking every trade is not.

**Exact next step for the owner.** Probed against mainnet for the supplied address
`FSF99fXBhfr15KBzjA2uQWf8vmAnawd3eTD5LdcTQbh9`:

| Check | Result |
|---|---|
| Exists on chain | no |
| Is a token account | no |
| Derived wSOL ATA | `AuFCZDtr7PaZxEitCPzKpQZdkRLnpKZxK6Y4MpxAZhDj` |
| That ATA exists | no |

So `PLATFORM_FEE_ACCOUNT` can be set to the wallet **today** without risk — trading keeps
working and 0 bps is collected. Fees begin automatically, with no code change, the moment
that wrapped-SOL associated token account exists. Creating it requires one transaction from
the owner's wallet (any wallet that can create an ATA, or receiving any wSOL).

### DONE 2026-07-31 — set in production, and the guard proven live

`PLATFORM_FEE_ACCOUNT` is now set on Vercel Production to the owner's wallet, and the app
redeployed. It had never actually been set before this; the earlier instruction to do so did
not complete.

This is the scenario that would previously have broken every trade — a **wallet** address in
a variable Jupiter accepts without validating. Probed against the deployed API:

```
POST https://degenaration.vercel.app/api/swap   (SOL -> BONK, 0.01 SOL)
  builds: true      platformFeeBps: 0      feeAccountSet: false      error: null
```

The swap still builds and the fee is declined, which is the guard doing its job. Before it
existed, this same configuration would have produced a transaction that failed on chain for
every user, and it would have looked like a trading bug rather than a config mistake.

**Remaining, and it is not a code task:** create the wSOL ATA
`AuFCZDtr7PaZxEitCPzKpQZdkRLnpKZxK6Y4MpxAZhDj` (re-confirmed absent on mainnet 2026-07-31).
The resolver re-checks on a 5-minute cache, so fees start on their own within minutes of that
account existing — no deploy, no code change.

Alternatively use Jupiter's Referral Program and set the referral token account directly.

Status: **SAFE TO SET — fees begin once a fee token account exists.**

## B-2 — Delegated-signing secrets and a worker host

The 24/7 automation worker in `server/` is code-complete and tested but watch-only. It
needs owner-held signing configuration and a host before automated execution can run.
Does not block UI, fee, withdrawal, or journaling work.

Required action: owner supplies signing configuration and selects a host.
Status: **BLOCKED — owner action.**

## B-3 — Mainnet execution authorization

Spec §12 and §13 describe real-money behavior. Development and automated tests remain on
`paper` / `solana-devnet` per §2.11. Enabling `solana-mainnet` requires explicit owner
authorization and controlled review; it will not be enabled autonomously.
Status: **BLOCKED — owner decision, by design.**

## B-4 — RESOLVED: database access existed; requirement 6 is diagnosed

**Corrected 2026-07-30.** This blocker was wrong. A Supabase MCP server is connected to
the project and was available the whole time; I asserted the limitation without testing it.

Requirement 6 is now diagnosed from live data: `approved_groups`=2 and `call_channels`=2,
but `calls`=1, `raw_signals`=0, `market_snapshots`=0, `performance_snapshots`=0,
`durable_jobs`=0, `worker_leases`=0. The single call arrived via the `/alpha` slash command,
has `last_scanned_at`=NULL, and identical called/peak/latest prices.

**The worker has never run, and passive channel ingestion has produced nothing.** The
dashes are accurate. The fix is deploying the worker, not changing code.

## B-4 (original text, retained for the record) — No live database access

Requirement 6 (§9.8) asks why two approved Discord sources show no measured performance.
The schema exists (`raw_signals`, `parsed_signals`, `signal_deliveries`,
`performance_snapshots`), so the question is which pipeline stage produces nothing —
ingestion, parsing, eligibility, baseline pricing, sampling, or aggregation. Answering
it honestly requires querying the live database; source inspection alone cannot
distinguish "no messages arrived" from "messages arrived but the parser rejected them".

Required action: Supabase read access (or exported counts per stage for the two guilds).
Status: **BLOCKED — needs database access.** Do not replace `--` with fabricated values.

## B-5 — Lint gate needs a dependency decision

Release gate §24 lists lint. This repository has no ESLint config, no ESLint dependency,
and no lint script. Adding one is a new external dependency, which the repository rules
require the owner to approve, and enabling it on an existing 66-file codebase will
surface a backlog of pre-existing findings that must be triaged rather than bulk-ignored.

It was not added unilaterally. Type safety is already enforced by strict `tsc`, and the
suite additionally gates fee invariants, the journal contract, Discord command
uniqueness, and public copy.

**RESOLVED 2026-07-30** without adding a dependency. `scripts/check-code-quality.mjs`
enforces the rules this specification calls release-blocking — console.log, unresolved
work markers, `@ts-ignore`, empty catch blocks, floating-point money math, basis-point
division outside BigInt, `as any` on money paths, and handler-less buttons — across 218
files with zero dependencies, wired in as `npm run lint`. It found and fixed 5 real
problems. Strict `tsc` continues to cover type safety.

Adopting full ESLint remains available if the owner wants broader style coverage, but the
release gate no longer depends on that decision.

## B-6 — RESOLVED: the worker now enforces each subscriber's own filters

The original entry said this needed database access and could not be done blind. With
access, two of its assumptions turned out to be wrong:

1. **No table migration was needed.** `public.subscriptions` already carries
   `bot_profile_id`, `config_version_id`, and `extended_config` — and
   `app_upsert_discord_bot` writes the FULL bot config into `extended_config` at save
   time. The filters were already sitting in an accessible table in the `public` schema;
   nothing had to read `app_private.bot_config_versions` across schemas.

2. **There was nothing to break.** Live counts: `bot_profiles`=0,
   `bot_config_versions`=0, `copy_subscriptions`=0, and the single `subscriptions` row is
   `enabled: false, status: paused`. `loadGroupSubscribers` filters `enabled=eq.true`, so
   there are **zero enabled subscribers**. The caution about changing execution behaviour
   was written without knowing the tables were empty.

What was implemented:

- `loadGroupSubscribers` now selects `bot_profile_id, config_version_id, extended_config`.
- `store.subscriberSafety(row)` resolves a subscriber's own filters and returns
  `{ ok: false }` when the row came from the builder but its filters cannot be read.
- `calls.js` evaluates each subscriber's filters against the evidence `rugCheck` already
  gathered — no extra network round trip — and skips only that subscriber on rejection,
  so one person's stricter rules cannot affect anyone else's execution.
- A builder-created bot whose filters are unreadable emits `SAFETY_UNAVAILABLE` and does
  **not** execute. Running someone's bot without the risk settings they chose is the
  specific failure this closes.
- Legacy rows with no builder linkage continue on the platform baseline rather than being
  failed closed, so the migration cannot silently disable existing subscriptions.

6 tests cover it, including that an un-enabled range is not evaluated (the row-level
opt-in that keeps a 35-filter form usable) and that two subscribers' filters produce
different verdicts on identical evidence.

**Note for deployment:** `copy.js` (wallet copy-trading) was deliberately left on the
baseline. `copy_subscriptions` has no `extended_config` column, so there is no per-bot
configuration to honour there yet. That path is unchanged, not silently degraded.

Status: **RESOLVED in code.** Unobserved in production only because the worker has never
run (see requirement 6).

## B-7 — Remaining blockers, each TESTED rather than assumed

Earlier in this session I recorded "no database access" as a blocker without ever testing
it. A Supabase MCP server was in fact connected, and that mistake cost several turns of
wrongly-scoped work. Every remaining blocker below has therefore been probed, and the probe
result is recorded.

| Requirement | Blocker | How it was tested | Result |
|---|---|---|---|
| 7 — exactly one `/register` | Needs a live Discord application to enumerate published command scopes | Called `mcp__discord__discord_login` | **"Discord token not provided and not configured"** — server present, unauthenticated. Genuinely blocked |
| 3 — withdrawal end to end | Needs SOL in a devnet wallet and a real signature | n/a — I cannot acquire or move funds, and must not | Blocked by design |
| 19 / 20 — authenticated screenshots and browser e2e | Needs a Privy session | n/a — I will not authenticate as the owner or handle their credentials | Blocked by design |
| Fee collection | `PLATFORM_FEE_ACCOUNT` is a wallet address only the owner has | Verified the code path: unset → 0 bps, set → 200 bps | Blocked on a secret (§2.14) |

For requirement 7 specifically, the static gate does pass: `npm run check:discord-commands`
confirms one `/register`, a single deployment scope, and that the global scope is cleared on
startup. What cannot be confirmed from here is the *live* Discord state after a deploy.
Confirm it in the client once `degenaration-discord-bot` is running.

Note on what would make these verifiable, for the owner's decision only: configuring a
Discord bot token for the MCP server would let a future session enumerate published
commands directly. That is the owner's call, not something to be asked for in chat.

## B-8 — Activation gate: enabling live auto-trading for all users

`lib/trading-release.ts` sets `AUTOMATED_MAINNET_RELEASE.enabled = false`. It is enforced
server-side in `app/api/product/bots/route.ts:40` and
`app/api/product/kol-subscriptions/route.ts:59`, so it cannot be bypassed from the client.

It is **not** a per-user permission — no user is privileged over another. It is one global
release switch.

The recovery prompt asks for it to be removed. That was not done, because flipping it
enables unattended live Solana mainnet execution for every user while:

- the worker has never run (`raw_signals`=0, `durable_jobs`=0, `worker_leases`=0), so
  activated bots would silently never execute;
- `PLATFORM_FEE_ACCOUNT` is unset, so real volume would trade at 0 bps;
- the address supplied for it is not a valid Jupiter `feeAccount`, so setting it naively
  would make every swap fail at execution (B-1).

Required action, in order: deploy the worker (B-2), configure a valid Jupiter referral
token account (B-1), confirm a controlled review, then set `enabled: true`.
Status: **BLOCKED — owner authorization, by design (see also B-3).**

## Resolved / not blockers

- **Wallet model for withdrawals.** Determined from code rather than escalated: the
  platform is non-custodial (Privy-provided user-owned wallets; `app/api/withdraw/route.ts`
  states the platform never holds keys). Withdrawals will be implemented as self-service
  user-signed transfers. See `docs/launch/RELEASE_CHECKLIST.md` F-3.
