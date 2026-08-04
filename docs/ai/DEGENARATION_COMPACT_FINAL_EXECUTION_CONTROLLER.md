# DegenAration — Compact Final Execution Controller

Continue from the current repository, branch, commits, working tree, database state, and deployed services.

Do not restart the project.
Do not repeat the full scan.
Do not re-read or re-decode every reference video.
Do not restate completed work.
Do not present another strategy menu.
Do not launch parallel dynamic workflows.
Do not call Codex.
Do not stop after planning.

## Read only the current sources of truth

Read:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/DEGENARATION_MASTER_SPEC.md`
- `docs/ai/IMPLEMENTATION_STATUS.md`
- `docs/ai/OPEN_BLOCKERS.md`
- `docs/ai/RELEASE_CHECKLIST.md`
- `docs/ai/MIZAR_REFERENCE_INVENTORY.md`
- `docs/ai/MIZAR_PARITY_MATRIX.md`
- `docs/ai/CLICK_FLOW_MAP.md`
- `docs/ai/REFERENCE_COVERAGE.md`
- `docs/ai/ACCOUNTING_MODEL.md`
- current `git status`, diff, and recent commits

Use the existing reference inventory first. Inspect an original video or image only when the parity matrix identifies a specific missing detail. Never rescan all media without a concrete reason.

## Current verified status

A client has successfully deposited and withdrawn funds and received the withdrawal in their external wallet. Preserve this as verified evidence.

Do not repeat the previous funds investigation unless a new reproducible defect appears.

Keep automated mainnet execution disabled until all external production requirements are configured and verified.

## Execute these milestones in order

### 1. Discord ingestion and call journal

Make every approved Discord guild/channel ingest supported Solana calls from messages, embeds, replies, and supported links.

Persist:

- raw event
- guild/channel
- message ID
- parser version
- detected mint
- token metadata
- price/market cap/liquidity at call
- accepted/rejected/duplicate reason
- scanner result
- timestamps
- source link
- processing status

Implement reconnect, retries, deduplication, edited-message handling, dead-letter handling, structured logs, freshness, and exactly one functional `/register`.

### 2. Discord source performance

For every valid call calculate and display authoritative:

- current return
- maximum return
- percentage result
- multiple such as 0.5x, 1.5x, 2x, 5x
- call age
- best/worst call
- win rate
- average/median return
- 1D/7D/30D performance
- drawdown
- copied execution count
- confirmed copied volume

Keep call performance separate from actual subscriber trade performance.

Never fabricate data or display unknown values as zero.

### 3. Client copy-trading settings

Persist, reload, version, validate, and enforce every Discord-copy setting shown in the reference materials:

- wallet
- source/channel
- buy amount
- maximum capital
- maximum positions
- daily limits
- slippage
- priority fee
- retries
- cooldown
- liquidity/market-cap/token-age/security filters
- TP levels and sell percentages
- stop loss
- trailing TP/SL
- DCA levels and limits
- kill switch
- pause/resume

Every trade must store the immutable configuration snapshot used to open it.

### 4. Automated trading

Complete and test:

```text
Discord call
→ subscriber eligibility
→ configuration
→ capital reservation
→ durable trade intent
→ quote
→ simulation
→ signing authorization
→ submission
→ signature persistence
→ confirmation
→ execution
→ position settlement
→ TP/SL/trailing/DCA monitoring
→ exit
→ fee allocation
→ reconciliation
→ Portfolio/performance update
```

Implement durable queues, leases, retries, duplicate prevention, confirmation, reconciliation, position monitoring, health checks, alerts, emergency pause, and exit preservation.

Use staging/devnet or deterministic mocks. Do not broadcast funded mainnet tests.

### 5. Admin Console

Server-side restrict Admin access to the approved administrator identity.

Show every client’s:

- total principal
- available/locked/pending/withdrawable balances
- open positions
- deposits
- withdrawals
- realized/unrealized PnL
- confirmed volume today, 7D, 30D, lifetime
- platform fees
- bots/subscriptions
- failed trades/withdrawals
- reconciliation warnings

Use confirmed executed notional for volume.

Do not add an arbitrary balance-edit function.

### 6. Mizar-familiar UI

Use the existing videos, images, reference folders, inventory, parity matrix, and click-flow map.

Implement every remaining FAIL/PARTIAL reference row.

Match the demonstrated:

- navigation
- screen structure
- control placement
- setup order
- settings grouping
- progressive disclosure
- marketplace
- Bot Manager
- editing
- Affiliate
- Portfolio
- performance presentation
- responsive behavior

Preserve DegenAration’s logo and black/gold/white identity.

Do not copy Mizar trademarks, logo, source code, exact proprietary text, or artwork.

Remove generic AI-looking UI, emojis, fake Discord covers, random polygons, oversized empty panels, and walls of text.

### 7. Portfolio and PnL cards

Complete real:

- positions
- trade history
- deposit/withdrawal history
- 7D/30D/3M charts
- realized/unrealized PnL
- winning card
- losing card
- Portfolio card
- referral/canonical links
- matching QR
- high-resolution export

Use server-authoritative data only.

## Work discipline

For each milestone:

1. Inspect only relevant code and existing evidence.
2. Implement the complete vertical slice.
3. Run targeted tests.
4. Run typecheck, lint, and build.
5. Run relevant browser tests.
6. Update status/evidence documents.
7. Commit with a descriptive message.
8. Continue automatically.

Do not ask what to do next.

Stop only for:

- missing production credential
- missing Discord permission
- missing RPC/indexer
- secure signer/worker-host requirement
- platform fee account
- irreversible production deployment
- real transaction approval

## Final gate

Before claiming completion, run:

- formatting
- lint
- strict type checking
- unit/integration/browser tests
- production build
- migration/RLS verification
- secret scan
- dependency audit
- financial invariants
- responsive checks at 390, 768, 1024, and 1440
- accessibility smoke test

Report only:

- completed milestones and commits
- exact tests passed
- remaining genuine external blockers
- one production approval package

Begin with the first current FAIL/PARTIAL item in Discord ingestion. Continue automatically.
