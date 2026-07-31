# Reference matrix — recovery prompt audit

Spec: `DEGENARATION_CLAUDE_CODE_LEAD_CODEX_REVIEW_FINAL_PROMPT.md` §2.

Audited 2026-07-30 by Claude Code, **against the running code and the live database** —
not against a previous revision of this document. Three earlier trackers in this project
went stale and read as evidence while being wrong.

> **The recovery prompt was written against an older repo state.** Several of its stated
> defects were already fixed by the preceding 47 commits. Each is marked STALE below with
> the fix. Rebuilding those would have destroyed tested, working code.

## Verdicts

| § | Claim / requirement | Verdict | Evidence |
|---|---|---|---|
| 5 | Numeric fields produce `01` / `05` | **FIXED THIS PASS** | Root cause was worse: fields could not be cleared and a decimal could not be typed (`Number("0.")` → `0`). `lib/numeric-input.js` + `components/product/NumericField.tsx`, 12 unit tests, browser-verified on `/bots/kol/new`. `type="number"` count in `app/`+`components/` is now **0** |
| 7 | Nav must show only Bots, Affiliate, Portfolio | **PASS** | `components/AppShell.tsx:32` — `NAV` contains exactly those three |
| 10 | Duplicate `/register` commands | **STALE** | Fixed in `b65e069`. `npm run check:discord-commands` reports a clean registry; root cause was stale *global*-scope commands surviving guild-scoped deploys |
| 13 | Withdrawals unavailable / permission-gated | **STALE** | Fixed in `47dec45`. The dead-end `UnavailableWithdrawal` modal is gone; `app/api/product/portfolio/withdraw/route.ts` exists and is verified 16/16 on a local validator |
| 14 | 2.00% per-leg fee, 0.70% / 0.20% creator | **PASS** | `lib/fee-model.js`; `npm run verify:fee-ledger` holds across 75 combinations; creator share is funded **from** the fee, never added |
| 15 | PnL cards missing | **STALE** | `app/api/product/pnl-card/route.tsx` exists — 1600×900, gold-on-black, server-authoritative from a record ID, QR, disclaimer |
| 16 | Admin identity `flipthatsol@gmail.com` | **PASS** | Verified **in the live database**: `app_private.admin_email_allowlist` contains it, `active: true`. Column is `normalized_email`, so matching is case-insensitive. Enforced server-side via `app_sync_verified_identity`, never from a client-supplied email |
| 9 | Remove the activation gate | **OWNER DECISION — NOT DONE** | See below |
| 3 | Four named subagents | **EQUIVALENT EXISTS** | `.claude/agents/degenaration-{ui,financial,performance,release}-*.md` map 1:1 to the requested `senior-ui-reviewer`, `trading-integrity-reviewer`, `discord-ingestion-reviewer`, `release-auditor`. Duplicating under new names would create two sets that drift |

## §9 — the activation gate is deliberately still closed

The prompt asks to "remove ordinary admin permission gates" so a user can activate without
approval. The gate that exists is **not** an admin permission gate:

```ts
// lib/trading-release.ts
export const AUTOMATED_MAINNET_RELEASE = Object.freeze({ enabled: false, ... })
```

It is a single global release flag, enforced **server-side** in
`app/api/product/bots/route.ts:40` and `app/api/product/kol-subscriptions/route.ts:59`, not
just hidden in the UI. There is no per-user permission anywhere — no user is privileged
over another.

**Flipping it to `true` was not done, deliberately.** Doing so would enable live Solana
mainnet auto-trading for every user, and right now:

1. **The worker has never run.** Live counts: `raw_signals`=0, `durable_jobs`=0,
   `worker_leases`=0. Users could activate bots that would silently never execute.
2. **`PLATFORM_FEE_ACCOUNT` is unset**, so every activated bot would trade at 0 bps and the
   platform would earn nothing on real volume.
3. **The owner's supplied address is not a valid Jupiter `feeAccount`** — setting it would
   make every swap fail at execution (see `OPEN_BLOCKERS.md` B-1).

The prompt's own operating rules require asking before "an irreversible production
operation" (rule 3) and forbid spending real funds in verification (rule 11). Enabling
unattended mainnet execution for all users is exactly that. It is recorded as **B-3 —
owner authorization required**, unchanged.

**To enable it**, the owner sets `enabled: true` after: deploying the worker, configuring a
valid fee account, and confirming a controlled review. It is a one-line change once those
hold.

## Reference media

Handled separately in `docs/degenaration-reference-coverage.md`, which records every
recording and image, which sheet was reviewed, and the one place the reference and the
specification disagree (Discord card avatar size).

Claude Code cannot process video. The five `.mov` files are reviewable only because Codex
extracted them into timestamped contact sheets, now preserved at
`~/Desktop/DEGENARATION/SETTINGS AND FUNCTIONS IDEA/extracted-frames/`.

### The current-build recording — NOW REVIEWED

`Screen Recording 2026-07-30 at 7.11.08 PM.mov` (61.6s) was initially unreadable: no
`ffmpeg`, and every path lookup failed because the filename contains **U+202F, a narrow
no-break space**, before "PM" rather than a normal space.

Extracted with macOS-native AVFoundation via a small Swift program — no new dependency.
12 evenly-spaced frames are preserved at
`~/Desktop/DEGENARATION/SETTINGS AND FUNCTIONS IDEA/extracted-frames/current-build-2026-07-30/`
along with `extract.swift` so it is repeatable.

**What it shows: the deployed site, with this remediation's work live and working.**

| Observed at | Confirms |
|---|---|
| Discord Sources (0:12) | Redesigned cards live — real server avatars for DegenAration and SLPR DEGEN, `APPROVED` badge, `● Connected` health dot **with text**, five-metric row, four-bucket distribution, `Tracking started Jul 18 at 12:03 PM`, `Creator share included in 2% fee`. §6.2 header copy. Nav is exactly Bots / Affiliate / Portfolio |
| Bot builder (0:33) | §11 ordering live — Stop loss → Security filters → **Execution and retries last**. §11.3 summary shows `Maximum exposure`, and a **single** `Platform fee ⓘ 0.00%` row; the additive creator-fee row is gone. `Automated trading not yet available` |
| Affiliate (0:48) | §6.2 copy, info affordance on all four metrics, `COMMISSION RATE 0.70%`, clean `No earnings in this period` empty state, `SIGNED-IN CREATOR flipthatsol@gmail.com` — the admin identity working in production |

**Two things the recording proves that were previously only inferred:**

1. `Platform fee 0.00%` renders on the live site, which is the honest result of
   `PLATFORM_FEE_ACCOUNT` being unset — and confirms the hard-coded `0` bug is fixed in
   production.
2. The Discord metrics are dashes with `0 measured` and a real `Tracking started` date.
   That is exactly the empty-journal state predicted from the database, not a UI fault.

**Not visible in the recording, and therefore still unverified by it:** the PnL share flow,
and the numeric-input fix — the latter because it was committed *after* this deploy and is
**not yet in production**.

### Correction — the recording also showed a defect, which sampling missed

The table above was written from 12 evenly-spaced frames. Reviewing **all** of them found a
user-blocking bug the sample had skipped, so the row reading "this remediation's work live
and working" was true but incomplete.

| Observed at | Defect |
|---|---|
| Bot builder (0:23) | `APPROVED DISCORD SOURCE` reads **"No options available"**, and the summary says `Source - Not selected` / `Source required` - while the marketplace **in the same recording** lists two approved sources |

The endpoint was never at fault; the live API returns both. `BotBuilder.tsx` used
`.catch(() => setSources([]))`, so a failed load became an empty list, indistinguishable
from "no approved sources exist" - no cause, no retry. Bot creation, the product's primary
flow, looked permanently broken.

Fixed in `3ac6f5f`: bounded request, loading state, explicit error with a **Try again**
button, and a separate message for the genuinely-empty case. Browser-verified against a
failing load. The raw API reason is kept out of the UI per §23 and logged instead.

**The lesson is about method, not this bug.** Evenly-spaced sampling is a way to *find*
things, never a way to conclude nothing is there. Three of the defects fixed in this
remediation came from the same silent-catch pattern; sampling reported the surface as
healthy each time.
