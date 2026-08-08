# DEGENARATION — CODEX MASTER IMPLEMENTATION PROMPT
## Scope: Discord scanner, source ownership/affiliate linking, call performance journaling, simplified bot UX, live trades, hosting migration, autonomous trading activation, and original light/dark UI redesign

Work on the CURRENT DegenAration repository and production stack. Preserve all existing working functionality, data, branding, routes, menus, user balances, withdrawal flows, affiliate accounting, and security controls unless a change is strictly required by this specification.

Do not restart the project. Do not rewrite the stack. Do not remove existing features that are outside this scope. Do not replace real production data with fixtures.

The desired result is a production-quality system implemented by a senior engineer: compact, understandable, original, testable, observable, and safe with real user funds.

---

# PHASE 0 — PREPARE CODEX BEFORE CODING

Before modifying application code, prepare the Codex environment.

1. Inspect the repository root, `AGENTS.md`, package manager lockfile, existing scripts, deployment configuration, and available Codex Skills/Plugins.
2. Use the installed Codex skill-management capability (`skill-installer` / `skill-creator` when available) and the Codex Plugin/Skills system.
3. Install or create ONLY the skills genuinely useful for this task. Prefer official/curated skills/plugins. Do not install random packages or untrusted skills.
4. Required skill capabilities:
   - senior frontend/UI engineering;
   - responsive accessibility review;
   - browser/playwright-style visual QA;
   - Node/TypeScript backend engineering;
   - Discord.js / Discord Gateway integration;
   - PostgreSQL/Supabase migrations, RPCs, RLS, and reconciliation;
   - Solana/Jupiter transaction and quote verification;
   - deployment/release verification;
   - security review and secret scanning;
   - Git commit/release discipline.
5. If an exact skill does not exist, use `skill-creator` to create a small repo-scoped skill for that workflow instead of bloating the main prompt.
6. Record the enabled skills in a short repo-local engineering note so future Codex sessions discover the same workflow.
7. Use the repository's existing package manager. Install application dependencies only when the current implementation truly needs them.
8. Never disable security controls, sandboxing, financial safeguards, or production approval gates just to make automation easier.
9. Grant Codex all normal project-level permissions needed to read/write the repository, run tests, use the browser, Git, Supabase, the current deployment provider, and connected deployment tooling. Do not require repeated approval for reversible development actions.
10. Still require owner confirmation for a funded mainnet transaction, creation/spending of an on-chain fee account, destructive production deletion, or any action that can irreversibly move real user funds.

Do not spend a large amount of context narrating Phase 0. Complete it and continue.

---

# REFERENCE FILES — MUST BE REVIEWED BEFORE UI/SCANNER CHANGES

These are the three exact references supplied for this task:

1. `UIBOT.png`
   - Current chat-mounted path: `/mnt/data/UIBOT.png`
   - Meaning: visual direction for the new DegenAration trading dashboard/bot UI. Use its clean hierarchy, side navigation, compact cards, charts/tables, whitespace, and professional exchange-like feel as design inspiration. Keep DegenAration's own branding and existing menu structure.

2. `scanner reaction to discord calls.png`
   - Current chat-mounted path: `/mnt/data/scanner reaction to discord calls.png`
   - Meaning: reference for the desired Discord experience. A call appears in an approved channel and the scanner visibly reacts/replies so the source owner can confirm DegenAration detected and journaled it.

3. `still no datas about the calls.png`
   - Current chat-mounted path: `/mnt/data/still no datas about the calls.png`
   - Meaning: current failure evidence. Approved Discord sources exist, but accepted/rejected/executed/copy-volume and performance buckets are still empty even though calls have occurred.

IMPORTANT: `/mnt/data/...` is the attachment path in the originating ChatGPT environment. If these paths are not accessible on the local Codex machine, locate the files by the exact filenames above in the user-accessible Desktop/Downloads/project folders and copy them, without modifying the originals, to:

`docs/references/2026-08-08/`

Then use those project copies as the durable references. Do not silently proceed without finding the references.

---

# AUTONOMY RULE

Continue sequentially through this entire specification.

For each milestone:

inspect only relevant code
→ reproduce the failure
→ implement the root-cause fix
→ add regression tests
→ run targeted tests
→ run full project checks
→ commit
→ deploy the exact verified artifact
→ verify production
→ continue automatically.

Do NOT:
- repeatedly rescan unchanged code;
- write long summaries between milestones;
- launch large parallel-agent workflows;
- ask what to do next;
- stop after planning;
- leave completed work undeployed;
- claim success from tests without production verification.

Stop only for a genuinely missing credential, unavailable third-party account, destructive production action, or funded mainnet transaction approval.

---

# MILESTONE 1 — FIX THE DISCORD SCANNER END TO END

The current symptom is unacceptable: approved Discord servers/channels have real calls, while the website shows no meaningful call journal or performance.

Trace the complete real production path:

Discord approved channel
→ Discord Gateway event
→ registered-channel authorization
→ raw immutable event
→ content/embed/action-row/attachment extraction
→ Solana CA candidate extraction
→ mint validation
→ canonical call
→ call-time market snapshot
→ performance tracker
→ website source profile
→ subscriber fan-out
→ durable trade intent.

Find the first broken link and fix the root cause.

## Registered-channel rule

The bot must process calls ONLY from exact active guild/channel pairs registered and approved in the production database.

Unregistered, rejected, removed, disabled, or wrong-channel events must:
- never create a canonical call;
- never create a subscriber trade intent;
- never affect marketplace performance;
- be recorded in safe diagnostic/audit counters with a truthful reason.

## Message shapes that MUST work

Support:
- normal human messages;
- third-party bot messages;
- webhook messages;
- embed-only messages where `message.content` is empty;
- multiple embeds;
- embed title;
- description;
- fields;
- author;
- footer;
- embed URL;
- Discord buttons/action rows and their URLs;
- attachments;
- replies/referenced messages;
- MESSAGE_CREATE;
- MESSAGE_UPDATE;
- Discord partial objects;
- preserved deletion/retraction history.

Ignore only messages sent by the DegenAration bot/application itself to prevent loops.

Never blanket-ignore `author.bot === true`.

## CA extraction

Extract Solana contract/mint candidates from all supported text and URL fields.

Validate on-chain before accepting.

If two or more plausible addresses exist and the source does not unambiguously identify the token:
- reject safely;
- record `ambiguous_mint`;
- do not guess;
- do not trade.

Deduplicate by:
`guild_id + channel_id + message_id`

Edits must update/version the same source call instead of creating a second trade.
Deletes must preserve immutable history and mark the call retracted/deleted according to current product rules.

---

# MILESTONE 2 — ADD A VISIBLE SCANNER REACTION IN DISCORD

Implement a scanner acknowledgment similar in purpose to the supplied Discord reference.

When AND ONLY WHEN a message in a registered approved channel is successfully accepted as a valid call and committed to the journal, the DegenAration bot should post one concise acknowledgment reply/thread response.

Requirements:
- configurable globally and per approved source;
- default ON for source-owner confirmation unless existing product policy says otherwise;
- at most one acknowledgment per Discord message/version;
- idempotent across reconnects/retries;
- never reply to unregistered channels;
- never reply to rejected/ambiguous/invalid calls as if accepted;
- never create a reply loop.

Suggested content structure, using original DegenAration wording:
- DegenAration scanner mark/icon;
- `Call detected`;
- token/symbol if verified;
- shortened mint;
- `Journaled`;
- timestamp;
- optional safe link to that source/call on DegenAration.

Do not copy Mizar branding or exact wording.

For rejected calls, if source-owner diagnostics are enabled, use a separate minimal status such as `Not journaled — ambiguous token address`, without exposing internal secrets.

Add tests proving reconnect/replay cannot generate duplicate acknowledgments.

---

# MILESTONE 3 — MAKE CALL PERFORMANCE JOURNALING REAL

The website currently shows empty performance even though calls exist.

Create/fix one authoritative performance pipeline based on the immutable call-time price.

For every accepted call store:
- source;
- guild/channel/message;
- mint;
- symbol;
- called_at;
- call_price;
- market cap at call when available;
- liquidity at call when available;
- current price;
- current return;
- minimum observed price;
- maximum observed price;
- maximum return/multiple;
- first milestone timestamps;
- last scanned timestamp;
- data freshness/provider;
- retracted/deleted state.

Milestone semantics must be explicit and tested:

- `-50%`: observed price <= 0.50 × call price
- `+50%`: observed price >= 1.50 × call price
- `2x`: observed price >= 2.00 × call price
- `5x`: observed price >= 5.00 × call price

Each milestone is journaled once with:
- first_hit_at;
- first_hit_price;
- provider/source;
- scan id.

Continue tracking current return and maximum return after a milestone is hit.

Do not fabricate historical performance. If reliable historical price data can backfill a call since its call timestamp, backfill deterministically and record provider/provenance. Otherwise start truthful tracking and show `Insufficient historical data`.

The Discord marketplace/source profile must show real:
- total calls;
- measured calls;
- accepted;
- rejected;
- retracted;
- open/active monitoring;
- -50% count/rate;
- +50% count/rate;
- 2x count/rate;
- 5x count/rate;
- current median return;
- median peak;
- average peak;
- best call;
- worst call;
- last call;
- data freshness;
- copied executions;
- confirmed copied volume.

Never show zero merely because data is unknown. Use:
`Collecting data`, `Not measured yet`, `Insufficient history`, or `Unavailable`.

Add a deterministic scanner job/scheduler so price monitoring continues after ingestion.

---

# MILESTONE 4 — `/connect discord` OWNER LINKING AND AFFILIATE CREDIT

Add a purposeful Discord slash command:

`/connect discord`

Goal: verify that a Discord server/call-source owner controls both:
1. their Discord identity/server permissions; and
2. their DegenAration account.

Do NOT simply trust a Discord username or user ID submitted by the browser.

Implement a secure one-time linking flow:

Discord `/connect discord`
→ create short-lived single-use nonce
→ return ephemeral secure DegenAration link
→ user signs into DegenAration
→ server validates nonce
→ validate Discord user identity
→ verify owner/admin/manage-guild permission for the relevant guild
→ connect Discord identity to DegenAration user
→ allow claim/management of eligible source
→ record immutable ownership/link audit event.

Requirements:
- expiring token;
- single use;
- CSRF/state protection;
- no secrets in URL;
- no cross-user source claim;
- ownership can be revoked/relinked with audit history;
- source commissions credit only the verified linked owner;
- one source cannot silently pay two owners;
- admin can inspect ownership state and resolve disputes without editing earned balances manually.

Discord commands must contain no duplicate registration. Every command must have a real purpose.

Add source-owner UI showing:
- connected Discord;
- owned/managed sources;
- commission rate;
- confirmed eligible call volume;
- confirmed earnings;
- pending/unconfirmed earnings;
- payout history.

---

# MILESTONE 5 — SIMPLIFY THE DISCORD COPY-BOT SETTINGS

The current setup is too dense.

Redesign the setup to feel like a professional exchange order panel: minimal, clear, compact, fast, and understandable.

Do not remove backend capabilities permanently. Hide advanced capabilities from the primary workflow for now.

## Primary setup — show only these

1. `Margin amount per trade`
   - amount of SOL/capital allocated to each new copied call.
   - clean numeric input.
   - no leading-zero bug.
   - show wallet available balance and estimated maximum simultaneous exposure.

2. `Max funds per day`
   - hard daily capital/risk budget for new entries.
   - once reached, no more entries until the next configured day/reset.
   - exits must still work.

3. `Take profit`
   - On/Off.
   - simple target percentage.
   - when Off, hide TP fields completely and exclude TP from config/worker logic.

4. `Stop loss`
   - On/Off.
   - simple loss percentage.
   - when Off, hide SL fields completely.

5. `Re-entry`
   - Off by default.
   - placed immediately below Stop loss.
   - when On, expose only the minimum necessary re-entry settings.
   - when Off, no re-entry controls are visible and the worker must never re-enter.

Then show only:

`RUN`
`Save and use later`

## Advanced settings

Temporarily move all other existing controls into one collapsed `Advanced settings` area below the primary flow.

Do not delete working backend configuration fields or migrations. Preserve compatibility for existing bots.

The primary form must be the default experience.

## RUN

When pressed:
- validate authenticated user;
- wallet ownership;
- source approval;
- available funds;
- worker health;
- signer readiness;
- fee readiness;
- daily budget;
- config;
- no kill switch;
- no duplicate active subscription.

Then save/version the configuration and activate it.

A successful RUN must produce a clearly active bot in `My Bots`.

`Save and use later` saves a Draft and must never create a trade intent.

---

# MILESTONE 6 — ONGOING TRADES AND CLOSED TRADES

After a copied call creates and confirms a real trade, users need a professional trading view.

Create a user-facing `Trades` surface accessible from Bots/My Bots and Portfolio.

Tabs:
- `Ongoing trades`
- `Closed trades`

## Ongoing trades

Show real live data:
- token/symbol;
- source Discord/KOL;
- mint;
- entry time;
- average entry;
- current price;
- invested amount;
- token quantity;
- TP;
- SL;
- current PnL amount;
- current PnL percentage;
- current multiple;
- highest PnL reached;
- status;
- transaction link;
- exit action only if existing product rules permit user manual exit.

PnL must update live or near-live using the existing most appropriate architecture (stream/SSE/realtime subscription/rate-limited polling).

Do not fake animation. Every value must derive from the authoritative position plus a fresh market price.

Use positive/negative visual state clearly but accessibly.

## Closed trades

Show:
- token;
- source;
- entry;
- average exit;
- invested;
- proceeds;
- realized PnL amount;
- realized PnL percent;
- return multiple;
- open/close times;
- duration;
- close reason: TP / SL / trailing / manual / source rule / safety / other;
- entry and exit transaction signatures;
- platform fee;
- creator commission;
- referral allocation when applicable.

Provide filtering by source, date, result, and token.

Add summary cards/chart derived only from real execution history.

---

# MILESTONE 7 — MAKE `BOTS PLACING TRADES ON THEIR OWN` ACTUALLY ACTIVE

Find the exact current `Pending` / `Bots placing trades on their own` capability.

Do not simply rename Pending to Active.

Trace the real readiness conditions:
- execution worker;
- signer;
- wallet delegation;
- source scanner;
- durable intents;
- quote/simulation;
- mainnet submission path;
- confirmation;
- TP/SL monitor;
- daily risk cap;
- fee account;
- reconciliation;
- emergency stop.

Complete every internally solvable requirement.

The status becomes `Active` only when those real production checks pass.

If a production credential or funded owner action is genuinely missing, complete everything else first, then present exactly one action needed.

Never use a random client's funds as a test.

Use deterministic tests and unsigned mainnet simulation before any funded canary.

---

# MILESTONE 8 — REPLACE RAILWAY WITH A SUSTAINABLE FREE-TIER HOST

The current Railway free trial has ended.

Research CURRENT official pricing and runtime limits before choosing.

The bot and trading worker require reliable long-running Node processes, outbound network access, Discord Gateway/WebSocket connectivity, health monitoring, and secrets.

First evaluate:
1. Oracle Cloud Infrastructure Always Free Compute for persistent Node services.
2. Other genuinely free, non-expiring options only if official current terms support this workload.
3. Cloudflare Workers/Durable Objects only if the existing Discord Gateway/client architecture can be supported correctly without losing persistent outbound connection behavior.
4. Do not select a platform merely because it has a free web tier if it sleeps, forbids background workers, or cannot maintain the required Discord connection.

Selection criteria:
- genuinely non-expiring free allocation according to official docs;
- supports persistent worker/listener;
- secrets;
- outbound HTTPS/WebSocket;
- enough memory/CPU;
- logs;
- health/restart;
- deployment from GitHub;
- no forced sleep that breaks scanner reliability;
- acceptable region/latency;
- clear limits.

Create `docs/hosting/HOSTING_DECISION.md` with evidence and links.

Migration rules:
- do not shut down Railway first;
- deploy replacement;
- copy configuration without printing secrets;
- verify bot login/listener heartbeat;
- verify worker health;
- verify registered-channel scan;
- verify no duplicate listener/trader;
- switch authority;
- observe;
- only then retire Railway.

If no truly free-forever provider satisfies the requirements, state that truthfully instead of pretending.

---

# MILESTONE 9 — ORIGINAL LIGHT/DARK UI REDESIGN

Use `UIBOT.png` as the primary visual direction.

The target is NOT to copy its brand. Adapt the visual language into an original DegenAration trading product.

Preserve:
- existing DegenAration logo at the top;
- existing main product menus and capabilities;
- existing functional routes.

Redesign the application shell and trading/bot surfaces with:
- desktop sidebar/navigation when appropriate;
- responsive mobile navigation;
- strong dashboard hierarchy;
- clean cards;
- professional tables;
- charts where data supports them;
- consistent spacing/radius;
- readable type hierarchy;
- no giant empty panels;
- no generic AI-generated marketing cards;
- no emoji icons;
- professional SVG/icon library;
- compact exchange-quality forms.

## Themes

Implement:
- Light mode
- Dark mode
- System mode

Persist preference.

DegenAration identity:
- original logo;
- black/gold as the signature dark theme;
- restrained gold accents;
- neutral professional light theme;
- accessible contrast;
- consistent design tokens.

The same components must work in both themes. Do not create two disconnected UIs.

## Dashboard direction

Adapt useful ideas from the supplied dashboard:
- balance/equity overview;
- compact performance chart;
- small metric cards;
- notifications/status;
- active/closed trades;
- source performance;
- clean tables;
- clear active state.

Use only DegenAration's real metrics and terminology.

---

# MILESTONE 10 — PRODUCTION ACCEPTANCE

Run all existing and newly required checks:
- formatting;
- lint;
- strict typecheck;
- unit tests;
- integration tests;
- Discord parser/replay tests;
- registered-channel authorization tests;
- ownership-link tests;
- performance milestone tests;
- worker tests;
- financial invariant tests;
- RLS/security tests;
- browser tests;
- production build;
- secret scan;
- dependency audit;
- accessibility checks.

Browser-verify production at:
- 390px;
- 768px;
- 1024px;
- 1440px.

Fail acceptance for:
- horizontal overflow;
- infinite spinners;
- console errors;
- failed API calls;
- fake zeros;
- dead buttons;
- duplicate Discord replies;
- duplicate commands;
- unregistered channel ingestion;
- missing source journal data;
- stale live PnL;
- settings that do not persist;
- settings that are ignored by the worker;
- Pending status when the stack is actually ready;
- Active status when the stack is not ready;
- preview/production SHA mismatch.

Commit verified milestones separately.

Deploy each verified milestone to the actual production targets.

Verify deployed SHAs and health after deployment.

---

# FINAL MAINNET SAFETY GATE

Do not use client funds for verification.

When the entire internally solvable implementation is complete, prepare one minimal owner-controlled canary package with:
- exact owner-controlled wallet;
- exact source;
- exact high-liquidity token/pair;
- exact small amount;
- max daily funds;
- TP;
- SL;
- re-entry state;
- slippage;
- expected 2% fee;
- worker SHA;
- bot SHA;
- app SHA;
- database migration state;
- emergency-stop procedure;
- rollback procedure.

Wait for explicit owner approval before broadcasting that funded canary.

After approval, verify the full live path:
Discord call
→ scan acknowledgment
→ journal
→ subscriber match
→ trade intent
→ simulation
→ signing
→ broadcast
→ confirmation
→ Ongoing trade
→ live PnL
→ TP/SL/exit
→ Closed trade
→ performance milestone updates
→ platform/creator/referral accounting
→ reconciliation.

If any invariant fails, activate emergency stop for new entries, preserve exits, reconcile, and fix the root cause before enabling other users.

---

# DEFINITION OF DONE

Do not report this task complete until all of the following are true:

1. Approved registered Discord channels are actually being scanned.
2. Accepted calls receive one idempotent DegenAration acknowledgment reply when configured.
3. Calls appear on the website with real journaling.
4. -50%, +50%, 2x, and 5x milestones update from real price tracking.
5. `/connect discord` securely links source owners to DegenAration accounts.
6. Creator/affiliate earnings are credited to the verified owner only.
7. Bot setup defaults to the five simple controls requested.
8. RUN activates a real eligible bot; Save and use later creates a Draft.
9. Ongoing trades show live PnL.
10. Closed trades show authoritative history and realized PnL.
11. `Bots placing trades on their own` becomes Active only because the production trading stack is genuinely operational.
12. A sustainable hosting replacement is selected and migration is verified before Railway is retired.
13. Light, dark, and system themes work with the original DegenAration identity.
14. Existing menus/features not targeted by this prompt remain intact.
15. All changes are tested, committed, deployed, and production-verified.

Begin with Phase 0, then immediately fix the Discord scanner and call journaling. Continue without asking for the next task.
