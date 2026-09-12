# DEGENARATION FINAL EXECUTION PROMPT
## Full Repository Scan, Financial Recovery, Auto-Trading, Admin Console, Mizar-Familiar UI, Skills, and Public-Launch Validation

You are the final lead senior engineer, product designer, Solana engineer, database engineer, security engineer, QA engineer, and release owner for the existing DegenAration repository.

This is a continuation and completion assignment.

Do not restart the project.
Do not discard valid Claude or Codex work.
Do not replace the approved product plan.
Do not present another menu of implementation choices.
Do not stop after planning.
Do not run a large parallel workflow.
Do not repeatedly rescan unchanged files.
Do not rerun a failed command without changing its cause.
Do not claim success from a passing build alone.

Make the safest technically correct decision and continue through every internally solvable requirement in dependency order.

The required final result is:

1. User balances, trading eligibility, and principal withdrawal are correct and verified.
2. Discord and KOL automated trading work through durable intents, execution, confirmation, settlement, fees, and reconciliation.
3. The Admin Console securely shows each client’s relevant balances, positions, financial activity, and confirmed trading volume.
4. The complete Bots, Affiliate, Portfolio, referrals, commissions, PnL cards, and Discord-source plan works.
5. The interface and workflows are immediately familiar to former Mizar users.
6. DegenAration keeps its own logo, black/gold/white identity, original artwork, and original implementation.
7. The repository becomes a tested launch candidate with exact remaining blockers documented.

---

# 1. OPERATING RULES

Use this workflow:

```text
inspect current state once
→ record evidence
→ identify the first failing dependency
→ implement the root-cause fix
→ run targeted tests
→ run milestone validation
→ commit
→ continue automatically
```

Never:

- restart the full audit because one test fails;
- decode all videos again when the reference inventory already documents them;
- ask the owner what milestone to do next;
- create repeated plans without implementation;
- wait for Codex when Codex usage is unavailable;
- allow multiple agents to edit the same files concurrently;
- use generic placeholder data;
- disable linting, type checking, RLS, authorization, financial safeguards, or tests;
- deploy unrelated code with a financial hotfix.

Ask the owner only for a genuine external blocker:

- missing production credential;
- missing Discord permission;
- unavailable RPC/indexer;
- inaccessible database;
- missing signer access;
- missing Vercel/Supabase production permission;
- irreversible business decision.

Continue autonomously through everything else.

---

# 2. REAL-MONEY SAFETY

Never expose or log:

- private keys;
- seed phrases;
- Privy tokens;
- JWTs;
- cookies;
- service-role keys;
- OAuth secrets;
- wallet-signing material;
- database passwords;
- funded-wallet credentials.

Never:

- use JavaScript floating-point arithmetic for money;
- mark a trade successful before on-chain confirmation;
- broadcast funded mainnet transactions in automated tests;
- manually change a user balance to make the UI look correct;
- move user funds without an authorized financial operation;
- fabricate financial rows, positions, performance, volume, or commissions;
- apply an unverified migration directly to production;
- enable automated mainnet trading only to remove a blocker.

Use:

- lamports;
- token base units;
- integer basis points;
- decimal-safe database values;
- durable intents;
- unique constraints;
- immutable financial events;
- persisted signatures;
- explicit state machines;
- reconciliation.

Continue automatically through code, tests, preview, and safe staging validation.

Stop once before any irreversible production action and present:

- exact target;
- exact Git SHA;
- exact migration/function/build;
- tests passed;
- expected row changes;
- expected user-visible result;
- rollback procedure;
- confirmation that no unrelated work is included.

Do not present another architecture-choice menu.

---

# 3. PRESERVE THE CURRENT PROJECT

Before editing:

1. Confirm the repository root.
2. Read:
   - `CLAUDE.md`
   - `AGENTS.md`
   - `docs/DEGENARATION_MASTER_SPEC.md`
   - every current file under `docs/ai/`
   - `docs/activity-log.md` when present
3. Inspect:
   - current branch;
   - `git status --short`;
   - `git diff`;
   - `git diff --staged`;
   - untracked files;
   - recent commits;
   - migrations;
   - Supabase functions;
   - Vercel configuration;
   - Discord workers;
   - scanner;
   - trading workers;
   - Portfolio;
   - withdrawals;
   - fees;
   - referrals;
   - PnL.
4. Preserve valid work from all existing branches and commits.
5. Do not run `git reset --hard`.
6. Do not delete an uncommitted file without proving it is invalid.
7. Do not commit secrets, `.env` files, credentials, or large reference media.

Create or update:

`docs/ai/FINAL_EXECUTION_HANDOFF.md`

Record:

- repository root;
- branch;
- commit;
- modified files;
- untracked files;
- deployed Supabase functions;
- migration state;
- deployed Vercel branch and SHA when obtainable;
- completed requirements;
- partial requirements;
- failed requirements;
- external blockers;
- exact next dependency.

Do not stop after writing this file.

---

# 4. ONE FULL PROJECT SCAN

Perform one complete scan, update the status documents, and then execute. Do not repeat this scan unless code in that area changes.

Scan:

## Financial

- deposits;
- Privy/custody wallets;
- wallet registration;
- principal accounting;
- available/locked/pending balances;
- trade intents;
- trade executions;
- positions;
- position lots;
- partial entries/exits;
- withdrawal intents;
- signatures;
- fees;
- commissions;
- referral rewards;
- payouts;
- reversals;
- reconciliation;
- Portfolio balances/charts/histories.

## Trading

- Discord registration and commands;
- Discord source approval;
- events/messages/embeds;
- parser;
- mint extraction;
- Solana validation;
- liquidity routes;
- scanner adapters;
- filters;
- KOL signals;
- subscriber fan-out;
- quote;
- simulation;
- signing;
- submission;
- confirmation;
- settlement;
- retries;
- duplicate prevention;
- worker leases;
- queues;
- monitoring.

## User product

- authentication;
- onboarding;
- Bots;
- Discord marketplace;
- KOL marketplace;
- bot setup/editing;
- pause/resume/archive;
- Affiliate;
- referrals;
- Portfolio;
- withdrawal;
- PnL cards;
- responsive UI;
- accessibility;
- loading/error/empty/provider states.

## Admin

- authorization;
- client list;
- balances;
- volume;
- positions;
- deposits/withdrawals;
- bots;
- commissions;
- referrals;
- source approvals/removal;
- health;
- audit logs;
- incident controls.

## Release

- tests;
- migrations;
- RLS;
- secrets;
- dependencies;
- build;
- Vercel;
- Supabase;
- rollback;
- monitoring;
- launch checklist.

Update:

- `docs/ai/IMPLEMENTATION_STATUS.md`
- `docs/ai/OPEN_BLOCKERS.md`
- `docs/ai/RELEASE_CHECKLIST.md`

Use PASS, PARTIAL, FAIL, BLOCKED.

PASS requires reproducible evidence.

---

# 5. FINANCIAL AND WITHDRAWAL GATE — COMPLETE FIRST

Do not proceed to “final UI complete” status while user funds remain unexplained, non-tradable, or non-withdrawable.

## 5.1 One authoritative balance model

Define and implement:

```text
total_reconciled_principal
available_balance
locked_balance
pending_trade_balance
pending_withdrawal_balance
tradable_balance
withdrawable_balance
realized_pnl
unrealized_pnl
```

Required invariant:

```text
total reconciled principal
=
available
+ legitimately locked
+ valid pending movements
```

Reconcile:

- verified Privy user;
- persisted Solana wallet;
- on-chain/custody balance;
- principal ledger;
- open-position allocation;
- pending trade intents;
- pending withdrawals;
- displayed Portfolio balance.

No unexplained difference is allowed.

## 5.2 Wallet identity

Use one canonical authenticated wallet-registration path.

Requirements:

- derive identity from verified Privy session;
- never trust arbitrary user ID or wallet from the request body;
- validate Solana address;
- idempotent repeated sign-in;
- cross-user overwrite denied;
- legitimate wallet change audited;
- immutable wallet audit trail;
- RLS and server authorization;
- Portfolio, trading, and withdrawal use the same wallet;
- no auth material in logs.

## 5.3 Durable trade intents

Create a durable intent before capital is quoted, signed, or submitted.

State model:

```text
created
validated
capital_reserved
quoted
simulated
submitted
confirmed
reconciled

terminal:
rejected
failed
expired
cancelled
reversed
```

Persist:

- idempotency key;
- user;
- wallet;
- source signal;
- Discord source/KOL strategy;
- bot configuration version;
- subscriber configuration version;
- immutable settings snapshot;
- mint;
- side;
- requested amount;
- reserved amount;
- correlation ID;
- timestamps;
- signature.

Requirements:

- reserve capital transactionally;
- retries reuse the intent;
- duplicate signal cannot reserve twice;
- terminal failure releases capital;
- submitted intent keeps capital locked;
- database failure does not lose a confirmed transaction;
- worker restart does not duplicate execution.

## 5.4 Execution and settlement

Implement one authoritative execution writer.

Persist:

- intent;
- signature;
- slot/block;
- mint;
- side;
- requested/executed quantity;
- requested/executed notional;
- average price;
- slippage;
- price impact;
- network fee;
- priority fee;
- platform fee;
- status;
- confirmation;
- reconciliation.

Settlement updates:

- positions;
- position lots;
- open quantity;
- average entry;
- partial exits;
- realized/unrealized PnL;
- final close;
- available balance;
- fee ledger;
- performance journal.

No execution succeeds before confirmation.

## 5.5 Principal withdrawal

Ordinary available user principal must be withdrawable without routine admin approval.

Implement:

- amount;
- destination validation;
- network-fee estimate;
- gross/fee/net preview;
- durable withdrawal intent;
- server-enforced idempotency;
- authenticated ownership;
- amount/destination request fingerprint;
- signature persistence;
- confirmation;
- reconciliation;
- retry returning existing intent;
- no duplicate broadcast;
- failed/reversed states;
- history;
- explorer link.

A principal withdrawal may be blocked only for:

- insufficient available balance;
- capital legitimately locked;
- pending duplicate;
- invalid destination;
- network/provider outage;
- unavailable signer;
- already-submitted transaction;
- audited emergency circuit breaker;
- legally required restriction.

Affiliate reward payout is separate.

## 5.6 Platform fee

Apply:

```text
2.00% per confirmed executed swap leg
```

Use executed notional.

Never charge failed, simulated, expired, cancelled, dropped, duplicate, or unreconciled transactions.

Show:

- estimated fee before confirmation;
- exact fee in receipt/history.

Record separately:

- Discord creator allocation;
- KOL creator allocation;
- referral allocation;
- DegenAration remainder;
- network fees.

Do not create a hidden duplicate fee.

## 5.7 Financial proof

Before PASS, prove:

- wallet persistence;
- balance reconciliation;
- available balance;
- locked capital;
- duplicate-trade prevention;
- failure releasing capital;
- confirmed settlement;
- partial exit;
- pending withdrawal;
- six duplicate withdrawals collapsing to one intent;
- failed-withdrawal recovery;
- fee invariant;
- creator/referral invariant;
- cross-user denial;
- no floating-point money;
- no secret leakage.

Use local, preview, staging, simulation, or devnet. Do not broadcast funded mainnet transactions without explicit approval.

---

# 6. AUTO-TRADING SYSTEM

After the financial gate passes, finish and prove auto-trading.

Required path:

```text
Discord/KOL signal
→ eligibility
→ durable intent
→ capital reserve
→ scanner/risk filters
→ quote
→ simulation
→ signing authorization
→ submission
→ signature persistence
→ confirmation
→ execution
→ settlement
→ fees
→ position
→ reconciliation
→ performance
```

Implement:

- durable queue;
- worker lease;
- retry;
- provider failover;
- duplicate-signal protection;
- duplicate-trade protection;
- confirmation worker;
- reconciliation worker;
- scanner health;
- structured logs;
- alerts;
- emergency pause;
- exit preservation.

Live trading is not PASS until a safe staging/devnet proof works.

Do not enable `AUTOMATED_MAINNET_RELEASE` without the final controlled approval gate.

---

# 7. DISCORD AND KOL

## Discord commands

There must be exactly one command per purpose.

Verify:

- one `/register`;
- stale global/guild duplicates removed;
- guild/channel permissions;
- real backend behavior;
- idempotency;
- tests;
- no purposeless command.

## Discord ingestion

Support approved:

- normal messages;
- embeds;
- replies;
- mint addresses;
- links;
- edited messages;
- structured commands.

Pipeline:

```text
event
→ approved guild/channel
→ raw immutable event
→ parser/version
→ mint extraction
→ mint validation
→ liquidity route
→ security filters
→ accepted/rejected/duplicate
→ subscriber fan-out
→ trade intent
→ execution
→ journal/performance
```

Every event ends in an observable state.

Implement reconnect, retries, backfill where reliable, dead-letter handling, parser confidence, duplicate cooldown, provider health, slot lag, correlation IDs, and structured logs.

## Performance journal

Discord and KOL listings show real measured:

- active/scanner status;
- most recent call;
- last processed call;
- freshness;
- accepted/rejected/executed calls;
- followers;
- completed trades;
- open positions;
- 1D/7D/30D performance;
- net PnL;
- win rate;
- drawdown;
- average/median result;
- volume.

Unknown data must say:

- Collecting data;
- No eligible calls yet;
- Insufficient history;
- Scanner unavailable;
- Processing delayed;
- Last updated X minutes ago.

Never show unknown as zero.

---

# 8. ADMIN CONSOLE

The Admin Console is visible and callable only by the authorized administrator.

Primary admin:

```text
Flipthatsol@gmail.com
```

Normalize case.

Require server-side verified Google identity. Do not rely on client-side email comparison.

Normal users must not see Admin navigation, access routes, call APIs, or query other users.

## Dashboard

Show:

- users;
- active users;
- total client principal;
- available balance;
- locked balance;
- pending withdrawals;
- open-position notional;
- trading volume today;
- 7D/30D/lifetime volume;
- platform fees;
- Discord allocations;
- KOL allocations;
- referral allocations;
- DegenAration remainder;
- active bots;
- approved/pending Discord sources;
- worker health;
- reconciliation warnings;
- failed withdrawals/executions;
- stale scanners.

## Client table

Searchable, sortable, paginated.

Show:

- display name;
- verified email;
- Privy ID;
- masked public wallet;
- registration date;
- last activity;
- total principal;
- available;
- locked;
- pending trade;
- pending withdrawal;
- withdrawable;
- open-position notional;
- realized/unrealized PnL;
- volume today;
- 7D/30D/lifetime volume;
- platform fees paid;
- bots used;
- referral status;
- incident/risk status.

Use confirmed executed notional for volume. Do not use quotes, failed transactions, simulations, duplicates, or cancelled amounts.

Document the exact volume definition.

## Client detail

Show:

- balance breakdown;
- wallet history;
- deposits;
- withdrawals;
- withdrawal intents;
- trade intents;
- executions;
- positions/lots;
- fees;
- commissions;
- referrals;
- subscriptions;
- bot lifecycle;
- failed operations;
- reconciliation;
- audit events.

## Safe admin actions

Allow audited:

- approve/reject/suspend/remove Discord source;
- restore source;
- pause compromised source;
- pause new entries;
- preserve exits;
- inspect failures;
- safely retry idempotent jobs;
- export reports;
- view audit logs.

Never add an arbitrary “edit balance” button.
Never expose private keys or secrets.
Every emergency action records admin, reason, timestamp, and result.

---

# 9. COMPLETE PRODUCT PLAN

Normal users see:

1. Bots
2. Affiliate
3. Portfolio

Bots contains:

- Discord Bots
- KOL Bots
- My Bots / Bot Manager

Remove public Terminal, Tools, and Search.

Preserve:

- Discord marketplace;
- source applications/approvals/removal;
- Discord bot setup;
- KOL strategy builder;
- KOL marketplace;
- maximum three published KOL bots per normal user;
- TP/SL/DCA;
- scanner presets/filters;
- bot editing;
- pause/resume/archive;
- Affiliate Discord/KOL earnings;
- referral URL and editable approved slug;
- principal withdrawals;
- reward payouts;
- Portfolio;
- open positions;
- trade history;
- deposit/withdrawal history;
- 7D/30D/3M charts;
- winning/losing/Portfolio PnL cards;
- Admin Console.

Every visible control must persist and affect real behavior or be disabled with a truthful reason.

---

# 10. SCAN ALL MIZAR AND DEGENARATION REFERENCES

Search:

1. `~/Desktop/DEGENARATION/`
2. `~/Documents/degenaration/.references/`
3. reference paths recorded under `docs/ai/`
4. nested Desktop folders

Important folders:

- `PNL CARDS`
- `SETTINGS AND FUNCTIONS IDEA`

Known files include variants of:

- `Screen Recording 2026-07-22 at 2.14.03 AM.mov`
- `Screen Recording 2026-07-22 at 2.21.02 AM.mov`
- `Screen Recording 2026-07-29 at 8.13.17 PM.mov`
- `Screen Recording 2026-07-30 at 7.11.08 PM.mov`
- `DISCORD BOT PLAN FULL VIDEO OF VISION.mov`
- `DISCORD BOT PLAN FULL VIDEO OF VISION(2).mov`
- `FULL VIDEO OF IDEA OF FULL DESIGN AND FUNCTIONAL OF KOL BOT.mov`
- `FULL VIDEO OF IDEA OF FULL DESIGN AND FUNCTIONAL OF KOL BOT(3).mov`
- `DISCORD BOT AND KOL BOT AFFILIATE .mov`
- `DISCORD BOT AND KOL BOT AFFILIATE (4).mov`
- `How it looks like when its done, you can edit your setups .mov`
- `How it looks like when its done, you can edit your setups (1).mov`
- `PORTFOLIO FULL PLAN.mov`
- `PORTFOLIO FULL PLAN(4).mov`
- `explanation on KOL BOT.png`
- `explanation on KOL BOT(9).png`
- winning, losing, and Portfolio PnL images.

Do not assume the list is exhaustive.

Create/update:

- `docs/ai/FINAL_REFERENCE_INVENTORY.md`
- `docs/ai/MIZAR_REFERENCE_INVENTORY.md`
- `docs/ai/MIZAR_PARITY_MATRIX.md`
- `docs/ai/CLICK_FLOW_MAP.md`
- `docs/ai/REFERENCE_COVERAGE.md`

For every reference workflow record:

- file;
- timestamp/image;
- screen;
- controls;
- click order;
- conditional behavior;
- validation;
- loading/error/empty/success;
- DegenAration route/component;
- backend dependency;
- status;
- evidence.

Use existing inventories first. Decode a video again only for a specific missing detail. Use ffprobe/ffmpeg when needed. Do not commit large media.

---

# 11. MIZAR-FAMILIAR UI TARGET

Former Mizar users must immediately understand DegenAration.

Match the demonstrated:

- navigation;
- control placement;
- setup order;
- grouping;
- density;
- forms;
- tabs;
- dialogs;
- dropdowns;
- tables;
- marketplace;
- Bot Manager;
- editing;
- performance;
- progressive disclosure;
- confirmations;
- Portfolio;
- Affiliate;
- tooltips/help;
- mobile behavior.

Do not copy Mizar’s trademark, logo, exact proprietary text, source code, illustrations, branded artwork, or protected assets.

Preserve:

- DegenAration name;
- DegenAration logo;
- black/gold/white branding;
- original icons/art;
- original implementation.

The result must be an original DegenAration product with extremely familiar workflow and professional minimalism.

---

# 12. DESIGN SYSTEM — REMOVE GENERIC AI APPEARANCE

Build one coherent design system.

Use:

- deep black canvas;
- layered near-black surfaces;
- gold derived from the existing logo;
- warm white text;
- muted neutral secondary text;
- restrained emerald gains;
- restrained crimson losses;
- accessible gold focus;
- subtle depth;
- compact cards;
- strong alignment;
- tabular numerals;
- professional spacing;
- polished loading/empty/error/provider states.

Remove:

- emoji icons;
- random gradients;
- meaningless polygons;
- fake Discord covers;
- `D/A` decorative initials;
- giant empty cards;
- excessive uppercase;
- walls of technical copy;
- template-marketplace look;
- fake glassmorphism;
- inconsistent icons;
- decorative nonfunctional controls.

Use one professional SVG icon system. Create original DegenAration feature icons where needed.

Use concise beginner-friendly text. Put secondary guidance behind accessible info icons/tooltips. Keep essential fee/risk/confirmation information visible.

Audit existing dependencies before adding any. 21st.dev, shadcn/Radix, or similar may be used only for suitable primitives and must be fully restyled into one system. Do not combine unrelated templates.

---

# 13. REQUIRED USER WORKFLOWS

## Discord marketplace cards

Show:

- real server profile picture;
- name;
- verified/scanner status;
- latest call;
- freshness;
- 1D/7D/30D performance;
- accepted/executed calls;
- win rate;
- net PnL;
- drawdown;
- followers;
- commission;
- clear action.

No fake cover.

## Discord setup order

1. Identity
2. Wallet
3. Server
4. Channel
5. Buy amount
6. Maximum trades
7. Maximum capital
8. Entry
9. Slippage
10. Priority fee
11. Retry
12. TP levels
13. Sell percentages
14. Trailing TP
15. Stop loss
16. Dynamic stop
17. Security filters
18. Cooldown/duplicates
19. Capital summary
20. Fee summary
21. Confirmation
22. Save/activate
23. Edit

## KOL setup

- name/description;
- wallet;
- buy amount;
- maximum capital/trades;
- token universe;
- scanner preset;
- filters;
- price-drop trigger;
- reference mode/lookback;
- DCA;
- TP/trailing;
- SL;
- retry/cooldown/freeze;
- auto-refresh;
- token preview;
- risk/capital/fee summary;
- confirmation;
- save/publish/edit.

## Bot Manager

- Discord/KOL tabs;
- status;
- source;
- performance;
- capital;
- positions;
- fees;
- pause/resume/edit/duplicate/archive;
- signals;
- executions.

Edits load persisted settings and create a new configuration version. Existing positions keep the entry snapshot.

## Affiliate

Show pending, available, paid, reversed, source, volume, fee basis, rate, history, referral URL, editable approved slug, payout eligibility/history.

Prevent self-referral, duplicates, linked-account abuse, reserved slugs, and reward without confirmed eligible execution.

## Portfolio

Show:

- total;
- available;
- locked;
- pending trade;
- pending withdrawal;
- realized/unrealized/net PnL;
- 7D/30D/3M chart;
- Discord/KOL positions;
- trade history;
- deposits;
- withdrawals;
- signatures;
- fees;
- PnL sharing.

Separate cash flows from trading performance.

## PnL cards

Create original:

1. Winning
2. Losing
3. Portfolio

Use server-authoritative entry, exit/current, partial fills, fees, net PnL, duration, source, timestamp, referral/canonical URL, QR, and immutable snapshot.

Add sharing to open positions, completed trades, and Portfolio.

Generate deterministic high-resolution PNG or WebP.

---

# 14. CLAUDE PROJECT COMMANDS AND SKILLS

Create concise persistent project guidance.

Update `CLAUDE.md` to point to:

- master specification;
- this final execution prompt;
- implementation status;
- accounting model;
- Mizar parity matrix;
- release checklist.

## Slash commands

Detect the supported project-local command format. Prefer `.claude/commands/`.

Create:

### `/goal` or `/degenaration-goal`

If `/goal` is reserved, use `/degenaration-goal`.

It must:

- read status;
- find first failing dependency;
- implement continuously;
- avoid plan-only responses;
- stop only at production/external gate.

### `/fullscan`

- one full scan;
- update status;
- avoid repeated scans;
- begin root-cause fix.

### `/finance-gate`

- balances;
- wallets;
- intents;
- executions;
- settlement;
- withdrawal;
- fees;
- reconciliation;
- invariants;
- no funded tests.

### `/mizar-ui`

- read reference/parity docs;
- inspect only missing frames;
- implement next UI gap;
- capture responsive evidence;
- no generic AI UI;
- no copied Mizar branding.

### `/admin-console`

- secure admin;
- client balances;
- client volume;
- positions;
- histories;
- sources;
- audit logs;
- no unsafe balance editing.

### `/release-audit`

- migrations;
- RLS;
- security;
- financial invariants;
- browser tests;
- responsive tests;
- rollback;
- evidence.

## Skills

Detect the supported project-local skills directory. Prefer `.claude/skills/<name>/SKILL.md`.

Create:

- `degenaration-financial-integrity`
- `degenaration-mizar-parity`
- `degenaration-discord-ingestion`
- `degenaration-admin-operations`
- `degenaration-release-audit`

Each skill must contain focused rules, commands, evidence, and prohibited behavior. Do not duplicate the entire master specification.

Use specialist reviewers only after a milestone, one at a time, read-only first.

---

# 15. TESTING

Add/complete tests for:

- numeric input leading zero;
- wallet registration;
- cross-user denial;
- admin authorization;
- balances;
- intents;
- duplicate signals;
- reserve/release;
- execution;
- confirmation;
- reconciliation;
- positions/lots;
- partial exits;
- withdrawal idempotency;
- failure/recovery;
- fees;
- creator/referral allocation;
- Discord commands;
- ingestion/journal;
- scanner states;
- bot lifecycle;
- referral slug;
- PnL export;
- responsive workflows.

Use the existing browser framework or Playwright.

Verify widths:

- 390;
- 768;
- 1024;
- 1440.

Capture evidence for:

- Bots;
- Discord marketplace/profile/setup;
- KOL setup;
- Bot Manager;
- Affiliate;
- Portfolio;
- Withdraw;
- Admin dashboard/client detail;
- PnL cards.

Check overflow, clipping, dialogs, keyboard, focus, reduced motion, loading loops, console errors, failed requests, false zeros, icons, and excessive copy.

Run:

- formatting;
- lint;
- strict type checking;
- unit;
- integration;
- browser;
- production build;
- migrations;
- RLS;
- secret scan;
- dependency audit;
- financial invariants;
- accessibility;
- responsive review;
- complete diff review.

Fix all BLOCKER/HIGH findings and relevant MEDIUM findings.

---

# 16. REQUIRED EXECUTION ORDER

1. Preserve current state and create handoff.
2. Perform one full scan.
3. Finish financial/withdrawal gate.
4. Finish auto-trading gate.
5. Finish Admin Console.
6. Complete reference inventory/parity matrix.
7. Rebuild the design system.
8. Complete Discord/KOL/Bot Manager/Affiliate/Portfolio/PnL workflows.
9. Create commands and skills.
10. Run final audit.
11. Present one production approval package.
12. After approved deployment, verify affected-user balances and controlled flows.

Commit each verified milestone separately.

Do not ask what to do next.

---

# 17. FINAL ACCEPTANCE

Complete only with evidence:

## Financial

- balances reconcile;
- tradable/withdrawable correct;
- principal withdrawal controlled flow works;
- intents reserve capital;
- duplicate trades blocked;
- confirmations settle;
- fees reconcile;
- no unexplained ledger split;
- reconciliation works.

## Auto-trading

- approved calls ingested;
- signals journaled;
- scanner observable;
- fan-out works;
- intents/execution/settlement work;
- workers recover;
- performance updates;
- no duplicates.

## Admin

- server-side admin only;
- each client’s balances visible;
- each client’s confirmed trading volume visible;
- histories/positions/bots/fees visible;
- audited controls;
- no secrets;
- no arbitrary balance editor.

## UI

- DegenAration identity preserved;
- black/gold/white;
- Mizar-familiar flow;
- no generic AI appearance;
- no emoji;
- no fake cover;
- concise copy;
- info buttons;
- responsive;
- all reference workflows mapped.

## Product

- Bots;
- Discord;
- KOL;
- Bot Manager;
- Affiliate;
- Portfolio;
- withdrawal;
- referral;
- commissions;
- PnL cards;
- Admin Console;
- histories;
- functional controls.

## Release

- no unresolved BLOCKER/HIGH;
- build/tests pass;
- migrations/RLS verified;
- secret scan clean;
- rollback documented;
- production target known;
- owner approves production actions.

Do not claim complete, fully functional, production-ready, mainnet-ready, or bug-free without evidence.

---

# 18. FINAL REPORT

Report:

1. Production status
2. Financial status
3. Withdrawal status
4. Auto-trading status
5. Discord ingestion
6. Scanner
7. Admin Console
8. Mizar parity
9. UI
10. Portfolio/PnL
11. Tests
12. Commits
13. Migrations
14. Deployment
15. External blockers
16. Owner actions
17. Controlled-mainnet readiness
18. Public-launch readiness

For every PARTIAL/BLOCKED item, state the exact missing dependency.

---

# BEGIN NOW

Start from the current repository and working tree.

Perform one full scan.

Fix and prove finance and withdrawal first.

Then continue automatically through auto-trading, Admin Console, all Mizar reference parity, complete UI, commands/skills, and final release validation.

Do not stop after planning.
Do not present another menu.
Do not loop.
Do not wait for Codex.
Do not discard existing work.
Do not enable mainnet automation without the controlled approval gate.
