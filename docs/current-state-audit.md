# Current State Audit

Date: 2026-07-22

## Scope and evidence

This audit covers the DegenAration Next.js application, Supabase project, Discord bot, Render worker, and the two supplied recordings. Video 1 is used only as a workflow and quality reference. Video 2 and the repository are the source of truth for DegenAration branding and current behavior.

- Reference recording: `/Users/axell/Documents/Screen Recording 2026-07-22 at 2.14.03 AM.mov`
- Current-product recording: `/Users/axell/Documents/Screen Recording 2026-07-22 at 2.21.02 AM.mov`
- Reference contact sheets: `/Users/axell/.codex/video-audit/reference-sheets/`
- Current-product contact sheets: `/Users/axell/.codex/video-audit/current-sheets/`
- Repository revision reviewed: `3e57ca53162eb17160d48c0615ec0f14c7332f9f`
- Production app: `https://degenaration.vercel.app`
- Supabase project: `uqccguunmjabjheeivhx`

## Baseline

| Check | Result | Qualification |
| --- | --- | --- |
| `npm run build` | Pass | Next config skips type validation and linting. |
| `npx tsc --noEmit --pretty false --incremental false` | Pass | TypeScript passes when run directly. |
| `npm test` in `server/` | 35 pass, 0 fail | Unit coverage is narrow and does not exercise live services. |
| Supabase project | Healthy | 13 public tables, all with RLS enabled. |
| Supabase security advisor | 1 warning, 3 informational | Leaked-password protection is off; three service-only tables intentionally have no client policies. |
| Discord registration data | Live | Two channel registrations: one approved and one pending at audit time. |
| Production owner dashboard retry | Pass | The owner session loaded both rows after Privy identity-token configuration settled. |
| Automated execution | Not production-ready | Render blueprint defaults delegated signing to `off`; concurrency and durable claim semantics are incomplete. |

## Recording state index

### Reference recording

| Time | Important state |
| --- | --- |
| 00:00-00:30 | Dense terminal with chart, token metrics, trade ticket, order book, and activity. |
| 00:31-00:37 | Trades open/history tables with compact loading and empty states. |
| 00:38-01:08 | Token research table, category controls, quick buy, and a detailed filter modal. |
| 01:09-01:11 | Bot manager and status table. |
| 01:12-01:42 | Smart-wallet research, swap history, labels, performance, and filter drawer. |
| 01:43-02:03 | Volatility, wallet-copy, and Discord source marketplace workflows. |
| 02:04-02:23 | Referral metrics, history, payouts, account security, and linked accounts. |
| 02:24-02:32 | Cross-feature navigation and terminal/bot transitions. |
| 02:33-03:10 | Two-pane Discord bot creation with source selection and risk settings. |

### Current DegenAration recording

| Time | Important state | Finding |
| --- | --- | --- |
| 00:00-00:01 | Limit Orders | Functional guardrails, but automation is not live by default. |
| 00:02-00:07 | Terminal | Real token data; embedded third-party chart flashes white while loading. |
| 00:08-00:10 | Trades | Real history path, but the empty state leaves most of the viewport unused. |
| 00:11-00:14 | Search | Real token rows and useful density; filters are too shallow. |
| 00:15-00:19 | Discord automations | Real approved-source data and settings; loading and context are sparse. |
| 00:20-00:23 | Affiliate | Real assigned referral row; no earnings, conversion, or payout workflow. |
| 00:24-00:27 | Portfolio | Real wallet/trade sources, but no positions, PnL, allocation, or activity detail. |
| 00:28-00:39 | Bots | Functional settings form; source/status/log context remains incomplete. |

## Product comparison matrix

| Area | Existing | Missing or incomplete | Broken or risky | Status |
| --- | --- | --- | --- | --- |
| Brand and shell | DegenAration name, logo treatment, bronze/gold, graphite background, top nav, ticker, bottom status rail | Unified semantic tokens and consistent legacy-route styling | Legacy pink/cyber tokens still leak into product surfaces | Partial |
| Home | Real BONK market terminal, live candles, holders, risk, quote preview | Stronger product hierarchy, compact proof, purposeful motion, responsive QA | Legacy rocket CSS/assets remain even though current page no longer uses them | Partial |
| Terminal | Real price, OHLCV, holders, quote, buy, sell, limit draft, preview | Timeframe controls, richer chart, order/activity context, explicit execution state timeline | DexScreener iframe can flash white; trade-record failure is silently ignored | Partial |
| Trades | Authenticated trade ledger | Open orders, status, transaction links, filters, export, retry state | A successful chain transaction may be absent from history if recording fails | Partial |
| Search | Real Solana token feed, sorting, categories, detail drawer, quick buy | Advanced filters, saved presets, clearer freshness/provider state | Upstream failures can be swallowed or represented as generic empty data | Partial |
| Discord bots | Approved sources, source metrics, execution settings, `/register`, `/alpha`, profile/referral/status commands | Manager overview, execution logs, per-source health, audit history | Bot and worker deployments are separate concerns but the blueprint defines only one service | Partial |
| Discord approval | Owner-only dashboard and live pending rows | Stronger refresh/error telemetry | Depends on Privy identity-token configuration; errors previously looked like missing data | Working after retry |
| Copy trading | Wallet subscriptions and worker watcher | Durable event cursor, exact transaction parsing, retry policy, execution ledger | Holdings-diff detection can duplicate/miss signals across restarts; spend caps are process-local | Unsafe for live funds |
| Limit orders | Persistent orders and watcher | Atomic claim, durable attempts, daily-cap reservation | Multiple worker instances can execute the same open order | Unsafe for live funds |
| Call automation | Call ingestion, risk check, group subscribers | Per-subscriber execution records and retries | Call is marked executed after a loop even when subscriber executions fail; process-local dedupe | Unsafe for live funds |
| Position exits | TP/SL monitor module | Persistent positions and worker wiring | Current monitor is in-memory and is not started by `worker.js` | Inaccessible |
| Portfolio | SOL balance and recorded trades | Token balances, cost basis, realized/unrealized PnL, charts | Depends on best-effort trade recording | Partial |
| Affiliate | Assigned per-server links and public source profiles | Click/conversion/commission/payout ledger | No verified earnings pipeline | Partial |
| Admin | Applications, channels, commissions, unsigned withdrawal builder | Auditable role model, action history, provider health | Client admin visibility is email-based; server is stronger but relies on correct Privy configuration | Partial |
| Public profiles | Server source profiles, wallet profiles, risk reports | Better share state and transparent sample-quality labels | Sparse data correctly shows pending but can look unfinished | Working, data-limited |
| Alerts/watchlist | Browser-local utilities | Server persistence and background notifications | Alerts only run while the page is open | Partial |
| Settings/onboarding | Screens exist | One coherent Privy-based account model | Several paths still use Supabase Auth despite Privy being primary | Broken/legacy |

## Route matrix

| Route | Classification | Notes |
| --- | --- | --- |
| `/` | Working, partial | Real market terminal; visual and information architecture pass needed. |
| `/terminal` | Working, partial | Real market and swap paths; chart flash and execution durability need work. |
| `/trades` | Working, partial | Authenticated recorded trades only. |
| `/search`, `/explorer` | Working, partial | Same implementation; real feed with limited filters. |
| `/bots`, `/calls` | Working, partial | Same Discord automation implementation. |
| `/affiliate` | Working, partial | Real server referral assignments, no earnings pipeline. |
| `/portfolio`, `/dashboard`, `/holdings` | Working, partial | Same wallet/trade summary implementation. |
| `/orders` | Partial, execution-gated | Creation is blocked unless delegation and worker are live. |
| `/tracker` | Partial | Wallet copy configuration exists; production execution is not safe yet. |
| `/wallet` | Partial | Wallet status/delegation UI exists; permissions claims require verification. |
| `/wallet/[address]` | Working | Public on-chain wallet view. |
| `/source/[slug]` | Working | Public source metrics with honest pending states. |
| `/risk/[mint]` | Working, provider-dependent | Live third-party risk data. |
| `/apply` | Working | Submits through protected app bridge. |
| `/admin` | Working after auth retry | Live database summary and applications. |
| `/admin/channels` | Working after auth retry | One pending registration was visible in production during audit. |
| `/admin/commissions` | Partial | Live summary; withdrawal still requires correct fee wallet and signer. |
| `/alerts`, `/watchlist` | Local-only | Not durable across devices or background sessions. |
| `/settings`, `/onboarding` | Broken/legacy | Mixed Privy and Supabase Auth assumptions. |
| `/login` | Partial | Both visible login choices open the same Privy modal. |
| `/alpha`, `/trenches` | Working, legacy IA | Real-data secondary discovery surfaces. |
| `/docs`, `/security`, `/terms`, `/privacy` | Accessible | Some security claims must be softened until delegation policy is verified. |
| `/demo` | Redirect | Redirects to `/trenches`; not a demo. |

## Highest-risk findings

1. Automated trading lacks a database-backed atomic claim before signing. Two processes can execute the same limit order, call, or copy signal.
2. Daily spend limits are tracked in process memory and written back after signing. They are not an atomic pre-trade reservation.
3. Discord calls are marked globally executed even when one or more subscriber trades fail, preventing durable retry.
4. Manual swaps return success after chain submission while `/api/record-trade` failures are discarded.
5. The production build skips both type and lint validation, hiding future regressions.
6. The worker uses deprecated Privy server-auth code and claims trade-only, spend-capped delegation without a verified policy artifact in this repository.
7. The terminal embeds a third-party chart that visibly flashes a white document while loading.
8. Settings and onboarding mix two authentication systems and can fail for normal Privy users.

## Live-service observations

- `bot-bridge` and `app-bridge` are active Supabase Edge Functions protected by secret-checked database functions.
- Public execution privileges for sensitive `app_*`, `admin_*`, and `bot_*` functions are revoked; only `postgres` and `service_role` can execute them.
- The bot bridge returned HTTP 200 responses during the audit.
- The owner dashboard loaded two channel registrations after retry: one approved and one pending.
- No pending channel was approved or rejected during this audit.

