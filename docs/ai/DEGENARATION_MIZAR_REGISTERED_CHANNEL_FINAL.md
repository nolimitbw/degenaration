# DEGENARATION — FINAL MIZAR-PARITY AND REGISTERED-CHANNEL COMPLETION

Continue from the current DegenAration repository, deployed Vercel app, Supabase production project, Railway bot/worker services, current branch history, and existing `docs/ai` evidence.

This is a focused implementation task. Do not restart or redesign the product from scratch.

## NON-NEGOTIABLE RULES

- Do not repeat full repository scans, completed migrations, old audits, or long history summaries.
- Do not launch dynamic workflows, parallel agents, or Codex.
- Do not wait for random future events when deterministic or replay-safe proof is available.
- Do not stop after planning.
- Do not present strategy menus.
- Do not use client funds.
- Do not sign or broadcast a funded transaction during automated verification.
- Keep mainnet activation behind one explicit final owner approval.
- Implement, test, commit, deploy, and verify each milestone.
- At a genuine external blocker, ask for exactly one owner action in one sentence and stop. Never loop.

## AUTHORITATIVE REFERENCES

Use:

- `docs/DEGENARATION_MASTER_SPEC.md`
- `docs/ai/MIZAR_REFERENCE_INVENTORY.md`
- `docs/ai/MIZAR_PARITY_MATRIX.md`
- `docs/ai/CLICK_FLOW_MAP.md`
- `docs/ai/REFERENCE_COVERAGE.md`
- `docs/ai/IMPLEMENTATION_STATUS.md`
- `docs/ai/OPEN_BLOCKERS.md`
- `docs/ai/FINAL_EXECUTION_HANDOFF.md`
- the local Mizar videos/screenshots
- `SETTINGS AND FUNCTIONS IDEA`
- `PNL CARDS`

Do not decode every video again. Use the inventory and parity documents first. Open only the exact reference frame needed for a missing interaction.

The goal is workflow and interaction parity for former Mizar users, using original DegenAration branding. Do not copy Mizar trademarks, logo, exact proprietary text, source code, or artwork.

# ACCEPTANCE TEST 1 — BOT SETUP MUST MATCH THE MIZAR WORKFLOW

The current builder still fails acceptance if it only shows generic accordions, static summaries, or decorative toggles.

Rebuild Discord and KOL setup/editing so the user sees the same familiar interaction pattern demonstrated in the references:

1. select source/strategy;
2. select wallet;
3. funding and exposure;
4. risk limits;
5. take profit;
6. stop loss;
7. trailing controls;
8. DCA;
9. security/scanner filters;
10. execution, slippage, priority fee, retries, and cooldown;
11. review;
12. save/activate;
13. edit, pause, resume, archive.

Every optional feature must have a visible, accessible, persisted ON/OFF control.

Required switches:

- auto-entry;
- auto-exit;
- take profit master;
- every TP level;
- stop loss;
- trailing take profit;
- trailing stop loss;
- DCA master;
- every DCA level;
- liquidity filter;
- market-cap filter;
- token-age filter;
- holder/concentration filter;
- mint/freeze authority filter;
- blacklist/security filter;
- daily spend cap;
- daily loss cap;
- per-token exposure;
- maximum open positions;
- priority-fee override;
- retries;
- cooldown;
- pause/resume;
- emergency kill switch.

For every switch:

- show “On” or “Off” in text;
- support keyboard and screen readers;
- reveal/hide only related controls;
- semantically disable inactive controls;
- save the state;
- reload the exact state on edit;
- store the state in version history;
- include it in the immutable subscriber-config snapshot;
- enforce it in intent creation and worker behavior.

A toggle that changes only the interface is a failed implementation.

Use compact Mizar-familiar sections, concise summaries, info icons, inline validation, and a sticky review panel. Remove giant empty areas and walls of explanations.

Numeric inputs must remove unwanted leading zeroes, support typing and paste, reject invalid precision, and use integer-safe SOL/token units rather than floating-point money arithmetic.

# ACCEPTANCE TEST 2 — REGISTERED CHANNELS ONLY

The DegenAration Discord bot must scan only explicitly registered and approved call channels.

Authoritative authorization must come from production database records for:

- approved guild/server;
- approved channel;
- active approval status;
- linked source profile;
- connected Discord owner where required.

Required behavior:

1. A server owner adds the DegenAration bot.
2. The owner registers a call channel through the approved flow.
3. Admin approval activates that exact guild/channel pair.
4. The listener receives messages only from channels it can access.
5. Before parsing or journaling, the system verifies the guild/channel is active and approved.
6. Unregistered, removed, rejected, or disabled channels are ignored and audited with a truthful reason.
7. Removing a source in Admin immediately prevents new calls from that source without deleting history.

Support:

- human messages;
- third-party bot messages;
- webhook messages;
- embed-only messages with empty `message.content`;
- multiple embeds;
- embed title, description, fields, author, footer, and URL;
- button/action-row URLs;
- supported links;
- attachments;
- replies/referenced messages;
- `MESSAGE_CREATE`;
- `MESSAGE_UPDATE`;
- preserved deletion history;
- Discord partial objects.

Ignore only messages created by the DegenAration application itself to prevent loops. Never reject all `author.bot` messages.

Extract Solana mint/CA candidates from all text-bearing fields and supported URLs. Validate candidates on-chain. If multiple addresses are ambiguous, reject safely and record the exact reason. Never guess.

Deduplicate by guild ID + channel ID + message ID. Preserve event versions. An edit must never create a second trade. A deletion must preserve the journal record and mark the source event deleted.

Prove the full registered-channel path:

registered automated call
→ authorization check
→ raw immutable event
→ parser
→ mint validation
→ scanner
→ call journal
→ source profile
→ immutable call-time price
→ performance tracking
→ subscriber configuration
→ durable intent

Use a replay-safe stored automated embed, deterministic fixture against the real parser/contracts, or an approved test webhook. Do not fabricate production source history.

# ACCEPTANCE TEST 3 — REAL MARKETPLACE DATA

Every Discord source profile must show real:

- server avatar;
- server name;
- approved/connected/listener/scanner state;
- registered channels;
- last call and freshness;
- token, symbol, mint;
- call-time price;
- market cap;
- liquidity;
- current price;
- verified peak;
- current return;
- maximum return;
- `-50%`, `+50%`, `+100% / 2x`, `+400% / 5x`;
- total/open/closed calls;
- win rate;
- average and median return;
- best and worst calls;
- 1D/7D/30D performance;
- drawdown;
- followers;
- copied executions;
- confirmed copied volume;
- full call history.

Keep source-call performance separate from subscriber execution PnL.

Unknown data must display “Monitoring”, “Collecting data”, “Insufficient history”, or “Unavailable”, never a fabricated zero.

# ACCEPTANCE TEST 4 — REMOVE FALSE FEATURE GATES

Search for every user-visible or server-side phrase/flag related to:

- automated trading unavailable;
- payouts unavailable;
- manual trading only;
- draft-only;
- automation not yet available;
- disabled withdrawals;
- disabled bot activation.

For each gate, determine whether it is obsolete hard-coded text, a feature flag, missing service configuration, a valid safety gate, or incomplete implementation.

Remove obsolete text. Do not hide real blockers.

Replace vague global banners with truthful capability states:

- Draft;
- Validated;
- Ready for activation;
- Active;
- Paused;
- Exit-only;
- Error;
- Archived.

Withdrawals and affiliate payouts must remain available when their verified financial paths are operational. Bot activation must be enabled only when worker, signer policy, fee token account, reconciliation, and emergency controls are actually ready.

Users must never see internal labels such as E-2, E-3, or E-4.

# ACCEPTANCE TEST 5 — FULL AUTO-TRADING IMPLEMENTATION

Complete and verify:

call
→ eligible subscribers
→ versioned saved settings
→ immutable settings snapshot
→ capital reservation
→ durable intent
→ quote
→ unsigned mainnet simulation
→ signer authorization boundary
→ submission boundary
→ signature persistence
→ confirmation
→ executed amounts
→ positions/lots
→ TP/SL/trailing/DCA monitoring
→ exit
→ 2% platform fee
→ Discord/KOL creator allocation
→ referral allocation
→ reconciliation
→ Portfolio/performance update.

Required properties:

- no duplicate intent, submission, charge, settlement, reward, or withdrawal;
- no success before confirmation;
- no confirmed transaction lost after a database failure;
- no withdrawal from locked funds;
- no commission for an unconfirmed execution;
- integer-safe accounting;
- immutable financial records;
- durable queues and leases;
- bounded retries;
- worker health/alerts;
- global emergency pause;
- user pause blocks new entries but preserves exits.

Complete all internally solvable code and unsigned mainnet verification.

Do not activate funded mainnet execution until the exact worker, secure signer, correct Jupiter output-mint fee token account, and final owner approval are present.

# ACCEPTANCE TEST 6 — FULL MIZAR-FAMILIAR PRODUCT UI

Finish every remaining FAIL/PARTIAL parity row for:

- app shell;
- Bots overview;
- Discord marketplace;
- Discord source profile;
- Discord setup/editing;
- KOL marketplace;
- KOL creation/editing;
- My Bots/Bot Manager;
- Affiliate;
- Portfolio;
- winning PnL card;
- losing PnL card;
- Portfolio PnL card;
- Admin Console;
- loading, empty, error, dialog, confirmation, mobile, tablet, and desktop states.

Visual requirements:

- deep layered black background;
- restrained gold and white;
- compact professional trading interface;
- clear hierarchy;
- professional SVG icons;
- no emojis;
- no fake covers;
- no random polygons;
- no generic AI marketing-card layout;
- no giant empty spaces;
- no walls of text;
- tabular financial numerals;
- useful tooltips;
- polished focus, hover, disabled, loading, success, and error states.

# ACCEPTANCE TEST 7 — PORTFOLIO, PNL, AFFILIATE, ADMIN

Finish real:

- total/available/locked/pending/tradable/withdrawable balances;
- deposits and withdrawals;
- open/closed positions and lots;
- trade history;
- deposit/withdrawal history;
- 7D/30D/3M charts;
- realized/unrealized PnL;
- Discord/KOL attribution;
- winning, losing, and Portfolio share cards;
- referral/canonical links and matching QR;
- high-resolution export;
- Affiliate rewards and idempotent payouts;
- editable approved referral slug;
- Admin client balances, positions, deposits, withdrawals, PnL, bots, failures, fees, confirmed volume today/7D/30D/lifetime, source approvals, and source removal.

Admin access must be enforced server-side for the approved administrator. Never add arbitrary balance editing.

# COMMIT, DEPLOY, AND PRODUCTION PROOF

Use the authenticated browser session.

Verify every required page at 390, 768, 1024, and 1440 pixels.

Fail the release for:

- horizontal overflow;
- infinite spinner;
- browser-console errors;
- failed API requests;
- dead controls;
- placeholder actions;
- fake zero values;
- switches that do not persist;
- edit pages that do not reload saved settings;
- production differing from preview.

Run formatter, lint, strict typecheck, unit/integration/contract/browser tests, production build, migration/RLS checks, secret scan, financial invariants, and accessibility smoke tests.

Commit each verified milestone separately.

Do not leave verified work undeployed.

Before an irreversible production action, report only:

- exact target;
- exact SHA/function/migration;
- tests passed;
- expected row changes;
- visible effect;
- rollback;
- whether funds can move.

After approval, deploy the exact package, verify `/api/build`, reopen production, and repeat authenticated browser acceptance.

# DONE CONDITION

Do not say complete until:

- the setup flow visibly matches the supplied Mizar interaction model;
- all optional settings have real persisted and enforced ON/OFF controls;
- only registered approved Discord channels can create calls;
- automated bot/webhook CA messages reach journal and source profiles;
- settings affect durable intents and worker behavior;
- false unavailable banners are gone or replaced with truthful capability states;
- Discord/KOL/Bot Manager/Affiliate/Portfolio/PnL/Admin pass authenticated browser verification;
- all internally solvable work is committed and deployed;
- production serves the verified SHA.

Begin with the builder parity and registered-channel authorization. Continue sequentially until one genuine owner-only approval is required.
