# AI handoff

The single place either agent reads before starting work. **Update it when you stop.**

Last updated: 2026-08-15 by Codex.

## Current ownership — owner directive, 2026-08-15

Codex is the primary coder, product designer, implementation owner, and release coordinator
for DegenAration. This directive supersedes older role and division-of-work notes below.
Claude Code or another agent may assist only when the owner explicitly assigns a separate
task or independent review, and must use a separate worktree while Codex is active.

---

## Codex hotfix — 2026-08-15

Owner explicitly assigned Codex a client-blocking hotfix in the main checkout despite the older
split-work warning below.

Changed code:

- `app/api/product/bots/readiness/route.ts` now computes readiness capital from live Solana
  `getBalance` plus `app_user_withdrawable_state` locked/pending lamports. Root cause: the route
  expected `spendableLamports`, but the SQL RPC returns locked/pending only.
- `components/product/BotBuilder.tsx` and `app/bots/kol/[id]/page.tsx` no longer block activation
  on the client-side Privy `delegated` property; wallet ownership remains server-verified.
- `app/wallet/WalletBody.tsx` no longer renders the delegated-access grant card.

Verification:

- `npm run typecheck` exit 0.
- `npm run verify:fee-ledger` exit 0.
- `node server/test/run.js` exit 0 — 357 passed, 0 failed.
- `npm run check` first failed only because sandbox DNS blocked `fonts.googleapis.com` during
  `next build`; rerun with network approval exited 0, including production build, visible-copy,
  responsive screenshots, and simulation gates.

Note: `npm run check` refreshed 44 browser evidence JPGs under `docs/ai/evidence/browser`.
`docs/coordination/AI_HANDOFF.md` was already modified before the hotfix; this note and the
regenerated state table are the Codex additions.

# Archived coordination snapshot — superseded by current ownership above

Claude Code and Codex are working on this project at the same time, at the owner's request.
That is allowed **only** under isolation, because `CLAUDE.md` says plainly: *never let two agents
edit the same working tree concurrently.* Both were in `/Users/axell/Documents/degenaration`
when this was written, which is the forbidden state.

## Who is where

| Agent | Working tree | Branch |
|---|---|---|
| **Codex** | `/Users/axell/Documents/degenaration` — the main checkout | `codex/final-degenaration-2026-08-08` |
| **Claude Code** | a linked worktree, created by its harness | a `claude/*` branch off the same commit |

Claude moved out. Codex keeps the main tree and does not need to change anything.

## Division of work — do not cross these lines

### Codex owns: independent review + the Render deployment

**1. Review the six commits Claude has landed since the checkpoint.** You have not seen any of
them. This is the role `FINAL_LAUNCH_SPEC.md` §0 assigns you — review committed checkpoints,
do not start a competing implementation.

```bash
git log --oneline bf17348..d0a5bdc
```

| Commit | What to check hardest |
|---|---|
| `530549b` | The 94-instance label sweep and 188-instance monospace sweep were **scripted**. Scripted rewrites are where a silent regression hides. Spot-check that no `ui-code` was stripped from a mint, signature or correlation id. |
| `56b1d1c` | docs only |
| `407b7b9` | `/api/platform/config` now resolves the real fee account. Confirm it cannot report a fee the swap path would not charge. Also 737 type utilities remapped by script. |
| `c7c01e8` | Two `system_flags` flipped to true in production. Verify that with no worker this genuinely cannot cause a trade. |
| `eef0544` | **Highest risk. Migration 30 + bot-bridge v9.** The bridge does not authenticate callers; it dispatches by name as `service_role`. Confirm both new operations reach a `bot_*` wrapper that validates `p_secret`, and that neither can reach `worker_record_call_market_scan` directly. A miss here lets anyone forge a source's price history. |
| `d0a5bdc` | `render.yaml` + the worker self-ping. Check the keep-alive cannot interfere with an in-flight exit. |

Write findings to `docs/coordination/CODEX_REVIEW.md` with severity, `file:line`, reproduction,
and expected behaviour. Do not fix Claude's code in the main tree while Claude is running —
report, and Claude resolves, or the owner assigns the fix to you explicitly.

**2. Deploy the worker to Render.** Claude is blocked: no Render API key, no Render CLI, and
Railway writes are dead (`Your trial has expired`) though reads still work. Codex may have
credentials Claude does not. Everything needed is prepared:

- `docs/ai/DEPLOY_WORKER_RENDER.md` — the full procedure
- `render.yaml` — corrected; `WORKER_NET` was hardcoded to `devnet`, which would have failed
  `workerHealth` forever while looking healthy
- The worker self-pings to defeat Render's 15-minute idle suspension

First deploy is `DELEGATED_SIGNING=off`. Watch-only until the lease is proven steady.

### Claude Code owns: everything else in the product

The UI system, the readiness layer, migrations, the call journal, the remaining functional
items. Claude will not touch `render.yaml`, `server/worker.js` or `CODEX_REVIEW.md` while this
split is active.

## Merging back

Claude's branch merges into `codex/final-degenaration-2026-08-08` when its slice is verified.
Neither agent rebases or force-pushes that branch while the other is running.

---

## Current state

<!-- handoff:state:start -->
| | |
|---|---|
| **Branch** | `codex/final-degenaration-2026-08-08` |
| **Last non-Claude commit** | `2226622` — **0** commits landed since |
| **Suite** | `npm run check`: **357 tests passed, 0 failed** |
| **Migrations applied** | see DATABASE_AUDIT.md |
| **Requirements** | 22 PASS · 2 PARTIAL · 0 BLOCKED |
| **Unpushed commits** | 0 |
| **Uncommitted files** | 49 |

_Generated by `npm run handoff` — do not edit this table by hand._
<!-- handoff:state:end -->

## The worker is hosted. 2026-08-11, Claude Code.

**Blocker 1 is closed.** The worker runs on Render, free tier, `srv-d9tjj4jm8hqs73db1gsg`:

| | |
|---|---|
| URL | `https://degenaration-worker.onrender.com` |
| Source | `nolimitbw/degenaration`, branch `codex/final-degenaration-2026-08-08`, `rootDir server` |
| Build / start | `npm ci` / `npm start`, health `/health` |
| Mode | **watch-only** — `DELEGATED_SIGNING=off`, `COPY_TRADING=off`, `WORKER_NET=mainnet` |

Verified live: `status ok`, `network mainnet`, `errors 0`, and `app_private.worker_leases` holds
its first row ever. The performance scanner priced **563 calls in its first 20 minutes**.

**Railway was not the host and is not coming back.** Variable writes still succeed there, but
`connect_service_source` and every deploy still return *"Your trial has expired."* Railway's
`degenaration-worker` variables were corrected in passing (`WORKER_NET=mainnet`,
`BOT_SHARED_SECRET`, `SITE_URL`) so a future paid plan starts from a correct config, but it holds
no running deployment. **Do not diagnose the worker there.** Render is the host.

**`AUTOMATION_WORKER_URL` was the missing half.** The worker heartbeating is not enough — the app
resolves `workerHealth` by fetching `process.env.AUTOMATION_WORKER_URL`
(`lib/server/automation-readiness.ts:29`), which had never been set. Set on Vercel production and
the deployment redeployed to pick it up. Without it a perfectly healthy worker reports
`workerHealth: false` forever, which is the same shape of wrong as the hardcoded `WORKER_NET`.

### Production readiness went 5/18 → 15/18

`mainnetPolicy · discordEntries · workerLease · workerHealth · scanner · durableIntents · quote ·
simulation · confirmation · positionCapture · takeProfitStopLoss · dailyRisk · reconciliation ·
exits · reconciliationState` all pass.

## The three checks that remain, and why each needs the owner

1. **`signer` and `submission`** — `DELEGATED_SIGNING=off`. Flipping it to `on` is the moment the
   worker can sign and broadcast real mainnet transactions with user funds. `render.yaml`'s own
   procedure is *bring it up, confirm it heartbeats, then flip it* — the first two are now done.
   This is deliberately left for the owner: the master spec forbids enabling mainnet automation
   to clear a blocker. One dashboard change on Render, no redeploy needed.
2. **`fee`** — 0 bps is still collected. `PLATFORM_FEE_ACCOUNT` is set on Vercel but the token
   account does not exist on chain, and it is **not set on the Render worker at all** (the check
   requires it ready on both). The value is marked Sensitive on Vercel and cannot be read back,
   so it must be copied from the owner console. Then the ATA needs one funded mainnet
   transaction (~0.00204 SOL rent, wSOL first). See `docs/ai/OWNER_RUNBOOK.md`.
3. Nothing else. Every other gate is green.

**Nothing can trade regardless**: `bot_profiles` = 0, `trade_intents` = 0, `positions` = 0.

**`calls_priced` is still 1 of 1,781 and that is correct.** The scanner prices calls from now on;
it cannot recover the market price at the instant of a message backfilled after the fact. See
DO-NOT-REVERT #11.

## DO NOT REVERT — decisions that look like bugs and are not

Kept from the previous revision, plus four added 2026-08-11. Each is load-bearing and covered
by a test or a recorded reason.

1. **The worker mirrors `PLATFORM_FEE_BPS` instead of importing `lib/fee-model.js`.** It deploys
   with `rootDir: server`, so `lib/` does not exist at runtime. A drift test fails if they differ.
2. **`retained_fee_lamports` is a generated column.** Never write to it.
3. **The `platform-allocation-offset` ledger entry must exist**, or a 200 bps fee produces 270
   bps of credits.
4. **`body` is transparent; the canvas colour lives on `html`.** Moving it back hides
   `DegenBackdrop`.
5. **`.ui-label` is sentence case, 12px, not monospace.** The old treatment was applied 94 times
   across 33 files, four of them at 8px. Restoring it anywhere restarts the drift.
6. **Monospace means a machine string** — address, signature, mint, id. Numbers use `.ui-figure`.
7. **Gold is spent once per screen**, on the primary action. Icons and underlines are ink by
   design; making one gold "so it stands out" removes the only signal that says where to act.
8. **The absent marker is `—`, never `--` and never `0`.** `verify:responsive` asserts it.
9. **The label defaults sit inside `:where()`** in `globals.css` so they carry zero specificity.
   Unwrapping that repaints every label in the product.
10. **`verify:responsive` asserts VALUES, not column headings** — `72.2%`/`33.3%`,
    `1.42x`/`0.71x`. It used to check for the literal strings "Up now" and "Median now", which
    made renaming a column look like removing a safeguard. Numbers cannot be renamed.
11. **The two Discord sources showing dashes is CORRECT** where calls are unmeasured. 1,780 of
    1,781 have no `called_price_usd`, because the history backfill recovers the message but not
    the market at that instant. A multiple against a baseline nobody recorded is invented.
12. **`WORKER_NET` is `sync: false`, not `devnet`.** Hardcoding devnet fails `workerHealth`
    forever while the service looks green.
