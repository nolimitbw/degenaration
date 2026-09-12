# Owner runbook — the three actions left

Written 2026-08-11 after everything reachable from a development machine was done. Each item
below needs an account or a signature that only you hold. Nothing here is a code change.

Current production: `eef0544`. `mainnetPolicy` passes; `automationLive` is `false`; the first
failing check is `workerLease`.

---

## 1. Give the worker a host — unblocks the most

**Why it is the top item.** It is the sole cause of 13 of the 18 failing readiness checks:
`workerLease`, `workerHealth`, `signer`, `durableIntents`, `quote`, `simulation`, `submission`,
`confirmation`, `positionCapture`, `takeProfitStopLoss`, `dailyRisk`, `reconciliation`, `fee`.
No bot can trade until one of these is done.

### Option A — pay Railway (fastest, everything is already configured)

The service `degenaration-worker` exists with its 7 variables, `rootDir: server`, health check
`/health`, and its GitHub source. It needs a plan; the trial expired and Railway removed every
deployment.

1. Pick a plan at railway.app.
2. Point the service's branch at `codex/final-degenaration-2026-08-08` — this is new, and is why
   redeploying could not have worked before today. GitHub's newest branch was `master`
   @ `2f03090`, which predates the worker entirely.
3. Redeploy. `/health` should answer `ok` in watch-only mode.

Do the same for `degenaration-bot` if you want the listener off Render.

### Option B — Render (you already have an account)

`render.yaml` in the repo root already declares both services:

```yaml
- type: web    name: degenaration-worker        rootDir: server
- type: worker name: degenaration-discord-bot   rootDir: server/bot
```

New > Blueprint > pick this repo > branch `codex/final-degenaration-2026-08-08`. You will need to
set the same environment variables Railway holds.

**This was impossible before 2026-08-11.** Render and Railway both build from GitHub, and the
288 commits containing the worker had never been pushed.

### Verify either way

```bash
curl -s https://degenaration.vercel.app/api/platform/config | jq '.automation.failedCheck'
```

`workerLease` should stop being the answer.

---

## 2. Turn on delegated signing — only after step 1

Set `DELEGATED_SIGNING=on` on the worker service. The Privy credentials are already present; the
signer was never what was missing.

`server/worker.js` gates the entire trading stack behind this, so until it is `on` the worker
boots watch-only and starts nothing that can claim, sign or trade. That is the correct order:
bring the worker up, confirm it heartbeats, then let it sign.

**Before you flip it, know what changes.** With the master gate already on, this is the last
switch between a saved bot and a real trade. Suggested sequence: watch-only for one day, confirm
`worker_leases` is filling and the journal is scanning, then enable signing with one funded test
wallet before anyone else's money is in scope.

---

## 3. Create the platform fee token account — you are probably over-thinking this

You collect **0%** today. `PLATFORM_FEE_ACCOUNT` is set to a **wallet**, and Jupiter needs a
**token account**. `resolveFeeAccount` derives the ATA per fee mint, finds it uninitialised, and
correctly skips the fee rather than building a swap that would fail on chain.

**You do not need the fee wallet's private key.** An Associated Token Account is deterministic
and anyone may create one for any owner — the payer signs and pays rent, the owner is just an
address. So this can be done from any wallet you already use.

Print the exact addresses:

```bash
npm run verify:fee-account "$PLATFORM_FEE_ACCOUNT"
```

Then create them, wSOL first because it covers every sell:

```bash
spl-token create-account So11111111111111111111111111111111111111112 --owner <FEE_WALLET>
```

```bash
spl-token create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --owner <FEE_WALLET>
```

Roughly 0.00204 SOL rent each. No transfer, no swap.

### Verify

```bash
curl -s "https://degenaration.vercel.app/api/quote?in=So11111111111111111111111111111111111111112&out=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000" | jq '{platformFeeBps, feeAccountSet}'
```

`feeAccountSet` must become `true` and `platformFeeBps` `200`. The whole interface reads its fee
copy from one place, so the builder stops saying "None" the moment this lands — no redeploy.

---

## What is already done, so you do not redo it

| | |
|---|---|
| `mainnet_execution_enabled` | **true** — `mainnetPolicy` passes |
| `payout_processing_enabled` | **true** |
| 288 unpushed commits | pushed; the branch exists on GitHub |
| Fee advertised at 2.00% while charging 0 | fixed — production says "None" until the ATA exists |
| Trading state shown once, dismissible | `TradingNotice` on builder, manager, portfolio |
| Call journal unpriceable without a worker | migration 30 + bridge v9 + daily Vercel cron; 45 calls scanned live |
| Discord ingestion | never broken — the backfill cron runs daily and last ran 2026-08-11 |

Rollback for the two flags:

```sql
update app_private.system_flags set value = 'false'::jsonb, updated_at = now()
where flag_key in ('mainnet_execution_enabled','payout_processing_enabled');
```

## One limitation worth knowing before you look at the marketplace

A return needs the price at the call and the price now. The new cron fills the second. It cannot
fill the first: 1,780 of 1,781 calls arrived through the history backfill, which recovers the
message but not the market at that instant, so `called_price_usd` is null on all but one. Those
calls will show a current price and no return, and the marketplace correctly keeps counting them
unmeasured — a multiple against a baseline nobody recorded would be invented.

Measured counts climb from calls ingested **live**, not from the archive.
