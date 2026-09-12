# DEGENARATION — FINAL PRODUCT COMPLETION, COMMIT, AND PRODUCTION DEPLOYMENT

Continue from the current repository, branch, commits, database, Railway services, Supabase production project, Vercel project, authenticated browser session, and existing evidence.

This is an implementation task, not another audit or planning exercise.

## CURRENT PRODUCTION ACCEPTANCE FAILURE

The current production UI still fails the required product behavior:

1. The Discord/KOL bot builder does not provide clear per-feature ON/OFF controls like the supplied Mizar reference workflows.
2. Users cannot explicitly enable or disable optional automation modules.
3. The page still displays:
   - “Automated trading not yet available”
   - “Automated trading and payouts are not yet available”
   - similar disabled-feature banners or gates
4. The setup page can save a draft, but it does not present a complete, active, understandable Mizar-familiar configuration workflow.
5. Previous work improved backend tests and marketplace presentation, but the complete visible and functional product has not been delivered.

Treat the current production screenshots as FAILED acceptance evidence.

Do not claim completion while any of these failures remain.

---

# STRICT OPERATING RULES

- Do not restart the project.
- Do not reset, rebase, revert, or discard valid work.
- Do not repeat the whole repository scan.
- Do not re-read every unchanged file.
- Do not restate completed history.
- Do not launch dynamic workflows, parallel subagents, large review teams, or Codex.
- Do not wait for a future random Discord message when deterministic or replay-safe evidence can be used.
- Do not stop after planning.
- Do not present another strategy menu.
- Do not ask what to work on next.
- Do not leave verified fixes only on a branch.
- Do not mark a feature complete because a component renders or a unit test passes.
- Do not fabricate financial, trading, call, or performance data.
- Do not silently display unknown values as zero.
- Do not use client funds.
- Do not sign or broadcast a funded transaction during automated verification.
- Keep `mainnet_execution_enabled=false` until the final controlled activation gate.
- Ask the owner only for a genuinely unavoidable credential, browser authorization, secure signer action, fee-account action, or irreversible production deployment approval.
- Ask for only one owner action at a time.
- At any approval gate, stop once and wait. Never loop.

For each milestone:

1. inspect only relevant code and evidence;
2. implement the complete vertical slice;
3. run targeted tests;
4. run full check/typecheck/lint/build;
5. run authenticated browser verification;
6. update evidence/status documents;
7. commit with a descriptive message;
8. deploy the verified release when approved;
9. verify production;
10. continue to the next milestone automatically.

---

# REQUIRED REFERENCE REVIEW

Use these as the authoritative product references:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/DEGENARATION_MASTER_SPEC.md`
- `docs/ai/IMPLEMENTATION_STATUS.md`
- `docs/ai/OPEN_BLOCKERS.md`
- `docs/ai/PENDING_DEPLOYMENT.md`
- `docs/ai/FINAL_EXECUTION_HANDOFF.md`
- `docs/ai/MIZAR_REFERENCE_INVENTORY.md`
- `docs/ai/MIZAR_PARITY_MATRIX.md`
- `docs/ai/CLICK_FLOW_MAP.md`
- `docs/ai/REFERENCE_COVERAGE.md`
- local Mizar videos and screenshots
- `PNL CARDS`
- `SETTINGS AND FUNCTIONS IDEA`

Do not decode all media again.

First read the inventory, parity matrix, click-flow map, and coverage documents. Open only the exact video frame, image, or folder needed for a missing or disputed UI/interaction detail.

For every remaining Mizar parity row, record:

- reference screen or frame;
- expected control;
- expected default state;
- expected click behavior;
- expected persistence behavior;
- expected edit behavior;
- current production behavior;
- correction;
- browser evidence;
- PASS or external blocker.

Do not copy Mizar trademarks, logos, source code, exact proprietary text, or artwork. Reproduce the familiar workflow and information architecture using DegenAration branding.

---

# MILESTONE 1 — REBUILD THE BOT SETUP EXPERIENCE

The Discord and KOL bot builders must be complete, understandable, and operational.

## A. Feature-level ON/OFF controls

Add explicit, accessible, persisted ON/OFF controls for every optional or conditional automation module.

At minimum:

- take profit;
- each take-profit level;
- stop loss;
- trailing take profit;
- trailing stop loss;
- DCA;
- each DCA level;
- liquidity filter;
- market-cap filter;
- token-age filter;
- holder/concentration filter;
- mint/freeze authority filter;
- blacklist/security filter;
- daily spend cap;
- daily loss cap;
- per-token exposure;
- maximum open trades;
- priority-fee override;
- retry behavior;
- cooldown;
- auto-entry;
- auto-exit;
- pause/resume;
- emergency kill switch.

Required toggle behavior:

- keyboard accessible;
- clear Enabled/Disabled text, not color alone;
- correct default state;
- disabled fields are visually and semantically disabled;
- enabling reveals only the required controls;
- disabling preserves or clears values according to the reference behavior;
- save persists the enabled state and values;
- edit reloads the exact saved state;
- version history stores the state;
- immutable subscriber configuration snapshots include the state used by each intent;
- the worker enforces the state instead of merely storing it.

Do not implement decorative toggles that are ignored by the backend.

## B. Mizar-familiar setup order

Match the supplied reference flow and progressive disclosure:

1. source or strategy;
2. wallet;
3. funding and exposure;
4. risk limits;
5. take profit;
6. stop loss;
7. trailing behavior;
8. DCA;
9. security filters;
10. execution, slippage, priority fees, retries, and cooldown;
11. review;
12. save/activate;
13. edit/pause/resume/archive.

Use compact accordion sections, concise summaries, inline validation, info buttons, and a sticky review panel.

Do not fill the page with long instructional paragraphs.

## C. Validation

Fix contradictory validation such as a configured maximum capital being lower than the calculated required capital without clearly explaining the cause.

Show:

- exact invalid field;
- exact formula;
- exact minimum required value;
- how TP/DCA/open-trade choices affect required capital;
- safe correction action.

Numeric inputs must:

- remove placeholder leading zero on entry;
- support keyboard entry and paste;
- reject invalid precision;
- use SOL-safe decimal handling;
- never use floating-point arithmetic for money;
- preserve user-entered values accurately.

---

# MILESTONE 2 — REMOVE FALSE “NOT AVAILABLE” GATES

Search the entire application for all user-visible and server-side gates related to:

- automated trading unavailable;
- payouts unavailable;
- draft-only bots;
- manual trading only;
- automation not yet available;
- disabled mainnet automation;
- unavailable bot activation;
- unavailable withdrawals or payouts.

For each gate, classify it as:

1. hard-coded obsolete UI;
2. feature flag;
3. missing deployment/configuration;
4. valid safety gate;
5. genuinely incomplete implementation.

Then correct it.

Rules:

- Remove obsolete hard-coded banners.
- Do not hide a real blocker by deleting text.
- Replace global “not available” messaging with truthful per-capability state.
- A completed and configured feature must be usable.
- A feature requiring external production credentials must show a precise admin/operator status, not a vague public dead end.
- Users must not see internal implementation jargon such as E-2/E-3/E-4.
- Payouts and ordinary withdrawals must remain available when their verified financial path is operational.
- Bot activation must be possible only when the worker, signer policy, fee account, reconciliation, and emergency controls are genuinely ready.
- Draft saving, editing, pausing, resuming, and configuration validation must remain available before live activation.

Required UI state model:

- Draft
- Validated
- Ready for activation
- Active
- Paused
- Exit-only
- Error
- Archived

Each state must have explicit allowed actions and server-enforced transitions.

---

# MILESTONE 3 — COMPLETE DISCORD INGESTION AND MARKETPLACE

Complete and prove:

automated third-party bot/webhook message
→ approved guild/channel
→ immutable raw event
→ content/embed/field/button/link/attachment parser
→ mint validation
→ scanner
→ canonical call journal
→ source profile
→ call-time price
→ performance tracking
→ subscriber fan-out
→ durable intent

Requirements:

- human, bot, and webhook messages supported;
- ignore only this application’s own events;
- create/update/delete history;
- partial Discord objects handled;
- no content-only parser;
- button URLs and embed links parsed;
- deterministic deduplication;
- truthful quarantine reason;
- replay-safe verification;
- exactly one `/register`;
- one authoritative listener after Railway proof;
- no duplicate intents.

Marketplace and source profiles must display real:

- Discord server avatar;
- server name;
- verified/listener/scanner state;
- last call and freshness;
- total/open/closed calls;
- token, symbol, mint;
- call-time price, market cap, liquidity;
- current price and verified peak;
- current return;
- maximum return;
- values such as `-50%`, `+50%`, `+100% / 2x`, `+400% / 5x`;
- win rate;
- average and median return;
- best and worst call;
- 1D/7D/30D performance;
- drawdown;
- followers;
- copied executions;
- confirmed copied volume;
- full journal.

Source-call performance and subscriber execution PnL must remain separate.

---

# MILESTONE 4 — COMPLETE AUTO-TRADING VERTICAL SLICE

Complete and verify the full implementation boundary:

signal
→ subscriber eligibility
→ saved versioned settings
→ immutable settings snapshot
→ capital reservation
→ durable intent
→ quote
→ unsigned mainnet simulation
→ signer-policy authorization
→ submission
→ signature persistence
→ confirmation
→ executed amounts
→ position/lots
→ TP/SL/trailing/DCA monitoring
→ exit
→ 2% platform fee
→ Discord/KOL creator allocation
→ referral allocation
→ DegenAration remainder
→ reconciliation
→ Portfolio and performance update

Required safety properties:

- no duplicate charge;
- no duplicate reward;
- no success before confirmation;
- no confirmed transaction lost after a database failure;
- no withdrawal from locked funds;
- no commission from an unconfirmed execution;
- integer-safe accounting;
- immutable financial records;
- idempotent intents, submissions, settlements, exits, and withdrawals;
- durable queues and leases;
- retries with bounded backoff;
- worker health and alerts;
- emergency global pause;
- user pause stops new entries but preserves exits;
- no automated mainnet activation before the final owner gate.

Prove everything possible with deterministic integration tests and unsigned mainnet simulation.

Do not broadcast funded mainnet transactions.

---

# MILESTONE 5 — FINISH THE FULL MIZAR-FAMILIAR UI

The current site is still too generic. Complete every remaining FAIL/PARTIAL parity row.

Required surfaces:

- global app shell;
- Bots overview;
- Discord marketplace;
- Discord source profile;
- Discord bot setup;
- Discord bot editing;
- KOL marketplace;
- KOL creation;
- KOL editing;
- My Bots / Bot Manager;
- Affiliate;
- Portfolio;
- winning PnL card;
- losing PnL card;
- Portfolio PnL card;
- Admin Console;
- dialogs, confirmations, loading, empty, error, and responsive states.

Visual requirements:

- deep layered black background;
- restrained gold and white;
- compact professional financial interface;
- high information density without clutter;
- clear hierarchy;
- professional SVG iconography;
- no emojis;
- no fake cover art;
- no random polygons;
- no giant empty areas;
- no generic AI marketing-card layout;
- no excessive uppercase;
- no walls of copy;
- tabular financial numerals;
- subtle animation only where useful;
- strong focus, hover, disabled, loading, success, and error states;
- mobile, tablet, laptop, and wide desktop parity.

The page must feel familiar to former Mizar users while remaining original DegenAration work.

---

# MILESTONE 6 — PORTFOLIO, PNL, AFFILIATE, AND ADMIN

## Portfolio

Finish real:

- total, available, locked, pending, tradable, withdrawable balances;
- deposits;
- withdrawals;
- open positions;
- position lots;
- Discord/KOL attribution;
- realized/unrealized PnL;
- trade history;
- deposit/withdrawal history;
- 7D/30D/3M charts;
- refresh/reconciliation state.

## PnL cards

Complete:

- winning trade;
- losing trade;
- Portfolio summary;
- DegenAration logo;
- high-quality gold/black/white visual;
- authoritative values;
- token/pair;
- entry/current/exit;
- percentage and multiple;
- duration;
- referral link when eligible;
- canonical site link otherwise;
- matching QR;
- browser preview;
- high-resolution export;
- share action;
- no private wallet/address leakage.

## Affiliate

Complete:

- Discord and KOL earnings;
- invite/referral counts;
- editable approved slug;
- collision and reserved-word checks;
- minimum withdrawal;
- configured withdrawal fee;
- immutable reward ledger;
- payout history;
- idempotent payouts.

## Admin

Server-restrict Admin Console to the approved administrator identity.

Show:

- every client;
- principal;
- available/locked/pending/tradable/withdrawable balances;
- open/closed positions;
- deposits;
- withdrawals;
- realized/unrealized PnL;
- Discord/KOL bots;
- failed trades;
- failed withdrawals;
- reconciliation alerts;
- confirmed volume today/7D/30D/lifetime;
- platform fees;
- creator and referral allocations;
- approved/rejected Discord sources;
- remove/archive source action.

Never add arbitrary balance editing.

---

# MILESTONE 7 — BROWSER ACCEPTANCE, COMMIT, AND DEPLOY

Use the authenticated Chrome remote-debugging session.

Test every required route at:

- 390px
- 768px
- 1024px
- 1440px

Verify:

- no horizontal overflow;
- no infinite spinner;
- no console errors;
- no failed API request;
- no dead control;
- no placeholder action;
- no fake zero;
- every toggle changes UI and backend state;
- save and edit preserve exact settings;
- pause/resume works;
- PnL cards render and export;
- Admin is denied to normal users;
- Admin works for the approved administrator;
- all displayed values come from authoritative APIs.

Take before/after evidence for every changed surface.

Run:

- formatter;
- lint;
- strict typecheck;
- unit tests;
- integration tests;
- contract tests;
- browser tests;
- production build;
- migration/RLS verification;
- secret scan;
- dependency audit;
- financial invariant tests;
- accessibility smoke tests.

Fix all BLOCKER/HIGH findings and all financial/security/data-integrity MEDIUM findings.

Commit each verified milestone separately.

Do not leave fixes undeployed.

Before production deployment present only:

- exact Vercel/Supabase/Railway target;
- exact SHA/function/migration;
- tests passed;
- expected row changes;
- expected user-visible change;
- rollback;
- whether funds can move.

After owner approval:

1. deploy the exact verified release;
2. verify `/api/build` returns the SHA;
3. reopen production;
4. repeat authenticated browser tests;
5. roll back immediately if production differs from preview;
6. update deployment evidence.

---

# FINAL COMPLETION CONDITION

Do not say “finished” until all of the following are true:

- the bot setup contains real persisted and enforced ON/OFF controls;
- obsolete “automated trading/payouts not available” messages are removed or replaced by truthful states;
- Discord automated embeds reach the journal and source profile;
- settings affect durable intents and worker behavior;
- marketplace performance is real and correctly labelled;
- all Mizar parity rows are PASS or have one exact external blocker;
- Discord, KOL, Bot Manager, Affiliate, Portfolio, PnL cards, and Admin work in authenticated browser verification;
- verified UI and integration changes are committed and deployed;
- production serves the verified SHA;
- remaining blockers are only exact secure signer, worker-host, fee-token-account, legal, real-transaction, or irreversible approval actions.

Begin now with the missing ON/OFF controls and the false “not available” gates, then continue sequentially through every milestone.

Do not stop to summarize progress. Stop only at one genuine owner approval gate.
