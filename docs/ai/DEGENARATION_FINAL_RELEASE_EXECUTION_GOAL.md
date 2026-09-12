# DEGENARATION — FINAL RELEASE EXECUTION GOAL
## Complete, Commit, Deploy, Verify, and Prepare Controlled Mainnet Activation

Continue from the CURRENT DegenAration repository, branch, commits, working tree, Vercel production app, Supabase production project, Railway services, authenticated browser session, existing environment configuration, and all existing `docs/ai` evidence.

This is the final implementation and release task. It is not another planning session, audit-only pass, documentation exercise, or prototype.

# PRIMARY ACCEPTANCE FAILURE

Production still displays:

- `Activation needs the execution worker`

This means the product is NOT complete.

The final release must include a real, deployed, healthy, authoritative execution worker and a verified Discord scanner/listener path. Do not remove this message merely to make the interface look complete. Remove or replace it only after the execution worker, signing boundary, fee account, reconciliation path, and emergency controls are actually operational and verified.

# NON-NEGOTIABLE OPERATING RULES

1. Do not restart the project.
2. Do not reset, rebase, revert, or discard valid existing work.
3. Do not repeat complete repository scans, old migrations, old audits, or long history summaries.
4. Do not launch dynamic workflows, parallel subagents, large review teams, or Codex.
5. Do not wait for random future Discord events when a replay-safe fixture or controlled webhook can prove the path.
6. Do not stop after planning.
7. Do not present strategy menus.
8. Do not ask what to work on next.
9. Do not leave verified work only on a local branch.
10. Do not claim completion because tests pass.
11. Do not fabricate production data, trading performance, Discord calls, balances, or PnL.
12. Do not convert unknown values to zero.
13. Do not print or expose secrets.
14. Do not use member/client funds for automated testing.
15. Do not sign or broadcast a funded mainnet transaction without one explicit final owner approval containing the exact account, amount, destination, risk limits, and rollback/stop procedure.
16. Keep funded mainnet activation disabled until the final controlled activation gate.
17. Ask the owner for only one unavoidable action at a time.
18. At an irreversible production or funded-transaction approval gate, stop once and wait. Never loop.
19. For internally solvable work, continue without asking.

For each milestone:

inspect relevant code only
→ implement the root-cause correction
→ run targeted tests
→ run the full quality suite
→ commit with a descriptive message
→ deploy the exact verified artifact
→ verify production
→ record evidence
→ continue automatically.

# AUTHORITATIVE PROJECT SOURCES

Read only what is needed from:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/DEGENARATION_MASTER_SPEC.md`
- `docs/ai/IMPLEMENTATION_STATUS.md`
- `docs/ai/OPEN_BLOCKERS.md`
- `docs/ai/PENDING_DEPLOYMENT.md`
- `docs/ai/FINAL_EXECUTION_HANDOFF.md`
- `docs/ai/DISCORD_LISTENER_EVIDENCE.md`
- `docs/ai/MIZAR_REFERENCE_INVENTORY.md`
- `docs/ai/MIZAR_PARITY_MATRIX.md`
- `docs/ai/CLICK_FLOW_MAP.md`
- `docs/ai/REFERENCE_COVERAGE.md`
- current Git status/diff/log
- current Vercel deployment
- current Supabase schema/functions/RLS
- current Railway projects/services/deployments/variables
- the local Mizar screenshots/videos
- the `SETTINGS AND FUNCTIONS IDEA` folder
- the `PNL CARDS` folder

Do not decode all media again.

Use the reference inventory, parity matrix, and click-flow map first. Open only the exact frame or image needed for one unresolved UI or interaction detail.

Reproduce the familiar Mizar workflow and information architecture using original DegenAration branding. Do not copy Mizar trademarks, logo, exact proprietary copy, source code, or artwork.

# DEPENDENCY AND TOOLING RULE

Before changing dependencies:

1. Identify the existing package manager from the lockfile.
2. Use the existing package manager only.
3. Audit existing dependencies and scripts.
4. Install only packages genuinely required for an identified missing implementation.
5. Prefer existing project libraries over adding new ones.
6. Pin compatible versions.
7. Update the lockfile.
8. Run license, vulnerability, type, build, and bundle checks.
9. Do not install arbitrary “AI UI” packages, unmaintained packages, duplicate libraries, or packages that merely hide missing engineering.
10. Do not install global tools unless the repository explicitly requires them.
11. Never replace the existing architecture with a new framework to avoid finishing the current implementation.

Permitted categories only when needed:

- Solana/Jupiter transaction construction and simulation;
- durable worker/queue infrastructure already compatible with the project;
- strict schema validation;
- integer-safe amount handling;
- tested QR/image export;
- browser automation already used by the project;
- accessible UI primitives already compatible with the current design system;
- observability and structured logging.

Document each new package, reason, version, security impact, and removal alternative.

# MILESTONE 1 — ESTABLISH THE REAL PRODUCTION EXECUTION ARCHITECTURE

The current interface says the execution worker is missing. Resolve this at the infrastructure and code level.

## 1.1 Inventory current production services

Identify and verify:

- the Vercel application deployment;
- the Railway Discord bot/listener service;
- any Railway worker service;
- any legacy Render listener;
- Supabase production project;
- RPC/indexer configuration;
- Privy or other delegated-signing integration;
- Jupiter quote/swap integration;
- fee-account resolver;
- worker leases/queues;
- health endpoints;
- alert destination;
- emergency stop control;
- all relevant deployment SHAs.

Produce one concise internal deployment map. Do not expose variable values or secrets.

## 1.2 One authoritative listener

There must be one authoritative Discord listener.

Requirements:

- deploy current committed bot/listener source to Railway;
- verify source SHA and build SHA;
- verify bot login;
- verify Message Content intent;
- verify guild/channel access;
- verify heartbeat;
- verify structured logs;
- retire or disable the duplicate legacy listener after Railway is proven healthy;
- ensure deduplication remains enforced;
- ensure no period exists where both listeners can create duplicate intents.

If the duplicate service is outside available access, finish everything else and present one exact owner action naming the service and required operation.

## 1.3 One authoritative execution worker

There must be a deployed worker process that:

- claims durable jobs with leases;
- renews leases;
- recovers expired leases;
- processes only eligible durable intents;
- reads immutable subscriber configuration snapshots;
- validates capital reservations;
- obtains fresh quotes;
- validates quote expiry;
- runs pre-submit simulation;
- enforces priority fee, slippage, retry, cooldown, limits, security filters, TP/SL/trailing/DCA state, pause, and kill switches;
- requests signing through the approved signer policy;
- persists the signature before downstream processing;
- confirms the transaction;
- records executed amounts;
- settles positions/lots;
- schedules and executes exits;
- reconciles all ledgers;
- emits health and failure alerts.

Deploy the worker to the existing authorized Railway project or service architecture. Do not create an unnecessary duplicate project.

Required worker states:

- healthy/idle;
- processing;
- paused;
- exit-only;
- degraded;
- stopped;
- fatal configuration error.

Expose safe admin diagnostics without exposing secrets.

## 1.4 Secure signer boundary

Inspect existing delegated-signing configuration.

Required:

- no raw private key in repository;
- no private key in client/browser code;
- no secret printed to logs;
- server-side authorization;
- per-user wallet ownership binding;
- exact transaction-intent binding;
- amount/mint/slippage/fee limits;
- replay protection;
- transaction expiry;
- emergency revocation;
- audit trail;
- no cross-user signing;
- no arbitrary transaction signing.

If signer credentials already exist, verify them without printing them.

If delegated signing is disabled or missing, finish all code and infrastructure that does not require the irreversible credential change, then present one exact owner action identifying:

- service;
- variable or dashboard setting;
- expected non-secret format;
- why it is required;
- how to verify it;
- rollback/disable action.

Do not request secrets inside the chat transcript.

# MILESTONE 2 — REGISTERED-CHANNEL DISCORD SCANNER

Only active, registered, admin-approved Discord channels may generate calls or copied trades.

## 2.1 Authorization source

Use production database records for:

- guild/server ID;
- channel ID;
- approval status;
- active/removed state;
- linked source profile;
- linked Discord owner where required;
- approval timestamps;
- admin actor;
- removal/rejection reason.

Authorization must happen before journaling or subscriber fan-out.

## 2.2 Supported Discord messages

Support:

- human messages;
- third-party bot messages;
- webhook messages;
- embed-only messages;
- empty `message.content`;
- multiple embeds;
- embed title;
- description;
- fields;
- author;
- footer;
- URL;
- buttons/action rows;
- supported external links;
- attachments;
- replies/referenced messages;
- partial Discord objects;
- `MESSAGE_CREATE`;
- `MESSAGE_UPDATE`;
- preserved deletion history.

Ignore only messages created by the DegenAration application itself. Never reject every `author.bot` message.

## 2.3 CA/mint extraction

Extract candidate Solana addresses from all supported text-bearing fields and URLs.

Then:

- validate base58 syntax;
- validate on-chain mint/account type;
- reject ambiguous multiple candidates unless the source identifies the token unambiguously;
- never guess;
- record exact parser path;
- record exact rejection/quarantine reason;
- preserve source event versions;
- deduplicate by guild ID + channel ID + message ID;
- ensure edits cannot create duplicate trades;
- ensure deletions preserve journal history.

## 2.4 End-to-end scanner proof

Prove:

registered channel
→ incoming automated call
→ authorization
→ immutable raw event
→ parser
→ mint validation
→ market scanner
→ canonical call
→ source profile
→ call-time price
→ performance tracking
→ eligible subscribers
→ immutable config snapshot
→ durable trade intent.

Use a replay-safe stored embed, deterministic fixture against the production parser/contracts, or an approved controlled webhook. Do not fabricate public performance history.

# MILESTONE 3 — COMPLETE THE BOT BUILDER AND MIZAR-FAMILIAR SETTINGS

The current production builder is not accepted merely because switches exist.

Rebuild and verify the complete Discord and KOL workflow in the order demonstrated by the references:

1. source/strategy;
2. wallet;
3. automatic entries;
4. automatic exits;
5. funding and exposure;
6. risk limits;
7. take profit;
8. stop loss;
9. trailing behavior;
10. DCA;
11. security/scanner filters;
12. execution/slippage/priority fee/retries/cooldown;
13. review;
14. save/activate;
15. edit/pause/resume/exit-only/archive.

Every optional module must have a visible, accessible, persisted, backend-enforced On/Off control.

Required controls:

- automatic entry;
- automatic exit;
- emergency stop;
- maximum capital;
- maximum open positions;
- daily spend limit;
- daily loss limit;
- per-token exposure;
- TP master;
- every TP level;
- TP sell percentage;
- SL;
- trailing TP;
- trailing SL;
- DCA master;
- every DCA level;
- DCA amount or percentage;
- liquidity filter;
- market-cap filter;
- token-age filter;
- holder/concentration filter;
- mint authority;
- freeze authority;
- blacklist;
- security/rug filters;
- slippage;
- priority-fee strategy;
- priority-fee maximum;
- quote expiration;
- retries;
- retry bounds;
- cooldown;
- pause;
- resume;
- exit-only;
- kill switch.

Every control must:

- display On/Off text;
- be keyboard accessible;
- have correct ARIA semantics;
- reveal only relevant settings;
- disable irrelevant settings semantically;
- save exact values;
- reload exact values on edit;
- create a new version on change;
- be included in immutable intent snapshots;
- be enforced by intent creation and worker execution.

A decorative control fails acceptance.

# MILESTONE 4 — AUTHORITATIVE CAPITAL CALCULATION

Use one integer-safe formula everywhere:

perPositionPlannedCapital =
entryAmount
+ sum(all enabled DCA allocations for one position)

minimumPlannedCapital =
perPositionPlannedCapital
× maximumOpenPositions

Rules:

- TP and SL do not increase planned capital.
- Network/rent/fee reserve is separate and clearly labelled.
- Disabled DCA levels are excluded.
- Per-token exposure must be at least the per-position planned capital.
- Maximum capital must be at least the minimum planned capital.
- Validation must identify the exact failing field, formula, and required minimum.
- Use lamports/integer units, never binary floating-point money arithmetic.
- Save, reload, edit, API validation, worker validation, and UI display must use the same module.

Required test cases:

- DCA disabled;
- one DCA level;
- multiple DCA levels;
- disabled middle level;
- percentage-based DCA;
- fixed-amount DCA;
- precision boundaries;
- invalid exposure;
- invalid maximum capital;
- save/reload/edit parity;
- UI/server/worker formula parity.

# MILESTONE 5 — FULL AUTO-TRADING VERTICAL SLICE

Complete the real implementation:

Discord/KOL signal
→ subscriber eligibility
→ config snapshot
→ capital reservation
→ durable intent
→ quote
→ unsigned simulation
→ signing authorization
→ submission
→ signature persistence
→ confirmation
→ execution amounts
→ position and lots
→ monitoring
→ TP/SL/trailing/DCA exit decisions
→ exit submission/confirmation
→ 2% platform fee
→ Discord or KOL creator allocation
→ referral allocation
→ DegenAration remainder
→ cash movement
→ reconciliation
→ Portfolio/performance update.

Required invariants:

- no duplicate intent;
- no duplicate reservation;
- no duplicate submission;
- no duplicate charge;
- no duplicate creator/referral reward;
- no duplicate settlement;
- no duplicate withdrawal;
- no successful state before chain confirmation;
- no confirmed signature lost after a database failure;
- no withdrawal of locked capital;
- no fee or commission on failed/unconfirmed trades;
- immutable financial records;
- integer-safe accounting;
- one authoritative accounting model;
- idempotent retries;
- recoverable worker crashes;
- bounded backoff;
- no silent dead jobs;
- health alerts;
- pause blocks entries but preserves exits;
- emergency stop blocks new entries;
- exit-only preserves risk reduction.

Run deterministic tests and unsigned mainnet simulation. Do not broadcast funded transactions before final owner approval.

# MILESTONE 6 — PLATFORM FEE ACCOUNT

The platform fee must be operational, not merely displayed.

Required:

- platform fee: 2%;
- fee computed on confirmed executed notional under the documented business rule;
- UI fee preview must equal actual charged fee logic;
- no fee on failed or unconfirmed transactions;
- creator/referral allocations derived only from confirmed executions;
- correct Jupiter output-mint fee token account;
- resolve or create the Associated Token Account for each required output mint according to supported architecture;
- do not use an owner wallet address where Jupiter requires a token account;
- persist and reconcile fee entries;
- verify no zero-bps fallback in production.

If creating the production token account costs SOL or requires an owner signature:

1. finish all code and checks first;
2. calculate the exact account/mint/action;
3. show the estimated one-time cost;
4. present rollback/disable procedure;
5. ask once for explicit owner approval;
6. never choose an arbitrary wallet or amount.

# MILESTONE 7 — MARKETPLACE AND PERFORMANCE

Every approved source must show real:

- server avatar;
- server name;
- registered channels;
- approval/listener/scanner status;
- last call and freshness;
- token;
- symbol;
- mint;
- call-time price;
- market cap;
- liquidity;
- current price;
- verified peak;
- current return;
- maximum return;
- `-50%`;
- `+50%`;
- `+100% / 2x`;
- `+400% / 5x`;
- total/open/closed calls;
- win rate;
- average return;
- median return;
- best/worst call;
- 1D/7D/30D;
- drawdown;
- followers;
- copied executions;
- confirmed copied volume;
- complete journal.

Do not mix source-call performance with subscriber execution PnL.

Unknown values must show Monitoring, Collecting data, Insufficient history, or Unavailable. Never show fabricated zeroes.

# MILESTONE 8 — FULL PRODUCT UI

Complete every unresolved Mizar-parity row for:

- global shell;
- Bots overview;
- Discord marketplace;
- Discord source profile;
- Discord builder/edit;
- KOL marketplace;
- KOL builder/edit;
- My Bots/Bot Manager;
- Affiliate;
- Portfolio;
- winning PnL card;
- losing PnL card;
- Portfolio PnL card;
- Admin Console;
- dialogs;
- confirmations;
- loading;
- empty;
- error;
- mobile/tablet/desktop states.

Visual requirements:

- original DegenAration logo;
- black/gold/white;
- compact senior-quality trading UI;
- familiar Mizar workflow;
- clear hierarchy;
- professional SVG icons;
- no emoji icons;
- no fake server covers;
- no random polygons;
- no generic AI marketing-card layout;
- no giant empty panels;
- no walls of text;
- tabular financial numbers;
- clear On/Off state;
- concise tooltips/info buttons;
- polished focus, hover, loading, disabled, success, and error states.

# MILESTONE 9 — PORTFOLIO, PNL, AFFILIATE, AND ADMIN

## Portfolio

Complete authoritative:

- total balance;
- principal;
- available;
- locked;
- pending trades;
- pending withdrawals;
- tradable;
- withdrawable;
- deposits;
- withdrawals;
- open positions;
- closed positions;
- lots;
- source attribution;
- realized PnL;
- unrealized PnL;
- trade history;
- deposit/withdrawal history;
- 7D/30D/3M charts;
- reconciliation status.

## PnL cards

Complete:

- winning trade;
- losing trade;
- Portfolio summary;
- authoritative values;
- pair/token;
- entry/current/exit;
- PnL percentage;
- multiple;
- duration;
- DegenAration logo;
- referral link when eligible;
- canonical link otherwise;
- matching QR;
- high-resolution export;
- share action;
- no private address or secret leakage.

## Affiliate

Complete:

- Discord earnings;
- KOL earnings;
- invites;
- approved editable slug;
- collision/reserved-word validation;
- immutable reward ledger;
- minimum withdrawal;
- configured withdrawal fee;
- payout history;
- idempotent payout.

## Admin

Restrict server-side to the approved administrator account.

Show every client’s:

- reconciled balances;
- positions;
- deposits;
- withdrawals;
- PnL;
- bots;
- source subscriptions;
- failed trades;
- failed withdrawals;
- reconciliation alerts;
- fees;
- creator/referral allocations;
- confirmed volume today/7D/30D/lifetime.

Allow approve/reject/remove/archive Discord sources. Never allow arbitrary balance editing.

# MILESTONE 10 — QUALITY, COMMIT, DEPLOY, AND PRODUCTION ACCEPTANCE

Use the authenticated browser session.

Test at 390px, 768px, 1024px, and 1440px.

Fail acceptance for:

- horizontal overflow;
- infinite spinner;
- browser console errors;
- failed requests;
- dead controls;
- placeholder actions;
- fake zero values;
- non-persisting switches;
- edit pages that lose settings;
- settings ignored by the worker;
- preview/production mismatch;
- worker/listener SHA mismatch;
- duplicate listeners;
- missing alerts;
- missing reconciliation.

Run:

- format;
- lint;
- strict typecheck;
- unit tests;
- integration tests;
- contract tests;
- migration tests;
- RLS tests;
- worker tests;
- Discord replay tests;
- unsigned mainnet simulation;
- browser tests;
- production build;
- dependency audit;
- secret scan;
- financial-invariant tests;
- accessibility smoke tests.

Fix every BLOCKER/HIGH finding and financial/security/data-integrity MEDIUM finding.

Commit each milestone separately with descriptive messages.

Deploy every verified change:

- Vercel app;
- Supabase migrations/functions;
- bot bridge;
- Railway Discord listener;
- Railway execution worker.

Verify:

- exact Git SHA;
- exact deployment SHA;
- `/api/build`;
- Railway health;
- worker health;
- listener heartbeat;
- schema/function parity;
- production browser behavior.

Do not leave completed fixes undeployed.

# FINAL CONTROLLED MAINNET ACTIVATION GATE

When and only when all code, infrastructure, simulations, and production browser verification pass, present one concise gate containing:

- exact environment;
- exact Vercel SHA;
- exact bot SHA;
- exact worker SHA;
- exact Supabase migration/function versions;
- signer status;
- fee token account status;
- emergency stop status;
- reconciliation status;
- tests passed;
- selected owner-controlled canary account;
- selected high-liquidity pair;
- exact maximum amount;
- exact slippage;
- exact maximum positions;
- exact TP/SL;
- exact expected platform fee;
- rollback/disable command;
- confirmation that no client funds will be used.

Wait for explicit approval.

After approval, run one minimal owner-controlled canary only.

Verify:

intent
→ reservation
→ quote
→ signature
→ submission
→ confirmation
→ position
→ fee
→ reconciliation
→ controlled exit
→ Portfolio update.

If any invariant fails:

- activate emergency stop;
- preserve exits;
- stop new entries;
- reconcile;
- report exact failure;
- do not retry funded trading automatically.

Do not enable all clients until the canary passes.

# DONE CONDITION

Do not claim completion until:

1. the production execution worker is deployed and healthy;
2. the production listener scans only active registered approved channels;
3. third-party bot/webhook CA embeds reach the journal;
4. all settings are persisted, versioned, and enforced;
5. the capital formula is consistent in UI/server/worker;
6. the fee account is valid and fees do not silently fall to zero;
7. all internally solvable auto-trading stages are complete;
8. Discord/KOL/Bot Manager/Affiliate/Portfolio/PnL/Admin work in authenticated production browser tests;
9. every verified change is committed and deployed;
10. production serves the verified SHAs;
11. the only remaining step is the explicit owner-controlled mainnet canary approval, or the canary has passed and controlled activation is ready.

Start now at the missing execution worker and continue sequentially through this entire goal.

Do not stop for summaries.

Stop only for one exact irreversible owner action.
