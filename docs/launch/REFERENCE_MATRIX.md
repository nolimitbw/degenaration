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

**The new recording `Screen Recording 2026-07-30 at 7.11.08 PM.mov` is UNREVIEWED.** No
`ffmpeg` is installed, so no frames could be extracted from it. Its stated defects were
audited from the code instead, which is how the numeric-input bug above was found and
confirmed.
