# DegenAration — Final Codex 5.6 Sol Ultra Production Build Prompt

> **How to use:** Attach the repository, all listed videos, all reference images, and this file to Codex. Paste the complete prompt below as a **normal Codex task**. **Do not use `/goal`.** Run it from the repository root with access only to development/test credentials. Never provide production private keys or a funded mainnet wallet.

---

## MASTER IMPLEMENTATION PROMPT FOR CODEX

You are the principal product engineer, Solana systems engineer, backend architect, frontend lead, database engineer, security engineer, QA lead, and release engineer responsible for completing **DegenAration**.

Your assignment is to inspect the existing repository, preserve its working foundations, and implement the complete product described below as a polished, secure, production-quality Solana automated-trading platform.

This is an implementation task, not a design discussion and not a request for a plan-only response. Begin with one focused repository audit, create a concise internal execution checklist, and then proceed directly through implementation, validation, and final reporting. Do not stop after planning unless a truly external blocker makes implementation impossible.

## 0. Non-negotiable operating rules

1. **Do not use `/goal`.** Work as one normal Codex task.
2. **Do not loop.** Never repeat the same scan, command, explanation, or failed approach without new evidence or a code/configuration change.
3. **Do not waste tokens or time.** Keep progress messages brief and only report meaningful discoveries, completed vertical slices, blockers, or verification results.
4. **Do not repeatedly reread the whole repository.** Perform one systematic initial scan, then open only files relevant to the current change.
5. **Do not rerun the entire test suite after every small edit.** Run targeted tests while developing, then run the complete release suite at defined gates.
6. **Do not retry the same failing command more than twice without identifying and addressing its root cause.**
7. **Do not make a blind rewrite.** Preserve working authentication, wallet, database, Discord, trading, and deployment integrations unless they are proven unsafe or broken.
8. **Do not weaken quality controls.** Never bypass TypeScript, disable lint rules, remove tests, add broad ignores, silence errors, or change production build settings merely to obtain a green build.
9. **Do not use fake production data or decorative controls.** Every visible button, filter, chart, status, form, and menu item must work end to end, be clearly disabled with an explanation, or be behind a documented feature flag.
10. **Do not claim a feature is complete merely because UI code exists.** Completion requires working data flow, persistence, authorization, error handling, and verification.
11. **Do not execute real mainnet trades, deposits, withdrawals, payouts, or Discord announcements while developing or testing.** Use paper mode, fixtures, local services, mocks at external boundaries, or Solana devnet. Mainnet execution must remain explicitly gated.
12. **Do not expose, print, log, commit, or transmit private keys, seed phrases, OAuth secrets, service-role keys, signing secrets, or production credentials.**
13. **Do not copy Mizar branding, source code, wording, illustrations, icons, or proprietary assets.** The videos and manual are functional and UX references only.
14. **Do not promise impossible certainty.** Deliver zero known release-blocking errors and measurable test evidence. If any external dependency cannot be verified, state it clearly instead of inventing success.
15. **Do not ask routine questions.** Make conservative, documented engineering decisions. Ask only when blocked by missing external credentials, inaccessible infrastructure, or an irreversible business decision that cannot be safely inferred.

## 1. Mandatory source review before edits

Review every supplied file completely before making broad product changes. Record the relevant screens, controls, states, and timestamps in a concise comparison document.

### Required videos

1. `DISCORD BOT PLAN FULL VIDEO OF VISION(2).mov`
   - Primary reference for the Discord bot marketplace, server cards, performance periods, call-result distribution, Discord bot setup, wallet selection, channel selection, buy amount, take-profit levels, stop-loss behavior, security filters, confirmation, and save flow.
2. `FULL VIDEO OF IDEA OF FULL DESIGN AND FUNCTIONAL OF KOL BOT(3).mov`
   - Primary reference for the KOL strategy creator, volatility/dip-buy logic, DCA, TP/SL, retry controls, cooldown, token presets, quick sets, advanced filters, token scanner, and save flow.
3. `DISCORD BOT AND KOL BOT AFFILIATE (4).mov`
   - Primary reference for creator earnings, Discord and KOL commission tabs, earnings metrics, earnings chart, payout history, and withdrawal modal.
4. `How it looks like when its done, you can edit your setups (1).mov`
   - Primary reference for bot manager tables, completed bot rows, pause/edit/delete actions, and editing an existing Discord or KOL setup.
5. `PORTFOLIO FULL PLAN(4).mov`
   - Primary reference for portfolio performance, realized/unrealized PnL, balances, main statistics, portfolio positions, trades, swaps, deposits, and withdrawals.
6. The earlier DegenAration current-site recording, when attached.
   - Source of truth for the current logo, existing brand identity, current integrations, routes, and working behavior.
7. The earlier Mizar-style reference recording, when attached.
   - Product-density and interaction-quality benchmark only.

### Required images

- `explanation on KOL BOT(9).png`
- `WINNING PNL CARD DESIGN ... .jpeg`
- `LOSING PNL CARD DESIGN ... .jpeg`
- `PORTFOLIO PNL CARD DESIGN ... .jpeg`
- The four attached screenshots showing:
  - Discord bot marketplace cards
  - Discord bot configuration
  - KOL/volatility bot configuration
  - Completed bot-manager tables

Read all text embedded in these files and their filenames. Do not copy the sample PnL artwork. Create an original DegenAration visual system inspired only by the concept.

### Functional manual reference

Read the official Mizar sniper-bot manual supplied by the product owner, especially its current sections covering wallets, copy trading, volatility bots, trade monitoring, security settings, and fees:

`https://docs.mizar.com/sniper-bot-manual`

Use it to understand functional depth, not to clone the product. Important concepts visible in the references include:

- Bot name and wallet selection
- Maximum simultaneous trades and required-capital calculation
- Market/limit behavior, bounded retries, slippage, priority fees, and transaction errors
- Multi-level take profit, trailing behavior, stop loss, DCA, cooldown, token freezing, and auto-retry
- Discord server/channel selection and call filtering
- Token and holder security filters
- Bot manager, marketplace, performance tracking, earnings, payouts, portfolio, and trade history

## 1A. Mandatory visual-fidelity and reference-extraction protocol

The attached recordings and images are binding product references. They are not optional inspiration and must not be reviewed superficially. Before implementing broad UI changes, create `docs/degenaration-reference-coverage.md` and inventory every distinct screen, modal, tab, field, filter, state, table column, card metric, action, animation, empty state, confirmation step, and editing flow visible in all supplied media.

### Reference priority

When references differ, use this order:

1. Financial safety, authorization, accounting correctness, and explicit requirements in this master specification
2. Existing DegenAration logo, brand assets, gold-and-white identity, and verified working integrations
3. The newest product-owner annotations, filenames, captions, screenshots, and videos
4. The earlier DegenAration current-site recording for existing product identity and behavior
5. The earlier Mizar-style and third-party examples for information density, interaction depth, and functional coverage only

Never copy another product's logo, name, wording, mascot, copyrighted illustration, referral code, QR code, source code, or proprietary visual asset. Recreate the demonstrated interaction model and information hierarchy as an original DegenAration implementation.

### Required media-review procedure

For every attached video:

- Watch from beginning to end at normal speed.
- Revisit important sections frame by frame.
- Record filenames and timestamps for each unique screen and interaction.
- Capture the exact visible labels, units, defaults, validation rules, settings, tabs, metrics, filters, actions, and state changes.
- Identify what happens before, during, and after save, edit, pause, resume, delete/archive, withdraw, deposit, share, approve, reject, suspend, remove, and confirm actions.
- Do not infer that an omitted state does not exist; implement professional loading, empty, validation, permission-denied, provider-error, insufficient-balance, and retry states consistent with this specification.

For every attached image:

- Read all visible text and filename instructions.
- Record its purpose, layout, hierarchy, dimensions/aspect ratio, visual emphasis, and data fields.
- Treat sample PnL cards as concept references only and produce original DegenAration artwork.

### Visual coverage matrix

`docs/degenaration-reference-coverage.md` must contain one row for every referenced requirement with:

- Source filename
- Timestamp or image region
- Screen/flow name
- Required UI elements
- Required behavior
- Backend/data dependency
- Implemented route/component
- Test or screenshot evidence
- Status: `PASS`, `PARTIAL`, `FAIL`, or `BLOCKED`

No item may be marked `PASS` because a similar-looking component exists. `PASS` requires correct behavior, persistence, authorization, data, validation, and tested interaction.

### Screenshot-based visual verification

Before final reporting:

1. Run the finished application with deterministic development fixtures or paper/devnet data.
2. Capture full-page screenshots for every major reference screen at desktop, tablet, and mobile widths.
3. Capture all important modals, dropdowns, tabs, expanded filter panels, bot-edit screens, transaction states, PnL-card variants, and admin states.
4. Compare them side by side with the supplied references.
5. Correct missing controls, weak hierarchy, clipped content, inconsistent spacing, poor responsive behavior, low-quality artwork, unreadable tables, and brand drift.
6. Store the evidence under `docs/release-evidence/visual/` or the repository's established test-artifact directory.
7. Add a concise screenshot index to `docs/degenaration-release.md`.

The target is functional and visual parity with the complete demonstrated plan while remaining an original DegenAration design. A page that contains the right words but lacks the demonstrated workflow, density, editability, states, or polish is incomplete.

### Non-negotiable design fidelity

- Preserve the existing DegenAration logo; do not replace or redraw it unless the repository contains an approved higher-quality source asset.
- Use the DegenAration gold, white, and dim-black visual system throughout.
- Match the references' compact professional information density, two-column bot builders, structured settings groups, marketplace cards, bot-manager tables, affiliate analytics, portfolio hierarchy, confirmation summaries, and editing flows.
- Include every option and setting visible in the supplied videos and screenshots unless it conflicts with security or this specification. When a visible setting cannot be supported by the current provider, render it only as clearly disabled with the exact technical reason and a tracked implementation blocker; never silently omit it.
- Do not replace detailed controls with simplified placeholders.
- Do not create a generic landing page, dashboard template, or visual mockup in place of the working application.
- Animation must be restrained, performant, and meaningful. It must never delay trading controls or hide critical status.
- No Lorem Ipsum, fake balances, fake performance, fake server statistics, fake trade histories, or fabricated scanner coverage may appear outside deterministic development fixtures.


## 2. Product identity and design direction

### Brand

- Product name: **DegenAration**
- Preserve the existing DegenAration logo and its correct aspect ratio.
- Preserve the current gold-and-white identity.
- Use a deep dim-black canvas, near-black elevated surfaces, subtle warm borders, white primary text, muted gray secondary text, gold interactive accents, green gains, and red losses.
- Do not use Mizar blue as the primary brand color.
- The result must feel premium, serious, compact, data-rich, fast, and trustworthy.
- Avoid a generic crypto landing-page appearance, excessive glow, oversized empty cards, or gimmicky animation.

### Suggested semantic design tokens

Use the repository’s existing colors when they are already coherent. Otherwise consolidate them into semantic tokens close to:

```css
--bg-canvas: #070706;
--bg-surface-1: #0d0d0b;
--bg-surface-2: #13120f;
--bg-surface-3: #191711;
--border-subtle: #262219;
--border-strong: #423721;
--gold-300: #f0d59b;
--gold-400: #ddb667;
--gold-500: #bd8735;
--text-primary: #f7f4ec;
--text-secondary: #aaa398;
--text-muted: #777167;
--success: #33d17a;
--danger: #ff5864;
--warning: #e7b955;
--info: #78a9ff;
```

Use semantic tokens rather than scattered raw color values. Keep profit/loss legible without relying on color alone. Respect reduced-motion preferences.

## 3. Final user-facing information architecture

The product must be simplified and focused entirely on automated trading.

### Normal user navigation

A normal authenticated user must see only:

1. **Bots**
2. **Affiliate**
3. **Portfolio**

The header may also contain the DegenAration logo, wallet/account control, network indicator, notification indicator, and sign-out/profile menu. It must not contain Terminal, Trades, Tools, Search, Research, or public Admin links.

### Remove from the user-facing product

Remove these items from navigation and normal-user routing:

- Terminal
- Standalone Trades page
- Search/global token search
- Tools and every Tools dropdown entry
- Public Admin link
- Any old dashboard duplication that conflicts with the three-section structure

Do not delete reusable backend trading, pricing, scanner, chart, order, or wallet services merely because their old pages are removed. Reuse those services behind Bots and Portfolio.

For old public routes such as `/terminal`, `/trades`, `/search`, and `/tools/*`:

- Remove them from route discovery and navigation.
- Redirect authenticated users to the closest new destination when that preserves context, otherwise return a deliberate not-found response.
- Preserve API endpoints only when required by the new product and protect them with appropriate authorization.
- Remove obsolete components after confirming there are no active dependencies.

### Recommended route structure

Adapt this to the existing router rather than forcing it blindly:

```text
/bots
/bots/discord
/bots/discord/[listingId]
/bots/discord/new
/bots/discord/[botId]/edit
/bots/kol
/bots/kol/[strategyId]
/bots/kol/new
/bots/kol/[botId]/edit
/bots/manage

/affiliate
/affiliate/payouts

/portfolio
/portfolio/positions/[positionId]

/admin
/admin/discord-applications
/admin/discord-sources
/admin/kol-strategies
/admin/commissions
/admin/payouts
/admin/users
/admin/trades
/admin/scanner
/admin/system
/admin/audit
```

## 4. Authentication and administrator security

### Initial administrator

The initial administrator identity is:

`flipthatsol@gmail.com`

Email comparison must be case-insensitive and based only on a **verified Google identity** returned by the authentication provider. Do not trust email text from the client, local storage, query parameters, request bodies, wallet metadata, or an unverified OAuth claim.

### Required admin implementation

1. Add an environment variable such as:

```env
ADMIN_EMAILS=flipthatsol@gmail.com
```

2. Normalize email addresses before comparison.
3. Seed or synchronize the matching verified user into a database-backed `ADMIN` role.
4. Use the database role as the normal authorization source after secure synchronization.
5. Implement a reusable server-side `requireAdmin()`/policy guard.
6. Protect every admin page, server action, API route, RPC method, database query, storage operation, and background-job command.
7. Hide the Admin Console navigation item from every non-admin user.
8. A non-admin requesting an admin URL directly must receive a secure `403` or safe redirect without leaked data.
9. Do not rely only on client-side conditional rendering or middleware without server authorization.
10. If using Supabase, add correct RLS policies and never expose the service-role key to the browser.
11. If using NextAuth/Auth.js, Privy, Clerk, Firebase, or another provider, follow its server-side verified-session pattern.
12. Log every privileged mutation with actor, action, target, previous state, new state, reason, timestamp, and request correlation ID.
13. No user may promote themselves, change their own role, or call admin mutations by crafting requests.

### Admin Console contents

Consolidate all administration into one protected console with the following areas:

- Overview and operational health
- Pending Discord server/channel applications
- Approved Discord servers and channels
- Reject, suspend, reactivate, and **remove** controls
- KOL strategy moderation
- Creator and platform commission ledgers
- Payout requests and payout reconciliation
- Users and linked Google/Discord/wallet identities
- Open positions, trade executions, failed transactions, and reconciliation state
- Solana scanner coverage, provider health, slot lag, unsupported-program events, and ingestion errors
- Global and per-source emergency stop controls
- System configuration and feature flags
- Immutable admin audit log

### Discord source removal behavior

The Admin Console must include an explicit remove action for approved Discord groups/channels.

Removal must:

1. Require a confirmation dialog and removal reason.
2. Stop accepting new signals immediately.
3. Hide the source from the marketplace.
4. Pause affected follower bots and notify their owners.
5. Preserve historical trades, commissions, applications, and audit records.
6. Continue managing exits for already-open positions unless the administrator activates an emergency close policy.
7. Revoke source credentials/subscriptions safely.
8. Be reversible only through a deliberate audited reapproval flow.

## 5. Bots section

The Bots landing page must present exactly two primary products:

1. **Discord Bot**
2. **KOL Bot**

Use polished feature cards, concise explanations, live counts, and clear calls to action. Also provide a **My Bots / Bot Manager** view containing the user’s configured Discord and KOL bots.

### Shared bot lifecycle

Every bot must use a clear state machine such as:

```text
DRAFT -> ACTIVE -> PAUSED -> STOPPING -> ARCHIVED
                         \-> ERROR
```

Required actions:

- Create
- Save draft
- Activate
- Pause
- Resume
- Edit
- Duplicate when allowed
- Archive/delete safely
- View performance
- View signals and executions

Deletion must not destroy financial history. A bot with open positions cannot be hard-deleted. Archive it and continue exit management.

Every bot configuration must be versioned. Editing a bot creates a new immutable configuration version. New settings apply to future signals. Existing positions retain the exact entry/exit configuration snapshot that opened them unless the user explicitly confirms a safe exit-setting migration.

### Bot Manager

Provide separate tabs for **Discord Bots** and **KOL Bots**. Include a dense professional table or responsive cards with:

- Status
- Bot ID
- Name
- Source/strategy
- 30-day net PnL
- 30-day volume
- gas/network fees
- platform fees
- creator fees
- open trades / maximum trades
- maximum capital
- token count or channel count
- followers when applicable
- creation date
- last activity
- edit
- pause/resume
- archive/delete

Use real values only. Net PnL must include all relevant fees.

## 6. Discord Bot product

### Purpose

Users can automatically copy eligible Solana token calls from approved Discord communities that have integrated with DegenAration.

Only approved Discord servers/channels may appear in the marketplace or generate executable signals.

### Discord marketplace

Build an original DegenAration marketplace matching the functional depth visible in the reference video, without copying its branded assets.

Each approved server card must support:

- Server logo/banner
- Server name
- verification/approval status
- member count when available and permitted
- creator fee
- 1D / 7D / 30D performance tabs
- number of eligible calls
- result distribution such as `<50%`, `+50%`, `2x`, and `5x+`
- win rate
- median and average return
- drawdown
- active followers
- data freshness timestamp
- join-server link when configured
- open/details action

Marketplace controls:

- Sort by best 7D calls by default
- Sort by performance, drawdown, follower count, call count, newest, and fee
- Filter by verified status, minimum history, fee, activity, and risk
- Never rank by cherry-picked successful calls only
- Require a minimum sample size and show it
- Mark insufficient data clearly

### Discord owner onboarding and application

Discord community owners must connect their Discord account to DegenAration so commissions are attributed to the correct verified owner.

Implement the complete application flow inside the **Affiliate -> Discord Bot** area:

1. Connect Discord OAuth through the official Discord API.
2. Request only necessary scopes.
3. List guilds where the user is the owner or has an appropriate `Manage Guild` permission.
4. Require installation of the official DegenAration bot/application.
5. Verify server identity and permissions server-side.
6. Allow the owner to select one or more eligible call channels.
7. Validate that the bot can read required messages/embeds in those channels.
8. Collect server name, logo, description, invite URL, expected call format, supported channel language, and owner agreement.
9. Submit the application with `PENDING` status.
10. Let admin approve, reject with reason, request changes, suspend, or remove.
11. Revalidate ownership and bot permissions periodically.
12. Encrypt OAuth refresh tokens at rest and never expose them to the client.
13. Use Discord interaction signature verification. Never use self-bots or user tokens.

Preserve and verify any existing `/register` command or equivalent registration path rather than creating a second disconnected system.

### Discord signal ingestion

The Discord worker must process normal messages, embeds, links, replies, and supported structured commands from approved channels.

It must detect Solana mint addresses and token links from common sources, including direct base58 mint addresses and links from supported market/explorer/launchpad sites.

Required behavior:

- Validate the guild and channel against the approved source registry.
- Store the raw immutable event reference, parsed result, parser version, timestamp, and source identity.
- Deduplicate repeated messages, edits, cross-posts, and the same token called multiple times within the configured cooldown.
- Handle message edits/deletions without silently rewriting historical executions.
- Reconnect after gateway interruptions and backfill missed messages where the API permits.
- Use at-least-once delivery with idempotent processing.
- Quarantine ambiguous calls instead of guessing.
- Never execute a string that merely resembles a mint address without confirming it is a valid Solana mint.
- Record parser confidence and rejection reason.

### Discord bot configuration

Match the functional scope visible in the Discord reference video. Build a clean two-column desktop form that collapses safely on mobile.

Required fields and controls:

#### Identity and source

- Bot name
- Selected approved Discord server
- Optional specific channel, with `All approved channels` option
- server performance summary
- source fee and full fee preview

#### Funding and exposure

- Trading wallet
- wallet available balance
- fixed buy amount in SOL
- quick amount presets such as `0.1`, `0.5`, `1`, and `5`, while enforcing actual balance and risk caps
- maximum simultaneous open trades
- calculated minimum required SOL including trade capital, estimated network fees, platform fee, and creator fee
- maximum capital allocation
- daily loss limit
- per-token exposure limit

#### Entry and execution

- Market or limit-entry mode where supported
- Slippage cap
- Priority fee strategy and hard maximum
- bounded auto-retry
- bounded limit-order retry count
- quote expiration
- transaction simulation
- duplicate-signal cooldown
- optional first-call/first-buy-only behavior

#### Take profit

- One or more TP levels
- target percentage per level
- sell amount percentage per level
- total sell percentages must not exceed 100%
- trailing take-profit option
- visual allocation validation

#### Stop loss

- Stop-loss percentage
- trailing stop option
- dynamic stop option when supported
- emergency exit behavior
- freeze token after stop loss

#### Safety filters

Expose the full shared token-security filter system defined later in this prompt.

#### Final confirmation

Before activation, show an exact human-readable summary containing:

- server and channels
- wallet
- buy amount
- maximum trades/capital
- all TP/SL levels
- slippage and priority-fee maximums
- retries and cooldown
- enabled and disabled security filters
- platform fee
- Discord creator fee
- estimated worst-case capital exposure

Require explicit confirmation. The confirmation must explain that only calls passing the selected filters will be traded.

### Discord creator commission

Implement a default Discord creator commission of **0.7% = 70 basis points**.

Business rule:

- Apply the 70-bps creator commission once to each eligible, successfully confirmed Discord-copied swap’s executed notional.
- Do not accrue creator commission for failed, dropped, reverted, expired, simulated, cancelled, duplicate, or unreconciled transactions.
- Attribute it to the verified owner of the approved Discord source at the time of the signal.
- Snapshot the owner and commission configuration on the trade so later ownership changes do not rewrite history.
- Exclude self-copying, linked-account wash activity, and administratively reversed trades.
- Keep this value in server-side configuration, not scattered through UI code.
- Preserve any separate existing DegenAration platform fee, but itemize it independently and never double-charge.

Use integer basis points and lamports, never floating-point JavaScript arithmetic.

## 7. KOL Bot product

### Product definition

A KOL Bot is a user-created automated Solana strategy built from DegenAration’s token scanner, volatility triggers, safety filters, DCA, TP/SL, and execution controls. Other users can discover and copy a published KOL strategy.

This is not merely a static template. It must have a complete creator workflow, marketplace, subscriber workflow, execution pipeline, performance ledger, editing flow, and commission system.

### KOL creation limit

Each normal user may have a maximum of **three concurrently published KOL bots**.

- Drafts may be saved but cannot execute or earn.
- A published/active/paused KOL bot counts toward the limit.
- Archiving a bot frees a slot only after it has no open positions, pending signals, unpaid reversals, or active subscribers requiring management.
- Enforce the limit in the database and server, not only the UI.
- Admin may adjust/reset a user’s quota through an audited action.

### KOL marketplace

The KOL marketplace must display user-created strategies with:

- Original creator identity/display name
- strategy name and description
- verified/history status
- creator fee
- current followers
- active duration
- 1D / 7D / 30D / 3M performance
- net PnL
- realized PnL
- maximum drawdown
- win rate
- average hold time
- number of completed trades
- current open trades
- traded volume
- gas/network fees
- platform fees
- creator fees
- risk score and strategy risk settings
- creation date and last updated date

Use net-of-fees performance. Prevent cherry-picking by calculating from the immutable execution ledger. Show `insufficient history` when sample size is too small.

### KOL strategy builder

Reproduce the complete functional scope visible in the KOL/volatility video with an original DegenAration design.

#### Basic settings

- Bot name
- description
- trading wallet for the creator’s own instance
- fixed buy amount in SOL
- quick amount presets
- maximum capital
- maximum open trades
- daily loss limit
- token cooldown
- strategy visibility: draft/private/public

#### Token universe

Support both:

1. Manually entered Solana mint addresses
2. Scanner-driven dynamic token discovery through presets and advanced filters

#### Price-drop/volatility trigger

- Price-drop percentage
- reference mode: from recent ATH, selected moving average, or another supported reference
- lookback/price-drop period
- clear definition of how the reference is calculated
- minimum liquidity and freshness requirements at trigger time
- stale-price rejection

Do not claim guaranteed same-block execution. Optimize for low latency, measure it, and show actual signal-to-submit and submit-to-confirm latency.

#### Dollar-cost averaging

- Enable/disable DCA
- multiple DCA levels
- drop percentage for each level
- buy amount for each level
- total capital preview
- maximum number of DCA entries
- expiration
- validation against wallet balance and maximum capital

#### Take profit

- Multiple TP levels
- target percentage
- sell allocation per level
- trailing amount per level where supported
- validation that total allocation is exactly valid and does not exceed the position

#### Stop loss

- percentage stop
- trailing stop
- dynamic stop where supported
- delay/debounce to prevent noisy triggering
- freeze token after stop loss
- emergency close option

#### Retry and execution settings

- bounded auto-retry
- buy limit-order retries
- take-profit order retries
- stop-loss order retries
- quote expiration
- slippage cap
- priority-fee strategy and hard maximum
- simulation requirement
- maximum open trades
- freeze token after a configurable number of completed trades
- cooldown period

#### Scanner quick sets

Include the reference concepts as editable presets, not magic undocumented switches:

- Smart Money
- High Volume & High Volatility
- Top-10 Alpha
- Last Alpha Calls

#### Auto-refresh

Support scanner refresh periods such as:

- 5 minutes
- 15 minutes
- 30 minutes
- 1 hour
- 6 hours
- 24 hours

Also include:

- number of tokens to preview/select
- Degen Mode with a clear risk warning and explicit definition
- advanced filters
- preview-token results before activation
- save preset

### KOL subscriber setup

A subscriber copying a KOL strategy must configure:

- their own trading wallet
- buy amount or capital multiplier
- maximum capital
- maximum open positions
- daily loss limit
- slippage maximum
- priority-fee maximum
- optional stricter TP/SL/risk overrides
- pause/kill switch

The creator’s strategy logic must remain visible and versioned. Subscriber overrides may only make risk controls stricter unless a clearly disclosed option allows otherwise.

### KOL creator commission

Implement a default KOL creator commission of **0.2% = 20 basis points**.

Apply the same ledger and integrity rules as Discord commission:

- only successfully confirmed eligible copied trades
- immutable creator/config snapshot
- no failed/duplicate/self-copy commission
- integer basis-point and lamport math
- separate from platform fees
- pending, available, paid, reversed states

## 8. Shared Solana token scanner and security engine

### Required objective

Build the scanner to achieve the broadest practical coverage of Solana memecoins and token calls across supported liquidity venues. Do not fake an impossible claim that every future or private Solana program is supported.

The truthful acceptance target is:

> Discover and evaluate every valid SPL Token or Token-2022 mint encountered through approved Discord calls or supported on-chain pool/launch events, resolve all known supported liquidity venues through a versioned adapter registry, and expose measured coverage and explicit unsupported states instead of silently missing or guessing.

### Initial DEX/launch coverage

At minimum, use current official program documentation and repository-compatible SDKs to implement or preserve adapters for the Solana venues represented in the supplied manual and videos, including where currently available:

- Raydium AMM V4
- Raydium CPMM
- Raydium CLMM
- Raydium LaunchLab
- Pump.fun bonding-curve launches
- PumpSwap / Pump.fun swap pools
- Meteora AMM/DAMM
- Meteora DLMM
- Orca Whirlpool/pools
- Bonk-related launch/swap venue supported by the current routing stack
- Moonshot-related launch venue supported by the current routing stack
- Existing Solana swap aggregator/router integration in the repository

Do not hard-code guessed program IDs. Obtain current IDs from official SDKs/docs, keep them in a versioned server-side registry, and test them.

### Extensible architecture

Use clear interfaces such as:

```text
DexAdapter
TokenDiscoveryProvider
MarketDataProvider
RiskDataProvider
SwapRouter
RpcProvider
DiscordSignalParser
ExecutionProvider
```

A new Solana venue must be addable without rewriting the bot engine.

### Discovery paths

Use multiple complementary discovery paths:

1. Approved Discord message parsing
2. Pool creation and migration events
3. Launchpad creation/migration events
4. RPC/WebSocket or Geyser event streams when configured
5. Backfill/reconciliation from indexed provider APIs
6. Existing aggregator token/pool discovery

### Reliability requirements

- Handle RPC/WebSocket disconnections and resubscribe.
- Track processed slot and provider slot.
- Detect slot lag.
- Backfill missed ranges.
- Deduplicate events using unique source keys.
- Use durable queues and worker leases, not process-memory-only queues.
- Use bounded exponential backoff.
- Record provider latency and error rate.
- Support provider failover where the repository/infrastructure permits.
- Never execute twice because an event was delivered twice.
- Expose per-adapter coverage and health in Admin Console.
- Store unsupported program/mint events for later adapter development.

### Token validation

For every candidate mint:

- Confirm valid Solana public key
- Confirm mint account exists
- Detect SPL Token vs Token-2022
- Read decimals and supply safely
- Resolve active pools and quote asset
- Verify pool liquidity and executable route
- Detect stale or inconsistent price data
- Detect transfer-fee and other Token-2022 extensions
- Simulate buy and sell where possible
- Reject unsupported transfer behavior or non-sellable routes
- Never label a token `safe`; present risk indicators, source, confidence, and timestamp

### Complete shared filters

Implement the full filter set visible in the reference materials. Each filter needs enable/disable, validated min/max values, a data-source label, timestamp, and unavailable-data behavior.

- DEX filter
- Token age range
- Market-cap range
- Liquidity range
- Volume range with selectable time window
- Volatility-index range
- Smart-buy volume range
- Smart-buy wallet-count range
- Smart-sell volume range
- Smart-sell wallet-count range
- Smart-money inflow range
- Price-change range
- Maximum risky-wallet percentage
- Maximum fresh-wallet percentage
- Total-holder range
- Maximum top-10 holder concentration
- Maximum phishing-holder percentage
- Maximum bundler-holder percentage
- Maximum sniper-holder percentage
- Maximum bot-holder percentage
- KOL-holder range/maximum
- Smart-money-holder range/maximum
- Maximum developer-holder percentage
- Maximum degen-bot-holder percentage
- Only Latin letters/name-symbol check
- DEX-paid/verified-liquidity flag where reliable data exists
- Mint-authority state
- Freeze-authority state
- Mutable metadata state
- LP lock/burn status where determinable
- Token-2022 extension risk
- minimum route liquidity
- maximum price impact

When a required data source is unavailable, default to fail-closed for enabled security filters. Do not quietly treat missing data as passing.

### Scanner preview

The KOL builder and Discord bot setup must offer a preview showing tokens/calls that currently pass or fail, with reasons. The preview is informational and must not imply future guaranteed execution.

## 9. Trading execution and real-money safety

This system handles real funds. Treat correctness, idempotency, and reconciliation as higher priority than appearance.

### Environment modes

Implement explicit modes:

```text
paper
solana-devnet
solana-mainnet
```

- Default local/development mode to `paper` or devnet.
- Mainnet execution requires a clearly named environment flag and all required providers/secrets.
- Refuse startup or trading when mainnet configuration is incomplete.
- Display active mode in the Admin Console and user UI.

### Wallet and custody

Preserve the repository’s established wallet model if secure.

- Prefer user-signed or vetted embedded-wallet/provider flows.
- Never store raw private keys in plaintext.
- Never log key material.
- Encrypt any delegated signing material using a proper KMS/HSM/envelope-encryption design.
- Restrict decryption/signing to the execution service.
- Add key rotation and access auditability where applicable.
- Require step-up confirmation for withdrawals and sensitive wallet actions.

### Order state machine

Use an explicit durable transaction state machine similar to:

```text
CREATED
QUOTING
QUOTED
SIMULATING
AWAITING_SIGNATURE
SUBMITTING
SUBMITTED
CONFIRMED
FINALIZED
FAILED
EXPIRED
RECONCILING
REVERSED
```

Do not mark a trade successful when only submission succeeds.

### Atomicity and reconciliation

The existing product audit indicated a possible failure mode where a swap can be reported as successful even if trade recording fails. Eliminate this class of defect.

Required pattern:

- Create a durable trade intent before submission.
- Assign an idempotency key based on source signal, subscriber, bot, and execution leg.
- Enforce uniqueness in the database.
- Submit the transaction.
- Store signature immediately.
- Confirm/finalize on chain.
- Persist execution, position, fees, and commissions transactionally.
- Use an outbox/reconciliation worker so a confirmed chain transaction can always be recovered if the application/database write fails temporarily.
- Never silently drop a confirmed trade.
- Never create a duplicate position on retry.

### Execution controls

- Quote freshness validation
- Slippage hard cap
- Price-impact hard cap
- Priority-fee hard cap
- Transaction simulation
- blockhash-expiration handling
- bounded retries with idempotency
- circuit breaker on provider failure
- per-user, per-bot, per-token, and global kill switches
- maximum daily loss
- maximum capital
- maximum concurrent trades
- duplicate signal prevention
- token cooldown
- stale signal rejection
- clock/slot drift awareness

### Emergency behavior

Users must be able to pause each bot immediately. Admin must have a global pause for new entries. Pausing entries must not abandon exit management for open positions.

## 10. Affiliate section

The Affiliate page must contain two primary commission sections:

1. **Discord Bot**
2. **KOL Bot**

Also provide a Payouts/history view.

### Dashboard metrics

For each commission type show:

- Rewards available
- Pending rewards
- Lifetime earnings
- 30-day earnings
- active followers in the selected period
- copied-trading volume
- effective commission rate
- reversals/adjustments
- earnings chart
- 24H, 7D, 30D, and 3M periods
- recent earning events
- payout history

### Discord Affiliate section

Include:

- Connect/reconnect Discord account
- Apply a Discord server/channel
- Application status
- approved sources
- follower and performance metrics
- accrued 0.7% creator commission
- admin review messages
- edit application where allowed

### KOL Affiliate section

Include:

- Created KOL strategies
- quota usage out of three
- followers per strategy
- strategy volume and net performance
- accrued 0.2% creator commission
- public share/referral link
- pause/archive controls where appropriate

### Affiliate/referral link

Create a stable unique referral URL for eligible affiliate users. Use a non-guessable public code, not a raw user ID. Track attribution server-side with anti-abuse checks.

### Withdrawals

Implement commission withdrawal with:

- Minimum requested withdrawal: **0.1 SOL**
- Fixed processing/admin fee: **0.043 SOL**
- Default accounting convention: the 0.043 SOL fee is withheld from the requested amount and posted to the admin/platform commission ledger
- Show gross requested amount, processing fee, and net wallet payout before confirmation
- Reject a request when the user lacks sufficient available balance or the net payout is not positive
- Validate destination Solana wallet
- Require explicit confirmation and step-up authentication when supported
- Use pending/approved/processing/submitted/confirmed/failed/reversed states
- Use an idempotency key
- Store transaction signature
- Reconcile on chain
- Never subtract balance twice
- Never show paid before confirmation
- Allow admin review according to the existing payout policy

All balance and fee arithmetic must use lamports/big integers and a double-entry or equivalent immutable ledger.

## 11. Portfolio section

Portfolio is the single user-facing location for balances, positions, trades, and wallet transaction history.

### Header and balance controls

- Total portfolio value in SOL and optional fiat conversion
- Available balance
- allocated/locked capital
- realized PnL
- unrealized PnL
- total net PnL
- Deposit
- Withdraw
- network/mode indicator

### Performance chart

Provide a professional real-data chart with:

- 7 days
- 30 days
- 3 months

The chart must:

- Use time-series portfolio equity, not fabricated smooth data
- distinguish deposits/withdrawals from trading performance
- support SOL and fiat display when price data is available
- provide accessible textual summaries
- handle sparse data, empty states, and provider gaps honestly

### Main statistics

Include relevant metrics from the portfolio reference:

- total swaps
- gas/network fees
- buys vs sells transaction count
- buy vs sell volume
- wins vs losses
- last swap
- unique tokens
- risk/scam-flagged tokens
- realized/unrealized/net PnL
- maximum drawdown
- win rate

### Running positions

Show every open position created by either Discord Bots or KOL Bots.

Columns/cards:

- Token and mint
- Source type: Discord or KOL
- Source/server/strategy name
- Entry time
- average entry price
- current price
- quantity
- invested SOL
- current value
- realized PnL from partial exits
- unrealized PnL and percentage
- active TP/SL levels
- next action/status
- transaction health
- share PnL button
- details
- emergency close when safely supported

### Trade history

Show all previous bot trades with:

- token
- source
- bot
- entry and exit timestamps
- average entry and exit price
- buys/DCA legs
- sells/TP/SL legs
- gross PnL
- network fees
- platform fees
- creator fee
- net PnL
- transaction signatures/explorer links
- final status
- share PnL button

### Deposit and withdrawal history

Show:

- type
- amount
- fee
- net amount
- source/destination wallet
- timestamp
- signature
- confirmation status
- failure/reversal reason

### Deposit and withdrawal safety

- Validate network and address.
- Show exact amount, fee, and net result.
- Never expose private key material.
- Prevent double submission.
- Require confirmation.
- Reconcile every transaction.
- Keep withdrawals disabled in paper mode.

## 12. High-quality DegenAration PnL share cards

Create an original premium PnL-card system. Do not copy the WagieBot, TealStreet, Binance, Mizar, or other sample artwork.

### Required variants

1. Winning position/trade card
2. Losing position/trade card
3. Portfolio-performance card

### Placement

Add a share button to:

- every running position
- every completed trade
- the portfolio performance area

The portfolio PnL card is separate from the portfolio chart.

### Data integrity

Every card must be generated from authoritative ledger/position values and include fees consistently. Do not allow the client to submit an arbitrary PnL percentage.

### Card content

Depending on variant:

- DegenAration logo
- token symbol/pair
- positive or negative PnL percentage
- optional PnL in SOL
- average entry price
- current or exit price
- position duration
- source type and source name when privacy-safe
- timeframe for portfolio cards
- generated timestamp
- tasteful risk disclaimer
- verified referral/affiliate URL when the user is an eligible affiliate
- otherwise the canonical DegenAration website URL
- QR code generated from the same verified URL

Do not expose a wallet address, real name, Discord identity, balance, or exact position size unless the user explicitly opts in.

### Design

- Winning: sophisticated dark/gold base with controlled emerald energy, not a bright generic green rectangle
- Losing: dark/gold base with restrained crimson visual language, not humiliating or cartoonish
- Portfolio: elegant premium performance presentation, separate from individual trade cards
- Use original geometric/token-inspired artwork generated in code/SVG/Canvas; preserve brand consistency
- Crisp at social-media sizes
- High-resolution export
- Correct typography and tabular numerals
- No clipped text
- No low-resolution logos

### Animation and export

- The modal preview should have tasteful animation.
- Respect reduced motion.
- Export a deterministic high-resolution PNG/WebP.
- Optionally export a short MP4/WebM animated version when the current stack can support it reliably without heavy dependencies.
- The exported static card must remain excellent even without animation.
- Support copy link, download, and native share where available.

## 13. Data model and persistence

Adapt to the existing database. Do not introduce duplicate tables when equivalent entities already exist.

The final schema must support equivalents of:

- users
- roles/admin grants
- auth identities
- trading wallets
- linked Discord identities
- Discord guild applications
- approved Discord guilds/channels
- source ownership history
- bot profiles
- bot configuration versions
- Discord bot subscriptions
- KOL strategies
- KOL subscriptions
- scanner tokens and pool registry
- market snapshots
- risk snapshots
- raw signals
- parsed signals
- signal deliveries
- trade intents
- trade executions/legs
- positions/lots
- deposits and withdrawals
- commission ledger entries
- affiliate profiles/referral codes
- payout requests
- PnL-share-card records
- outbox events
- worker leases
- system flags/kill switches
- admin audit logs

### Required constraints

- Unique idempotency keys
- Foreign keys
- correct cascading/restrict behavior
- indexes for marketplace, positions, signals, and ledger queries
- check constraints for nonnegative amounts and valid basis points
- bot ownership enforcement
- maximum-three-KOL enforcement server-side/database-side where practical
- immutable financial ledger entries
- soft deletion for financially relevant records
- timestamps in UTC

Migrations must be forward-safe and include rollback guidance. Preserve existing production data.

## 14. API, jobs, and distributed-system behavior

The earlier audit identified that an in-memory API limiter is ineffective across multiple serverless instances. Replace process-memory-only production controls with a distributed implementation compatible with the existing deployment platform.

### Required infrastructure behavior

- Distributed rate limiting
- Durable job queue or database-backed queue
- Worker leases/heartbeats
- idempotent job handlers
- transactional outbox
- dead-letter handling
- bounded retries
- correlation IDs
- structured logs
- metrics and alerts
- no secrets or private wallet data in logs

### API requirements

- Typed request/response contracts
- schema validation at every trust boundary
- consistent error format
- server-side authorization
- CSRF protection where applicable
- secure cookies/session settings
- rate limiting by user/IP/action
- replay protection for sensitive actions
- no unbounded list endpoints
- cursor pagination for large histories

## 15. Frontend quality

### App shell

- Compact premium header
- Logo
- Bots, Affiliate, Portfolio
- Admin Console only for verified admins
- Wallet/account control
- No global token search
- No Tools menu
- No Terminal or standalone Trades navigation

### Components

Build/reuse a coherent system for:

- Page headers
- compact metric cards
- marketplace cards
- bot form sections
- range inputs
- numeric inputs
- preset chips
- filter drawers
- tables
- tabs
- status badges
- risk badges
- dialogs
- confirmation summaries
- transaction progress
- charts
- skeletons
- empty states
- actionable errors
- toasts

### Form requirements

- Labels and descriptions
- precise units
- min/max validation
- integer/basis-point aware formatting
- no hidden defaults
- dirty-state protection
- save feedback
- accessible keyboard behavior
- safe mobile controls
- full error messages without leaking internals

### Responsive behavior

Desktop should be dense like the references. Tablet and mobile must reorder panels without hiding critical fees, risk limits, TP/SL, or confirmation details.

### Accessibility

Target WCAG 2.2 AA for contrast, focus, keyboard use, dialogs, labels, status announcements, and reduced motion.

## 16. Repository audit and implementation sequence

Perform this sequence once and continue automatically.

### Phase A — focused reconnaissance

Read:

- repository guidance and `AGENTS.md`
- package manifests and lockfile
- framework/router config
- TypeScript/lint/test/build config
- auth and admin logic
- database schema/migrations/RLS
- wallet and transaction code
- Discord integration
- workers/jobs/queues
- current routes/components
- deployment configuration
- environment examples

Search for:

- TODO/FIXME/HACK
- mock production data
- disabled validation
- swallowed exceptions
- unsafe `any` and unchecked casts in financial paths
- hard-coded secrets
- client-side admin checks
- floating-point money math
- duplicate transaction paths
- process-memory rate limiters/queues
- missing idempotency
- placeholder buttons

Run a baseline using the repository’s real commands for install, lint, typecheck, unit/integration tests, production build, migration validation, and browser smoke test.

Create concise living docs:

- `docs/degenaration-current-state.md`
- `docs/degenaration-reference-coverage.md`
- `docs/degenaration-implementation.md`
- `docs/degenaration-architecture.md`
- `docs/degenaration-release.md`
- `IMPLEMENTATION_STATUS.md`

Do not stop for approval after writing them.

### Phase B — security and data foundations

Implement/fix:

- verified admin authorization
- environment modes
- financial integer math
- transaction state machine
- idempotency and reconciliation
- ledger and commission schema
- durable queues/rate limiting
- migration safety

### Phase C — simplified app shell

Implement:

- only Bots, Affiliate, Portfolio for normal users
- admin-only console link
- removal/redirect of old public sections
- gold/white/dim-black design system

### Phase D — Discord product

Implement complete owner onboarding, application/admin approval, source registry, marketplace, setup/editing, parser, execution, and 0.7% commission.

### Phase E — KOL product

Implement strategy builder, scanner/presets/filters, marketplace, subscriptions, maximum-three rule, editing, execution, and 0.2% commission.

### Phase F — Affiliate and payouts

Implement both commission tabs, charts, ledgers, application flow, 0.1 SOL minimum, 0.043 SOL fee, payout states, and admin controls.

### Phase G — Portfolio and PnL cards

Implement balances, chart periods, open positions, histories, deposit/withdraw, and all PnL-card variants/share flows.

### Phase H — scanner coverage and operational admin

Complete supported adapters, health/coverage reporting, backfill, unsupported-event handling, emergency controls, and audit logs.

### Phase I — final validation and cleanup

Run full checks, remove obsolete dead code, update docs/env examples, and produce final evidence.

## 17. Testing requirements

Use the repository’s existing test stack. Add only the minimum justified tools needed for missing coverage.

### Unit tests

Cover:

- basis-point calculations
- lamport/token decimal conversions
- creator/platform fee separation
- payout gross/fee/net calculation
- PnL calculations including partial exits and fees
- max-three-KOL rule
- filter validation
- Discord call parsing
- idempotency-key generation
- bot state transitions
- position state transitions
- admin-email normalization
- referral URL selection for PnL cards

### Integration tests

Cover:

- verified Google admin synchronization
- non-admin denial on all admin endpoints
- Discord application -> admin approval -> marketplace listing
- admin removal -> source hidden and follower bots paused
- KOL publication/subscription
- configuration versioning/edit flow
- signal -> filter -> trade intent -> simulated execution -> position -> commission ledger
- duplicate signal does not duplicate a trade
- confirmed-chain/write-failure reconciliation
- payout request -> fee ledger -> confirmation
- scanner adapter normalization

### End-to-end browser tests

At minimum:

1. Normal user sees exactly Bots, Affiliate, Portfolio and no Admin Console.
2. Admin user sees and can open Admin Console.
3. Direct non-admin admin URL/API access is denied.
4. User browses Discord marketplace and configures a bot.
5. User edits an existing Discord bot.
6. User creates/publishes KOL bots and the fourth published bot is rejected.
7. User copies a KOL bot with personal risk settings.
8. Affiliate charts and earnings use real fixture/ledger data.
9. Withdrawal preview shows minimum, 0.043 SOL fee, and net payout.
10. Portfolio switches 7D/30D/3M.
11. Running and historical positions display correct source and net PnL.
12. Winning, losing, and portfolio PnL cards generate correctly.
13. Mobile layouts retain critical risk controls.
14. Error, empty, loading, disconnected, insufficient-balance, and provider-outage states behave correctly.

### Security tests

- horizontal authorization/IDOR
- admin escalation
- forged client email
- CSRF/replay
- rate-limit bypass across instances
- duplicate payout/trade submission
- secret leakage in bundle/logs
- webhook/Discord signature validation
- unsafe redirect/referral URL
- SQL/RLS authorization
- input injection and malformed public keys

### Scanner coverage tests

Use maintained fixtures or devnet/test vectors for every implemented adapter family. Verify:

- valid mint detection
- Token-2022 handling
- pool normalization
- unsupported venue behavior
- Discord link/address parsing
- reconnect/backfill
- deduplication
- fail-closed filter behavior when data is unavailable

## 18. Release gates

Do not declare completion until all applicable gates pass:

- clean dependency install
- formatting check
- lint with no release-blocking errors
- strict typecheck
- unit tests
- integration tests
- end-to-end smoke tests
- production build with type/lint validation enabled
- migration validation/dry run
- no exposed secrets
- no high/critical dependency vulnerability without documented mitigation
- no known path that can double-submit a trade or payout
- no client-only admin protection
- no floating-point financial accounting
- no fake production analytics
- no abandoned open-position exit management
- responsive browser review
- screenshot-based visual-reference parity review for every supplied video and image
- complete reference-coverage matrix with no unreported missing control or state
- accessibility smoke check

If a release gate cannot pass because an external service or credential is unavailable, complete all code and local verification possible, mark the exact gate `BLOCKED`, and provide the precise credential/infrastructure action required. Do not call it passed.

## 19. Acceptance criteria

The task is complete only when all of these are true:

### Navigation and access

- Normal users see only Bots, Affiliate, and Portfolio.
- Terminal, standalone Trades, Search, and Tools are removed from normal product navigation.
- Admin Console is visible only to the verified admin role.
- `flipthatsol@gmail.com` receives the initial admin role only through verified Google authentication.
- Non-admin direct access is denied server-side.

### Discord Bots

- Owners connect Discord, prove server authority, submit channels, and receive admin approval.
- Approved sources appear in the marketplace.
- Admin can remove a Discord group/channel safely.
- Users can create, activate, pause, edit, and archive Discord bots.
- All settings shown in the supplied Discord setup video are represented functionally.
- Eligible confirmed copied trades accrue exactly 0.7% Discord creator commission according to the documented basis.

### KOL Bots

- Users can create complete scanner/volatility strategies.
- Users can edit them after setup.
- Each user can have at most three concurrently published KOL bots.
- Other users can browse and copy KOL strategies.
- Eligible confirmed copied trades accrue exactly 0.2% KOL creator commission.
- All settings and filter categories shown in the supplied KOL video are represented functionally.

### Affiliate

- Discord and KOL commission sections work.
- Earnings, followers, volume, rate, charts, events, and payouts are ledger-backed.
- Minimum withdrawal is 0.1 SOL.
- Processing fee is 0.043 SOL and is posted to the admin/platform ledger.
- Gross, fee, and net are shown before confirmation.

### Portfolio

- Deposit and withdrawal workflows are complete for the supported wallet model.
- Performance chart supports 7D, 30D, and 3M.
- Open positions include Discord and KOL sources.
- Trade history includes all bot trades and net fee breakdown.
- Deposit/withdrawal history is complete and reconciled.

### PnL cards

- Share button exists on every open position and historical trade.
- Separate portfolio PnL share control exists.
- Original high-quality positive, negative, and portfolio designs exist.
- Eligible affiliate users receive their referral URL/QR.
- Other users receive the canonical DegenAration URL/QR.
- Values cannot be forged by the client.

### Scanner and execution

- Approved calls and supported on-chain venues feed one normalized scanner.
- Raydium, Pump.fun/PumpSwap, Meteora, Orca, and other configured Solana venue adapters have explicit tested coverage.
- Unknown/unsupported venues are visible and fail safely.
- Duplicate signals cannot create duplicate trades.
- A confirmed trade cannot be lost because a subsequent database write failed.
- All fees and PnL use integer/decimal-safe accounting.
- Mainnet remains explicitly gated.

## 20. Final response format

After implementation and verification, provide one concise final report with:

1. What was implemented
2. Important architecture/security decisions
3. Database migrations created
4. Environment variables added or changed
5. Exact commands run and results
6. Browser flows verified
7. Any blocked external integrations and the exact action required
8. Any remaining non-release-blocking limitations
9. A short changed-file summary
10. Visual-reference coverage summary with screenshot-evidence locations
11. Mainnet readiness status: `NOT READY`, `READY FOR STAGING`, or `READY FOR CONTROLLED MAINNET REVIEW`

Do not provide inflated claims. Do not say `100% bug-free`. Report evidence.

## 21. Repository instruction file that must be created or updated

At the beginning of implementation, create or update the repository-root `AGENTS.md` with concise instructions equivalent to the block below. Preserve any existing valid repository-specific commands and merge them rather than overwriting useful guidance.

```md
# DegenAration Repository Instructions

The authoritative product specification is:

- `docs/DEGENARATION_MASTER_SPEC.md`

Read it completely before modifying code. Review every attached video and image listed in that specification before broad UI or product changes.

## Non-negotiable requirements

- Preserve the approved DegenAration logo and gold, white, and dim-black branding.
- The attached media are binding functional and visual references. Maintain `docs/degenaration-reference-coverage.md` with source timestamps, implemented components, and evidence.
- Normal users may see only Bots, Affiliate, and Portfolio.
- Admin access must be verified and enforced server-side. Never trust a client-provided email or role.
- Never execute mainnet transactions during development or automated testing.
- Never expose secrets, private keys, seed phrases, signing material, OAuth secrets, service-role keys, or production credentials.
- Never weaken lint, strict type checking, tests, authorization, database security, transaction confirmation, or reconciliation to obtain a passing build.
- Every visible control must work with persisted data, be clearly disabled with an exact reason, or be protected by a documented feature flag.
- Use integer/decimal-safe accounting for all SOL, token, fee, commission, payout, and PnL calculations.
- Do not report a requirement as passed without code, test, browser, authorization, and data-flow evidence as applicable.
- Maintain `IMPLEMENTATION_STATUS.md` with `PASS`, `PARTIAL`, `FAIL`, and `BLOCKED` requirements.
- Run targeted tests while developing and the complete release suite before reporting completion.
- Review the final diff for regressions, dead code, accidental secret exposure, and unrelated changes.
```

Also copy this complete master specification into the repository as `docs/DEGENARATION_MASTER_SPEC.md` so future Codex sessions and developers use the same source of truth.

## 22. Mandatory independent final release audit

After implementation, perform the following audit as a separate internal pass before writing the final response. Do not trust earlier progress messages or completion claims. Do not skip this audit because lint, tests, or the production build passed.

### Audit instructions

1. Read:
   - `docs/DEGENARATION_MASTER_SPEC.md`
   - `AGENTS.md`
   - `docs/degenaration-reference-coverage.md`
   - every attached video and image
   - the complete final diff
   - all database migrations
   - environment-variable documentation
   - deployment and worker configuration
2. Create a requirement matrix with one row for every requirement in this specification.
3. Mark each row exactly one of:
   - `PASS`
   - `PARTIAL`
   - `FAIL`
   - `BLOCKED`
4. Every `PASS` must cite concrete evidence:
   - relevant files
   - tests executed
   - browser flow verified
   - screenshot evidence when visual
   - API/database behavior verified
   - authorization behavior verified
   - transaction/ledger evidence when financial
5. Do not mark UI-only implementations as `PASS` when backend behavior, persistence, authorization, accounting, worker execution, reconciliation, or error handling is incomplete.
6. Fix every confirmed `FAIL` and `PARTIAL` item that is not externally blocked, in dependency and risk order.
7. Rerun targeted validation after each fix, then rerun the complete applicable release suite once.
8. Do not execute mainnet trades, deposits, withdrawals, payouts, or Discord announcements. Use mocks, paper mode, local services, controlled fixtures, or devnet.

### Minimum audit scenarios

Verify all of the following with reproducible evidence:

- Normal-user navigation and removed legacy routes
- Verified admin access using the configured authorized Google identity
- Admin denial for ordinary users at UI, route, API, action, database, and worker boundaries
- Discord account linking and verified server authority
- Discord source application, approval, rejection, suspension, removal, and reapproval
- Discord source removal pausing followers while preserving open-position exit management and history
- Discord bot creation, confirmation, activation, editing, versioning, pausing, resuming, and archiving
- KOL builder controls and every filter/settings category demonstrated in the supplied media
- KOL marketplace, copying, subscriber risk controls, editing, versioning, and three-published-bot limit
- Correct 0.7% Discord creator commission
- Correct 0.2% KOL creator commission
- Separate platform-fee accounting without double charging
- Affiliate earnings, referral attribution, charts, payout history, and anti-abuse handling
- 0.1 SOL payout minimum
- 0.043 SOL platform/admin processing fee
- Deposit and withdrawal accounting and reconciliation
- Portfolio 7D, 30D, and 3M performance excluding deposit/withdrawal distortion
- Running positions and complete trade history for Discord and KOL bots
- Positive, negative, and portfolio PnL cards with authoritative values
- Affiliate URL versus canonical website URL and matching QR code on PnL cards
- Duplicate-signal prevention
- Trade and payout idempotency
- Confirmed-chain/database-write reconciliation
- Scanner adapters, reconnect, backfill, slot lag, provider failure, and explicit unsupported-program handling
- Raydium, Pump.fun/PumpSwap, Meteora, Orca, LaunchLab, and every other adapter claimed by the UI
- Fail-closed behavior for enabled security filters when required data is unavailable
- Database constraints, row-level security, immutable ledgers, and audit logs
- Loading, empty, validation, disconnected-wallet, provider-outage, insufficient-balance, permission-denied, and transaction-failure states
- Desktop, tablet, and mobile visual fidelity
- All settings, tabs, tables, modals, edit flows, and card states shown in every supplied video and photo

### Required commands and checks

Run the repository's real equivalents of:

- clean dependency install
- formatting check
- strict lint
- strict typecheck
- unit tests
- integration tests
- end-to-end browser tests
- production build with validation enabled
- migration validation/dry run
- dependency/security audit
- secret scan
- final diff review

### Final audit output

The final report must separate:

- Verified complete requirements
- Visual-reference coverage results
- Remaining partial items
- Confirmed failures
- External blockers and exact actions required
- Non-release-blocking limitations
- Staging readiness
- Controlled-mainnet-review readiness

Do not state `100% complete`, `pixel perfect`, `fully bug-free`, or `mainnet ready` without reproducible evidence for every applicable requirement. A green build by itself is not sufficient.


Before beginning implementation, save this complete specification to `docs/DEGENARATION_MASTER_SPEC.md`, create or merge the required root `AGENTS.md`, and create the visual-reference coverage matrix. Then review every attached video and image, inspect the repository once, implement the complete DegenAration product directly and efficiently, and complete the mandatory independent final release audit before reporting results.
