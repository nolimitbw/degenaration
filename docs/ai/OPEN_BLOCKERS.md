# Open blockers — rewritten 2026-08-11 from live state

Everything below was read from production, the live database, Railway, GitHub and Solana
mainnet on 2026-08-11. Prior revisions of this file inferred blockers from the repository;
several were wrong about the cause.

## The finding that reorders everything

**288 commits existed only on one laptop.** GitHub's newest branch was `master` @ `2f03090`.
The entire Codex final implementation and every session since — including the worker heartbeat,
the DCA engine, the signer policy and the readiness layer — had never been pushed.

Railway builds the worker **from GitHub**. So "the worker will not deploy" was never a
configuration problem: the code was not there to build. Pushed 2026-08-11 as
`codex/final-degenaration-2026-08-08`.

## B-1 — Railway trial expired · BLOCKS THE WHOLE TRADING PATH

```
connect_service_source → "Your trial has expired. Please select a plan to continue using Railway."
list_deployments       → Unauthorized
```

Every deployment on `degenaration-worker` reads `REMOVED`. Railway tore them down. The
`degenaration-bot` project is unreachable for the same reason.

This single fact explains **13 of the 18 failing readiness checks** in production:
`workerLease`, `workerHealth`, `signer`, `durableIntents`, `quote`, `simulation`, `submission`,
`confirmation`, `positionCapture`, `takeProfitStopLoss`, `dailyRisk`, `reconciliation`, `fee`.

It also explains the empty performance journal: 1,780 of 1,781 calls have no price because the
worker's scanner is what prices them.

**Owner action: choose a Railway plan, or move `server/` to another host.** Nothing else in this
file can be tested until then.

## B-2 — The platform fee token account does not exist on chain

`PLATFORM_FEE_ACCOUNT` is set to a **wallet**, not a token account. `resolveFeeAccount` derives
the ATA per fee mint and finds it uninitialised, so `/api/quote` and `/api/swap` correctly skip
the fee. **0 bps has been collected on every trade, in both directions.**

Until 2026-08-11 `/api/platform/config` disagreed with them — it tested only that the
environment variable was non-empty, so the interface advertised 2.00% while charging nothing.
Fixed in `407b7b9`; the config endpoint now resolves the real account.

**Owner action: initialise the Associated Token Account for the fee wallet — wSOL first (covers
every sell), then USDC.** ~0.00204 SOL rent each. This requires a signed transaction from the
fee wallet and cannot be done from here.

Run `npm run verify:fee-account <PLATFORM_FEE_ACCOUNT>` for the exact derived addresses.

## B-3 — Delegated signing is off

`DELEGATED_SIGNING` is not `on`, so `server/worker.js` boots watch-only and starts no watcher
that can claim, sign or trade. The Privy credentials are already present; the signer was never
the blocker. Gated behind B-1 — there is no running service to set it on.

## Resolved 2026-08-11

| Was | Now |
|---|---|
| `mainnet_execution_enabled = false` | **true.** `mainnetPolicy` passes in production |
| `payout_processing_enabled = false` | **true** |
| Branch unpushed, 288 commits on one machine | pushed to `origin` |
| Config advertised 2.00% while charging 0 | config resolves the real fee account (`407b7b9`) |
| Trading state shown once, dismissible | `TradingNotice` on builder, manager and portfolio (`407b7b9`) |

Rollback for the flags, exact:

```sql
update app_private.system_flags set value = 'false'::jsonb, updated_at = now()
where flag_key in ('mainnet_execution_enabled','payout_processing_enabled');
```

Enabling them changed no behaviour on its own — `automationLive` is still `false` and 13 checks
still fail — because a trade needs the worker (B-1) and the signer (B-3) as well. They were the
two gates that could be lifted without a running service.

## Not blockers, corrected

- **`privy_profiles` = 0 does not mean the platform lost its users.** It is the legacy table
  behind the `/wallet` spending-limits page, written only when someone saves limits there. The
  real user record is `app_private.app_users` — **6 users**, intact, 4 with registered wallets.
- **`signal_deliveries` = 0 is not a fan-out defect.** `fan_out_parsed_signal` reads
  `app_private.bot_profiles`, which has 0 rows. `app_user_save_bot` writes it, so bots saved
  through the current path will fan out. The single existing `public.subscriptions` row predates
  that path, is `paused`, and has `channel_id = null` — it was never going to receive a call.
- **The user wallets are not stuck.** The product is non-custodial; there is no platform deposit
  account. The 4 registered wallets hold 0.0009 SOL combined, verified on mainnet.

## E-9 — a second listener that is not in this repository

`degencalls.onrender.com` is the only Discord listener currently running and it is not built
from this repo. It is not dangerous — `raw_signals` is unique on
`(source_type, source_ref, external_event_id)`, so duplicate forwarding collapses to one row —
but it is unowned by this codebase and it stopped producing calls on 2026-08-09.
Its own counters: 5 ingestion attempts ever, 3 accepted, 2 failed, **100 quarantined**, last
error `address is not a Solana token mint`.
