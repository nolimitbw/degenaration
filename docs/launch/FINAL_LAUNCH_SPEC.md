# DegenAration — Claude Code Lead + Codex Review Final Senior-Quality Launch Remediation Prompt

> **Use this as one normal Claude Code task from the repository root. Do not use `/goal`, do not start with a plan-only response, and do not split this into repeated chat prompts. Claude Code is the primary implementer. Codex is an optional independent reviewer when usage is available.**
>
> The current product already contains most of the required features. This task is a focused launch remediation: preserve working functionality, fix the confirmed defects, replace the weak AI-looking interface with an original senior-designed product UI, complete live withdrawals, correct fee accounting, restore Discord/KOL performance journaling, remove duplicate Discord commands, and verify the entire public launch path.
>
> The visual and functional requirements from the earlier Mizar references, DegenAration recordings, bot configuration videos, affiliate video, portfolio video, KOL explanation image, PnL references, and the latest current-build recording are encoded below. Treat this file as the self-contained source of truth and do not require the product owner to upload those references again.

---

## 0. Claude Code and Codex teammate protocol

Claude Code and Codex do not share hidden reasoning or session memory automatically. Their reliable connection is the same Git repository, the same canonical specification, committed checkpoints, tests, and explicit handoff files. Treat the repository—not either agent's chat history—as the source of truth.

### Primary ownership

- **Claude Code is the primary implementation agent for this remediation.** It owns repository audit, coding, migrations, UI refinement, testing, and final evidence.
- **Codex is the secondary independent reviewer when available.** It should review committed diffs, run checks, identify missed requirements, and write findings without independently redesigning the product or starting a competing implementation.
- If Codex is unavailable because of usage limits, Claude Code must continue and use its own specialized subagents for independent review. Codex availability must never block implementation.

### Shared-source-of-truth files

Create and maintain these files before broad edits:

```text
CLAUDE.md
AGENTS.md
docs/launch/FINAL_LAUNCH_SPEC.md
docs/coordination/AI_HANDOFF.md
docs/coordination/IMPLEMENTATION_STATUS.md
docs/coordination/CODEX_REVIEW.md
docs/coordination/OPEN_BLOCKERS.md
```

Rules:

1. `docs/launch/FINAL_LAUNCH_SPEC.md` is the canonical product and acceptance specification.
2. `CLAUDE.md` is the concise Claude Code instruction entry point and must import or reference the canonical specification.
3. `AGENTS.md` is the concise Codex instruction entry point and must reference the same canonical specification.
4. `docs/coordination/IMPLEMENTATION_STATUS.md` tracks each requirement as `NOT STARTED`, `IN PROGRESS`, `PASS`, `PARTIAL`, `FAIL`, or `BLOCKED`, with evidence paths.
5. `docs/coordination/AI_HANDOFF.md` records the current branch, last verified commit, active work area, migrations, commands run, and the exact next action.
6. `docs/coordination/CODEX_REVIEW.md` is written by Codex or by Claude's independent reviewer. Findings must include severity, file/line evidence, reproduction steps, and expected behavior. Claude resolves each item with a commit and evidence.
7. `docs/coordination/OPEN_BLOCKERS.md` contains only genuine external blockers such as missing credentials, unavailable provider access, or an irreversible business decision.
8. Do not use chat claims as completion evidence. Use commits, tests, screenshots, database assertions, and these files.

### Git and workspace safety

- Never allow Claude Code and Codex to edit the same working tree at the same time.
- Claude Code should work on a dedicated branch such as `claude/degenaration-launch-remediation`.
- Codex should review a committed checkpoint in read-only mode or in a separate Git worktree/branch such as `codex/degenaration-review`.
- Codex must not overwrite Claude's uncommitted work.
- Claude must not silently discard Codex findings. Resolve, reject with evidence, or mark blocked.
- Use small, coherent commits after each verified vertical slice. Do not create one giant unreviewable commit.
- Before changing a file, check whether another agent has an active ownership note for that area in `AI_HANDOFF.md`.

### No agent ping-pong

- Do not ask the other agent to repeat the same audit.
- Do not alternate agents on every minor edit.
- Claude implements a coherent vertical slice, validates it, commits it, then Codex reviews the committed result.
- Claude fixes verified findings once and reruns only the affected checks, followed by the final full release suite.
- When agents disagree, the canonical specification, financial invariants, security requirements, tests, and observed runtime behavior decide—not stylistic preference.

### Recommended review roles inside Claude Code

Create focused project subagents under `.claude/agents/` for tasks that require independent context:

```text
.claude/agents/degenaration-ui-reviewer.md
.claude/agents/degenaration-financial-reviewer.md
.claude/agents/degenaration-performance-reviewer.md
.claude/agents/degenaration-release-auditor.md
```

Each subagent must be read-oriented by default, return concise evidence, and avoid editing unless explicitly assigned a fix. Use them after a vertical slice is implemented so the main context is not flooded with logs and repository-wide search output.

### Required division of work

1. Claude Code performs the initial focused audit and records baseline failures.
2. Claude Code implements financial correctness and withdrawals.
3. Claude Code repairs Discord/KOL performance journaling and Discord commands.
4. Claude Code performs the senior UI and copy remediation.
5. Claude Code runs targeted tests and commits each vertical slice.
6. Codex, when available, performs an independent diff and release review against the canonical specification and writes `CODEX_REVIEW.md`.
7. Claude Code resolves verified findings and runs the complete release suite.
8. Claude Code produces the final evidence report. Codex review is supporting evidence, not a substitute for tests.

---

## 1. Role and outcome

Act as the principal product engineer, senior product designer, design-systems lead, Solana execution engineer, backend architect, database engineer, Discord integration engineer, security engineer, QA lead, and release owner for **DegenAration**.

The outcome must be a polished public product that feels intentionally designed and maintained by an experienced human product team—not a generic AI dashboard. The final application must remain DegenAration: its existing logo, gold-and-white identity, black background, Bots/Affiliate/Portfolio structure, Discord Bot, KOL Bot, commissions, referrals, portfolio, scanner, and live Solana automation.

This is not a plan-only request. Perform one focused audit, implement the fixes, validate them, and provide evidence. Do not stop after explaining what should be changed.

### Current-state instruction

Most features already exist. **Do not rebuild the application from scratch.** Do not replace working authentication, database, wallet, Discord, scanner, trading, bot, affiliate, or portfolio foundations unless they are proven incorrect or unsafe. Make targeted changes with clear migration and rollback paths.

### Launch priority

Use this priority order:

1. Financial correctness and security
2. User withdrawals
3. Fee, creator-share, and referral accounting
4. Discord/KOL signal journaling and performance
5. Discord command correctness
6. Runtime bugs and indefinite loading
7. Senior-quality UI system and copy
8. Responsive, accessibility, and final release evidence

---

## 2. Non-negotiable execution rules

1. **Do not use `/goal`.**
2. Do not loop. Never repeat the same repository scan, command, explanation, or failed approach without a code/configuration change or new evidence.
3. Perform one structured initial audit, then inspect only files relevant to the current fix.
4. Keep progress updates short. Report only confirmed defects, completed vertical slices, blockers, and test results.
5. Do not spend time redesigning backend systems that already pass the required behavior.
6. Do not create mock production pages, fake metrics, fake calls, fake balances, or decorative buttons.
7. Every visible action must have a real purpose and complete behavior: loading, validation, authorization, persistence, success, error, retry, and recovery.
8. Do not disable TypeScript, linting, authorization, RLS, tests, transaction simulation, reconciliation, or build validation to obtain a green result.
9. Do not use broad `any`, unchecked financial casts, floating-point money math, swallowed exceptions, or process-memory-only production queues/rate limits.
10. Do not log or expose private keys, seed phrases, OAuth secrets, service-role keys, delegated signing secrets, or sensitive wallet information.
11. Never spend real user funds in automated tests. Use deterministic mocks, isolated test wallets, or devnet for tests. Production remains live-mainnet functionality.
12. Do not copy Mizar branding, wording, source code, icons, illustrations, or proprietary assets. Reproduce its clarity, density, progressive disclosure, and product maturity through an original DegenAration design.
13. Do not add generic AI-generated geometric banners, random gradients, emojis, mascot art, filler graphics, or meaningless animations.
14. Do not ask routine questions. Make conservative engineering decisions and document them. Ask only when blocked by unavailable external credentials or an irreversible business decision that cannot safely be inferred.
15. Do not claim “100% complete,” “bug-free,” or “mainnet ready” without reproducible evidence for every release gate.

---

## 3. Confirmed problems in the current build

The latest recording shows a product with many functions present but a weak launch experience. Treat the following as confirmed defects, not optional suggestions.

### 3.1 Visual design defects

- The global background is mostly flat black and lacks the refined depth, atmosphere, hierarchy, and visual character expected from a premium trading product.
- The product looks AI-generated because it relies on generic boxes, thin borders, random geometric cover banners, letter placeholders, repeated card templates, and excessive explanatory text.
- Discord marketplace cards waste a large portion of their height on dark geometric cover art containing tiny initials such as `D`, `SD`, or `D/A` instead of presenting useful data.
- The actual Discord server profile picture is too small and visually secondary.
- The UI lacks a deliberate icon language and may use generic emojis or generic symbols where professional icons are required.
- The interface is too text-heavy and reads like engineering documentation instead of a clear trading product.
- Technical internal phrases appear in the public UI, including concepts similar to controlled release approval, fallback fills, activation locks, database reserves, and implementation details.
- The hierarchy is flat: too many panels look equally important, primary actions do not dominate, and users must read too much before acting.
- Empty screens feel unfinished rather than intentional.

### 3.2 Discord and KOL marketplace defects

- Two Discord sources are approved/listed, but their marketplace performance fields remain `--`, zero, or “insufficient measured history.”
- Eligible-call counters remain at zero and source performance is not being journaled correctly.
- The current Discord listing does not communicate live status, last call, call outcomes, scanner health, or measured performance.
- KOL marketplace content can remain empty without a useful recovery path.
- The scanner, parser, queue, price-tracking, or performance aggregator may not be completing the full signal-to-journal pipeline.

### 3.3 Runtime defects

- Affiliate content can remain on an indefinite loading spinner.
- Portfolio can show no reconciled equity series and blank performance/history without a clear actionable empty state.
- The public UI exposes operational or release-lock messages that should only exist in Admin Console diagnostics.
- Some routes can show a full-page loading state without timeout, error, retry, or correlation information.

### 3.4 Withdrawal defects

- The Portfolio withdrawal modal currently states that in-app transfers are unavailable and tells users to manage funds from a connected wallet.
- This is not acceptable for the intended public product when the application accepts user deposits or controls an application wallet.
- Users must be able to withdraw their own available funds without a routine administrator approval, release permission, or hidden feature enablement.

### 3.5 Fee and revenue defects

- The final platform fee rule is not implemented or communicated consistently.
- The owner requires a **2.00% platform execution fee on each successfully confirmed swap leg**.
- Creator and referral rewards must be accounted for correctly without double charging, fee-on-fee behavior, or unprofitable accounting.

### 3.6 Discord command defects

- Discord currently exposes duplicate `/register` commands.
- Command registration is likely occurring through more than one scope or deployment path.
- Every command must exist exactly once, have a defined purpose, correct permissions, complete behavior, and automated tests.

---

## 4. Repository instruction and skill files

Create or update the following files so future Claude Code and Codex sessions follow the same standards. Keep both root instruction files concise and place detailed workflows in the shared specification, Claude subagents, repository skills, and launch documentation.

### 4.0 Root `CLAUDE.md`

Create or update `CLAUDE.md`. Keep it concise and use it as Claude Code's project-memory entry point. It must contain instructions equivalent to:

```md
# DegenAration Claude Code instructions

Read these files before modifying product behavior:

- @docs/launch/FINAL_LAUNCH_SPEC.md
- @docs/coordination/IMPLEMENTATION_STATUS.md
- @docs/coordination/AI_HANDOFF.md

Mandatory rules:

- Preserve working functionality and make targeted, reversible changes.
- Claude Code is the primary implementer; Codex is an independent reviewer of committed checkpoints.
- Never let two agents edit the same working tree concurrently.
- Normal-user navigation is Bots, Affiliate, and Portfolio only.
- Use the existing DegenAration logo and the approved black, gold, and white design system.
- No emoji icons, generic geometric Discord covers, fake production data, placeholder controls, or long engineering explanations in the primary UI.
- User principal withdrawals are self-service and server-authorized; routine admin approval is prohibited.
- Platform execution fee is 200 basis points per confirmed swap leg. Use integer arithmetic and immutable ledgers.
- Discord and KOL performance comes from durable signal and execution journals.
- Every Discord application command must be unique, purposeful, permissioned, documented, and tested.
- Never execute mainnet transactions in automated tests.
- Never weaken authentication, RLS, lint, typecheck, tests, idempotency, reconciliation, or financial invariants.
- Run targeted checks while editing and the complete release suite before completion.
- Do not report completion without code, test, browser, data, and screenshot evidence.
- Update the coordination files after every verified vertical slice.
```

Do not paste the full long specification into `CLAUDE.md`; import or reference the canonical documents to avoid duplicated and conflicting instructions.

### 4.0A Claude project subagents

Create the following focused Claude Code subagents under `.claude/agents/` using valid Claude Code subagent front matter and narrowly scoped instructions:

#### `.claude/agents/degenaration-ui-reviewer.md`

Review only visual hierarchy, copy density, icons, responsive behavior, accessibility, loading/empty/error states, Discord/KOL marketplace presentation, and adherence to the original black/gold DegenAration direction. Reject emoji icons, random geometric banners, giant empty cards, repetitive explanatory prose, fake metrics, and generic AI-dashboard patterns.

#### `.claude/agents/degenaration-financial-reviewer.md`

Review only the 200-bps per-leg fee, creator/referral allocation, lamport arithmetic, immutable ledgers, withdrawals, locked/spendable balance, idempotency, transaction state transitions, reconciliation, and authorization. Treat any possibility of double charge, lost funds, duplicate withdrawal, client-forged fee, or unbalanced ledger as release-blocking.

#### `.claude/agents/degenaration-performance-reviewer.md`

Review only Discord/KOL signal ingestion, scanner parsing, raw-event persistence, deduplication, baseline price capture, price sampling, call status transitions, outcome calculation, aggregation, backfill, and marketplace freshness. Require an end-to-end test from an approved Discord call or KOL trigger to visible measured performance.

#### `.claude/agents/degenaration-release-auditor.md`

Independently inspect the final committed diff and requirement matrix. Run or verify the complete release suite, browser flows, authorization checks, Discord command uniqueness, visual screenshots, and remaining blockers. It must not accept the main agent's completion claims without evidence.

Subagents should return concise findings with severity, evidence, reproduction, and required correction. Do not spawn multiple agents that perform the same review.

### 4.1 Root `AGENTS.md`

Create or update `AGENTS.md` with concise rules equivalent to:

```md
# DegenAration repository instructions

Read `docs/launch/FINAL_LAUNCH_SPEC.md` before modifying product behavior.

Mandatory rules:

- Preserve working functionality; make targeted, reversible changes.
- Normal-user navigation is Bots, Affiliate, and Portfolio only.
- Public UI must use the DegenAration logo and the approved black, gold, and white design system.
- No emoji icons, generic geometric Discord covers, fake production data, placeholder controls, or long engineering copy in the primary UI.
- User principal withdrawals must be self-service and server-authorized; routine admin approval is not allowed.
- Platform execution fee is 200 bps per confirmed swap leg. Use integer arithmetic and immutable ledgers.
- Discord/KOL performance must come from durable signal and execution journals.
- Every Discord application command must be unique and purposeful.
- Run targeted tests while editing and the complete release suite before completion.
- Never execute mainnet transactions in automated tests.
- Never weaken auth, RLS, lint, typecheck, tests, idempotency, or reconciliation.
- Do not report a requirement as complete without code, test, browser, and data evidence.
```

Do not place the entire long prompt in `AGENTS.md`.

### 4.2 Repository skills

Create these local skills under `.agents/skills/` using valid `SKILL.md` YAML front matter with a precise `name` and `description`. Keep them focused rather than duplicating the whole specification.

#### `.agents/skills/degenaration-ui/SKILL.md`

Purpose: apply the DegenAration senior UI system, information hierarchy, compact product copy, icon rules, responsive behavior, and visual-regression process whenever frontend pages/components are changed.

It must require:

- no emojis
- no generic AI banners
- no public engineering jargon
- progressive disclosure through info buttons/tooltips/drawers
- use of semantic design tokens
- screenshot review at desktop/tablet/mobile widths
- reuse of approved components
- verification of loading, empty, error, and populated states

#### `.agents/skills/degenaration-financial-integrity/SKILL.md`

Purpose: enforce lamport/basis-point arithmetic, fee allocation, immutable ledger entries, withdrawal safety, idempotency, transaction state machines, and reconciliation whenever money or trades are modified.

It must require:

- no floating-point financial math
- no success before on-chain confirmation policy is satisfied
- no duplicate trades, fees, rewards, or withdrawals
- exact ledger balancing
- test vectors for buy, sell, partial fill, retry, failure, reversal, and reconciliation

#### `.agents/skills/degenaration-performance-journal/SKILL.md`

Purpose: enforce the complete Discord/KOL signal-to-performance pipeline whenever scanner, parser, price, call, strategy, or marketplace metrics are changed.

It must require:

- raw event persistence
- parser versioning
- deduplication
- baseline price capture
- durable price sampling
- call status transitions
- outcome computation
- aggregation and cache invalidation
- historical backfill
- source health diagnostics

#### `.agents/skills/degenaration-release-audit/SKILL.md`

Purpose: independently validate release readiness after implementation.

It must require:

- review of the full diff
- requirement matrix
- exact commands and results
- browser evidence
- authorization tests
- ledger invariant tests
- Discord-command uniqueness check
- screenshot evidence
- honest staging/mainnet readiness result

### 4.3 Required launch documentation

Create or update:

```text
docs/launch/FINAL_LAUNCH_SPEC.md
docs/launch/UI_SYSTEM.md
docs/launch/UI_COPY.md
docs/launch/FEE_AND_REWARD_MODEL.md
docs/launch/WITHDRAWAL_FLOW.md
docs/launch/PERFORMANCE_JOURNAL.md
docs/launch/DISCORD_COMMANDS.md
docs/launch/RELEASE_CHECKLIST.md
docs/launch/RELEASE_EVIDENCE.md
```

These documents are living implementation references, not long status essays. Link them from `docs/launch/FINAL_LAUNCH_SPEC.md`.

### 4.4 Deterministic verification scripts

Add lightweight scripts using the existing runtime/tooling where appropriate:

```text
scripts/check-visible-copy.mjs
scripts/check-discord-commands.mjs
scripts/verify-fee-ledger.mjs
scripts/verify-performance-journal.mjs
```

Required behavior:

- `check-visible-copy`: detect forbidden public phrases, obvious placeholder text, and emoji characters in production UI strings. Permit necessary Unicode symbols only through an explicit allowlist.
- `check-discord-commands`: read the command registry/build output and fail on duplicate names, conflicting scopes, missing descriptions, unsupported permissions, or handlers without tests.
- `verify-fee-ledger`: execute deterministic fee/reward vectors and confirm debits equal credits.
- `verify-performance-journal`: confirm a fixture signal moves through raw event, parse, eligibility, baseline price, sampling, outcome, aggregation, and marketplace projection without duplication.

Wire these checks into the repository’s validation workflow without adding unnecessary heavy dependencies.

---

## 5. Senior-designed visual system

The quality target is the clarity and maturity seen in top professional trading tools: compact navigation, strong hierarchy, data-first screens, limited prose, excellent tables/forms, deliberate spacing, and polished microinteractions. The design must be original DegenAration—not a clone.

### 5.1 Core aesthetic

- Deep charcoal-black canvas rather than pure featureless black.
- Warm gold as the primary interactive accent.
- Off-white primary text and warm gray secondary text.
- Green and red only for factual positive/negative states.
- Restrained use of borders and glows.
- Dense but breathable layouts.
- No neon casino aesthetic.
- No random polygon banners.
- No giant empty cards.
- No glossy AI-generated gradients.
- No emojis as interface icons.

### 5.2 Semantic tokens

Consolidate visual values into semantic tokens. Adapt existing approved colors while staying close to:

```css
:root {
  --canvas: #070706;
  --canvas-elevated: #0a0a08;
  --surface-1: #0d0d0b;
  --surface-2: #12110e;
  --surface-3: #181610;
  --surface-hover: #1d1a13;

  --border-subtle: rgba(240, 213, 155, 0.10);
  --border-default: rgba(240, 213, 155, 0.16);
  --border-strong: rgba(221, 182, 103, 0.30);

  --gold-100: #fff3d6;
  --gold-200: #f5dfad;
  --gold-300: #e8c77f;
  --gold-400: #d7ad5a;
  --gold-500: #bd8735;
  --gold-600: #936526;

  --text-primary: #f5f2ea;
  --text-secondary: #b5afa3;
  --text-muted: #7f796f;
  --text-disabled: #575249;

  --success: #3bd180;
  --success-muted: rgba(59, 209, 128, 0.12);
  --danger: #ff5f69;
  --danger-muted: rgba(255, 95, 105, 0.12);
  --warning: #e3b858;
  --info: #8faeff;

  --shadow-panel: 0 20px 60px rgba(0, 0, 0, 0.28);
  --shadow-focus: 0 0 0 3px rgba(215, 173, 90, 0.16);
}
```

Do not scatter raw colors across components.

### 5.3 Global background

Replace the flat background with an original, code-generated DegenAration backdrop. It must add depth without competing with data.

Implement a reusable background component such as `DegenBackdrop` using CSS and/or optimized inline SVG:

- base charcoal canvas
- subtle warm radial illumination near the top-left and primary content area
- very faint 48–64px technical grid at approximately 1.5–2.5% opacity
- controlled film-grain/noise texture below 3% opacity
- one or two large low-contrast orbital curves or signal paths using gold at 3–6% opacity
- gentle edge vignette
- no fast movement, floating particles, random blobs, or bright gradients
- no content-dependent layout shift
- no bitmap background that becomes blurry on large screens
- respect `prefers-reduced-motion`

The backdrop must be visible enough to feel premium but subtle enough that tables and charts remain the focus.

### 5.4 Layout dimensions

Use a deliberate responsive system:

- header height: approximately 60–64px desktop, 56px mobile
- content width: up to approximately 1480–1560px with responsive gutters
- desktop gutters: 24–32px
- tablet gutters: 20–24px
- mobile gutters: 14–16px
- base spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48
- panel radii: 10–14px, not overly rounded pill cards
- control height: 36–42px depending on importance
- table row height: 44–52px
- page title: 26–32px desktop, 22–26px mobile
- body copy: 13–15px
- numeric metrics: tabular numerals

### 5.5 Typography

Use the current approved high-quality typeface if available. Otherwise use a professional interface family such as Geist/Inter-compatible fonts already supported by the stack.

- Primary interface text: clean sans serif
- Numeric and technical labels: tabular numerals; optional restrained mono for signatures/mints only
- Avoid excessive uppercase text and excessive letter spacing
- Avoid tiny 9–10px text except noncritical metadata
- No decorative typeface for body content
- Limit line lengths to maintain scanability

### 5.6 Icon system

Remove emojis and inconsistent generic icons.

Create a coherent icon layer:

- Use one professional SVG icon library already in the project for universal actions such as search, settings, edit, pause, play, copy, external link, info, deposit, withdraw, and close.
- Create original DegenAration product glyphs as simple SVG components for Discord automation, KOL strategy, signal scanning, referrals, performance, portfolio, and risk.
- All icons must use consistent stroke width, corner style, optical size, and alignment.
- Icons must have accessible labels when the meaning is not obvious.
- No emoji, Unicode pictograms, clip art, or generated mascot faces.
- Do not use logos from third-party products except official service logos where legally and contextually appropriate, such as the Discord mark for Discord OAuth.

Recommended component structure:

```text
src/components/icons/DegenBotIcon.tsx
src/components/icons/DiscordSignalIcon.tsx
src/components/icons/KolStrategyIcon.tsx
src/components/icons/AffiliateLinkIcon.tsx
src/components/icons/PortfolioCurveIcon.tsx
src/components/icons/ScannerPulseIcon.tsx
src/components/icons/RiskShieldIcon.tsx
```

### 5.7 Motion

Use motion only to communicate state:

- 120–180ms hover/focus transitions
- 180–240ms dialog/drawer transitions
- subtle chart interpolation
- skeleton shimmer only during actual loading
- no continuous decorative movement in critical trading screens
- no animation that delays buttons or obscures status
- full reduced-motion support

---

## 6. Information architecture and public copy rules

Normal authenticated users must see only:

1. **Bots**
2. **Affiliate**
3. **Portfolio**

The header may contain logo, network state, notification icon, wallet/account menu, and sign out. Admin Console remains visible only to verified admins.

### 6.1 Public-copy rules

The current product contains too much explanatory and technical copy. Replace it with concise, confident product language.

Rules:

- Page header description: maximum one short sentence, preferably 50–100 characters.
- Product card description: one sentence, maximum two lines.
- Field helper text: omit by default; use an info icon when explanation is useful.
- Tooltip: concise explanation, normally below 240 characters.
- Complex guidance: use a right-side information drawer opened by an `Info` button.
- Do not show internal architecture, database, worker, reconciliation, release-lock, or provider details to normal users.
- Do not use defensive marketing copy such as “we only take a small fee.”
- Do not repeat the same explanation in a page header, card, field, and footer.
- Do not use filler eyebrows above every title.
- Do not present warnings as permanent paragraphs. Use contextual alerts only when action is required.

### 6.2 Required primary copy

Use concise copy close to the following, adapting only for accuracy and established brand voice.

#### Bots

Title: `Bots`

Subtitle: `Automate approved Discord calls or run a community strategy.`

Product card 1:

- Title: `Discord Bot`
- Description: `Copy approved call channels with your own risk and exit rules.`
- Primary action: `Browse Discord sources`

Product card 2:

- Title: `KOL Bot`
- Description: `Discover community strategies or publish one of your own.`
- Primary action: `Explore strategies`

Bot manager:

- Title: `My Bots`
- Subtitle: `Manage live bots, risk limits, and performance.`

#### Discord marketplace

Title: `Discord Sources`

Subtitle: `Approved call communities with measured on-chain performance.`

Empty state:

- Title: `No sources match these filters`
- Body: `Clear a filter or check again after new calls are measured.`
- Action: `Clear filters`

Unmeasured source state:

- Label: `Tracking started [date]`
- Tooltip: `Performance appears after eligible calls receive enough market data.`

Do not show “Insufficient measured history” as a large repeated error block on every card.

#### KOL marketplace

Title: `KOL Strategies`

Subtitle: `Copy public strategies built and tracked on DegenAration.`

Empty state:

- Title: `No strategies match these filters`
- Body: `Clear filters or create the first strategy in this view.`
- Actions: `Clear filters`, `Create KOL bot`

#### Affiliate

Title: `Affiliate`

Subtitle: `Track creator and referral earnings.`

Do not show technical copy such as “immutable commission accounting” in the page header.

#### Portfolio

Title: `Portfolio`

Subtitle: `Balances, positions, performance, and transactions.`

Empty performance:

- Title: `No portfolio history yet`
- Body: `Performance appears after your first deposit or confirmed bot trade.`

#### Wallet

Title: `Wallet`

Subtitle: `Fund your automation wallet and manage spending limits.`

Replace long paragraphs about delegated automation with an info button labeled `How automation access works`.

### 6.3 Info-button pattern

Use an outlined circular `i` icon or `Info` action near complex sections such as:

- automation access
- platform fee
- creator revenue share
- slippage
- priority fee
- DCA
- trailing take profit
- dynamic stop loss
- token security filters
- performance calculation
- referral attribution
- withdrawal availability

The primary screen must remain concise. The info drawer may contain the fuller explanation and links to documentation.

---

## 7. App shell and page-level UI

### 7.1 Header

- Preserve the DegenAration logo at a clear but compact size.
- Use only Bots, Affiliate, and Portfolio for normal users.
- Active navigation uses a restrained gold underline or surface state.
- Network control shows `Solana Mainnet` without dominating the header.
- Wallet control shows shortened address or account name and balance where appropriate.
- Use proper SVG icons for security, notifications, settings, and account actions.
- Remove redundant labels and any permanent release-warning footer from public pages.

### 7.2 Page header

Each page header should contain:

- title
- one-sentence subtitle
- one or two primary actions
- optional small status chips

Do not place a full paragraph under each title.

### 7.3 Panels and cards

- Use surfaces only to group related information.
- Avoid putting every label inside its own bordered box.
- Use dividers and spacing inside cards before adding nested cards.
- Primary action uses solid gold.
- Secondary action uses subtle border/surface.
- Destructive action uses red only after confirmation.
- Use skeletons that resemble final content, not a centered spinner in a giant empty rectangle.

### 7.4 Tables

- Sticky header for long tables.
- Sortable columns where useful.
- Compact numeric alignment.
- Mobile transforms to structured cards without losing fees, risk, status, or actions.
- No horizontal clipping of critical controls.

---

## 8. Discord marketplace redesign

The current giant geometric cover photos must be removed. The product owner explicitly wants the Discord server profile picture as the main visual identity; no artificial cover banner is required.

### 8.1 Card structure

Build a compact, data-first Discord source card.

Recommended desktop card anatomy:

1. **Header row**
   - 52–64px Discord server avatar
   - server name
   - verified badge
   - integration-health dot
   - optional member/follower metadata
   - `Details` overflow/action

2. **One-line description**
   - maximum two lines
   - sanitized server description or concise approved fallback

3. **Period control**
   - 1D / 7D / 30D
   - default 7D

4. **Performance row**
   - Win rate
   - Median return
   - Average return
   - Maximum drawdown
   - Eligible calls

5. **Compact performance visual**
   - small sparkline or outcome distribution
   - not a decorative banner

6. **Outcome distribution**
   - `<50%`
   - `+50%`
   - `2x`
   - `5x+`
   - show counts and percentages when measured

7. **Status/footer**
   - last eligible call timestamp
   - tracking/data-freshness state
   - creator share shown as `Included in 2% fee` or concise fee info through tooltip
   - primary `Configure bot` action

### 8.2 Avatar behavior

- Fetch and cache the actual Discord guild icon through permitted Discord APIs.
- Preserve its aspect ratio and render crisply.
- If no icon exists, use a polished initials avatar in the DegenAration system.
- Do not create a full-width fake cover image.
- Never show broken or empty image placeholders.

### 8.3 Responsive grid

- Two cards per row on wide desktop where space permits.
- One card per row on tablet/mobile.
- Avoid cards taller than necessary.
- Keep primary performance metrics above the fold.

### 8.4 Source details page

The details page may include richer information:

- 1D/7D/30D performance chart
- call outcome history
- token list
- timestamps
- drawdown
- median/average return
- measured sample size
- recent calls and statuses
- integration health
- creator terms
- join-server link when approved
- configure action

Do not overcrowd the marketplace card with every detail.

---

## 9. Discord and KOL performance journaling

Fix the underlying reason the two current Discord sources show no measured history. Do not merely replace `--` with fabricated values.

### 9.1 Required signal journal

Every approved Discord call and every KOL strategy signal must produce one durable normalized record with:

- unique signal ID
- source type: Discord or KOL
- source/server/strategy ID
- guild and channel ID when Discord
- message/event ID when Discord
- raw event reference and immutable content hash
- parser version
- detected mint
- event timestamp
- ingestion timestamp
- validation state
- parser confidence
- rejection reason when rejected
- baseline-price source and timestamp
- baseline liquidity and route
- eligibility result and filter snapshot
- bot subscribers eligible at that moment
- deduplication key

### 9.2 Signal states

Use an explicit state machine such as:

```text
RECEIVED
PARSING
PARSED
VALIDATING
REJECTED
ELIGIBLE
QUEUED
EXECUTING
OPEN
PARTIAL_EXIT
TP_HIT
SL_HIT
CLOSED
EXPIRED
DATA_ERROR
```

A call can be measured even when a user did not copy it, but marketplace call-performance and user-trade performance must be labeled separately.

### 9.3 Baseline price

At eligibility time:

- resolve valid mint and executable route
- capture a timestamped baseline price from a reliable normalized provider
- store liquidity, pool, quote asset, price source, slot, and confidence
- reject stale or inconsistent data
- never backfill a favorable baseline after price movement

### 9.4 Market-data sampling

Create durable sampling jobs for eligible calls:

- immediate baseline
- short intervals during the first hour
- appropriate intervals through 24h, 7d, and 30d
- final snapshots at configured horizons
- provider failover and backfill
- idempotent unique keys per signal/time bucket

Do not create unbounded per-signal jobs when a batch sampler is more reliable.

### 9.5 Outcome computation

Compute and persist:

- return at each standard horizon
- maximum favorable excursion
- maximum adverse excursion
- time to +50%
- time to 2x
- time to 5x
- time to configured stop threshold
- peak return
- close/expiry reason
- data completeness and confidence

Define marketplace categories consistently. Document exact formulas in `docs/launch/PERFORMANCE_JOURNAL.md`.

### 9.6 Discord aggregate metrics

For 1D, 7D, and 30D periods calculate from eligible, non-duplicate, sufficiently measured calls:

- measured-call count
- eligible-call count
- win rate
- median return
- average return
- maximum drawdown
- `<50%`, `+50%`, `2x`, and `5x+` distribution
- last call
- data freshness

Use a minimum sample threshold. When below the threshold, show actual measured count and `Tracking` rather than a page full of dashes.

### 9.7 KOL metrics

KOL marketplace performance must use immutable confirmed execution/trade data, net of all fees, for the strategy’s tracked instance or clearly defined aggregation model.

Show separately:

- strategy signal performance
- creator live-instance performance, when available
- subscriber aggregate performance, only when privacy-safe and statistically valid

Never mix these into one misleading figure.

### 9.8 Historical repair

For the two currently approved Discord servers:

1. Verify application, guild, channel, bot permission, and marketplace visibility records.
2. Verify the gateway listener is subscribed to the approved channels.
3. Verify raw messages are arriving.
4. Verify the parser recognizes supported address/link formats.
5. Verify queue workers process events durably.
6. Verify baseline pricing resolves for Raydium, Pump.fun/PumpSwap, Meteora, Orca, and other supported routes.
7. Verify sampling and aggregation jobs run.
8. Verify marketplace cache invalidation/projection updates.
9. Backfill permitted historical messages and market data where reliable.
10. If historical data cannot be reconstructed honestly, begin tracking from the earliest verified timestamp and display `Tracking since [date]`.

### 9.9 Scanner admin diagnostics

Add or complete Admin Console diagnostics:

- latest ingested Discord message per source
- latest parsed signal
- parser failure rate
- unsupported-link/mint events
- queue depth
- oldest pending job
- worker heartbeat
- RPC/indexer slot lag
- market-data provider health
- latest baseline-price capture
- latest sample
- latest aggregate refresh
- retry/dead-letter counts
- action to replay a safe event idempotently

---

## 10. Solana scanner reliability

Maintain broad supported Solana memecoin coverage without falsely claiming every unknown future program is supported.

### Required adapter families

Preserve or complete tested adapters for the routes used by the current system, including:

- Raydium AMM V4
- Raydium CPMM
- Raydium CLMM
- Raydium LaunchLab
- Pump.fun bonding curve
- PumpSwap
- Meteora AMM/DAMM
- Meteora DLMM
- Orca pools/Whirlpools
- supported Bonk/Moonshot launch routes
- current swap aggregator/router integration

Use official SDKs/program registries. Do not guess program IDs.

### Required behavior

- Parse direct Solana mint addresses and supported explorer/DEX/launchpad links.
- Confirm mint account and token program.
- Support SPL Token and compatible Token-2022 tokens with explicit extension risk checks.
- Resolve live liquidity and executable route.
- Reject stale quotes, unavailable sell routes, excessive price impact, unsupported transfer behavior, and insufficient liquidity.
- Deduplicate cross-posted messages and repeated calls.
- Reconnect, backfill, and reconcile after worker/provider outages.
- Record unsupported programs visibly for future adapter work.
- Fail closed for enabled safety filters when required data is unavailable.

---

## 11. Bot configuration UI simplification

Keep the full functionality already implemented, but restructure the forms so beginners are not overwhelmed and professionals can still access every control.

### 11.1 Section order

Use progressive disclosure:

1. Source / Strategy
2. Budget
3. Entry
4. Take Profit
5. Stop Loss
6. Safety
7. Advanced Execution
8. Review

### 11.2 Default presentation

- Source and Budget open by default.
- Take Profit and Stop Loss open after required basics are valid.
- Safety shows a concise summary and opens to detailed filters.
- Advanced Execution is collapsed by default.
- Use an info icon for every concept requiring explanation.
- Do not show paragraphs under every field.
- Show units inside controls.
- Display concise inline validation.

### 11.3 Sticky summary

Keep a compact desktop summary sidebar with:

- bot type
- source/strategy
- wallet
- buy amount
- maximum capital
- maximum open trades
- TP allocation
- SL
- slippage
- platform fee `2.00%`
- creator share note where applicable
- estimated maximum exposure
- validation status

On mobile, move the summary into a bottom sheet or review step rather than a permanent narrow sidebar.

### 11.4 Remove public internal messages

Remove or relocate phrases similar to:

- `Mainnet activation locked`
- `Automated activation requires controlled release approval`
- `No fallback fills`
- `Database reserves these limits`
- engine names and internal wallet implementation details

Normal users need clear action states, not architecture notes. Put operational details in Admin Console and logs.

---

## 12. Live withdrawals

User principal belongs to the user. Withdrawals must be self-service whenever funds are available and the system is operational.

### 12.1 Product rule

- No routine administrator approval for withdrawing available user principal.
- No per-user permission flag required to unlock ordinary withdrawals.
- No public `withdrawals unavailable`, `activation locked`, or `controlled release approval` state in a healthy production deployment.
- Keep an audited emergency circuit breaker only for security incidents, provider outages, or chain instability. It must not be the normal workflow.

### 12.2 Wallet-model audit

First determine the real wallet model:

- external non-custodial wallet
- embedded/user-owned wallet
- delegated automation wallet
- application-controlled custodial wallet

Do not present a fake withdrawal model. If funds are held in an application/delegated wallet, implement the full withdrawal path. If funds remain entirely in a connected external wallet, rename the action accurately and do not pretend there is an internal balance.

### 12.3 Withdrawal flow

For application/embedded wallet funds, implement:

1. User opens `Withdraw`.
2. Show available, allocated, and locked balances.
3. User enters destination address.
4. User enters SOL amount or selects 25%, 50%, 75%, or Max.
5. Validate address, balance, rent/fee reserve, locked position capital, pending withdrawals, and network.
6. Quote network/priority fee.
7. Show exact amount, fee, and destination.
8. Require explicit confirmation and step-up authentication where supported.
9. Create a durable withdrawal intent with idempotency key.
10. Sign through the approved secure wallet/signing service.
11. Submit once.
12. Store signature immediately.
13. Reconcile confirmation/finalization.
14. Update available balance and history transactionally.
15. Show pending, confirmed, or failed status with explorer link.

### 12.4 Availability

- Enable the Withdraw button whenever spendable balance is greater than the required network/rent reserve.
- If balance is zero, keep the action available but show a clear zero-balance validation rather than a feature-disabled message.
- If funds are locked in open positions, show exactly how much is locked and why.
- If a provider is temporarily unavailable, show a temporary operational error with retry—not an admin-permission message.

### 12.5 Safety

- No double submission.
- No withdrawal before authorization.
- No client-supplied balance trust.
- No plaintext keys.
- No success before chain confirmation policy.
- Reconcile submitted transactions after server restarts.
- Add velocity/risk controls that do not remove the user’s right to withdraw; suspicious activity may trigger step-up verification and security review, not silent confiscation.

### 12.6 Affiliate reward payouts

Affiliate/creator reward withdrawal remains separate from principal withdrawal and keeps the established rules:

- minimum request: `0.1 SOL`
- processing fee: `0.043 SOL`
- gross, fee, and net shown before confirmation
- ledger-backed states and on-chain reconciliation

Do not apply the affiliate minimum or processing fee to normal user principal withdrawals unless the business specification explicitly requires it.

---

## 13. Platform fee, creator shares, and referral rewards

Implement one coherent fee model. Do not calculate fee on network fees, do not double-charge creator fees, and do not use floating-point arithmetic.

### 13.1 Platform fee

The user-facing platform execution fee is:

```text
PLATFORM_FEE_BPS = 200
```

This means **2.00% of confirmed executed notional on each swap leg**.

Examples:

- Confirmed $100-equivalent buy: $2 platform fee.
- Later confirmed $100-equivalent sell: $2 platform fee.
- Total platform fee for that equal-notional round trip: $4, excluding Solana network/priority fees.

Apply only to successfully confirmed executed notional. No fee on:

- failed transaction
- expired quote
- rejected signal
- simulation
- dropped or reverted transaction
- duplicate signal
- unfilled amount
- deposit
- ordinary balance transfer unless separately and transparently defined
- Solana network or priority fee

Use basis points and integer token/lamport amounts with defined rounding.

### 13.2 Creator revenue share

To keep the public fee concise and prevent additive surprise fees, creator commissions are funded from the 2.00% platform fee unless an existing binding production rule explicitly requires a different model.

- Discord creator share: `70 bps` of executed notional.
- KOL creator share: `20 bps` of executed notional.

Therefore, for a Discord copied execution:

```text
user platform fee: 200 bps
Discord creator allocation: 70 bps
DegenAration gross retained before referral/other costs: 130 bps
```

For a KOL copied execution:

```text
user platform fee: 200 bps
KOL creator allocation: 20 bps
DegenAration gross retained before referral/other costs: 180 bps
```

Never charge the user `2.00% + 0.70%` or `2.00% + 0.20%` unless the UI and legal/business specification explicitly disclose an additive model. The preferred launch model is one clear 2.00% fee with internal revenue allocation.

### 13.3 Referral reward

Make referral rewards configurable in Admin Console and server configuration. If no existing rate is defined, use this launch default:

```text
REFERRAL_SHARE_BPS_OF_PLATFORM_FEE = 1000
```

This is **10% of the collected platform fee**, not 10% of trade volume.

Rules:

- reward only on confirmed eligible trades by a valid directly referred user
- reward is funded from the DegenAration-retained share, not added to the user fee
- no self-referral or linked-account reward
- no reward on creator’s own copy activity
- no reward before the platform fee is confirmed in the ledger
- reverse proportionally when a financial adjustment is required
- creator share + referral share + platform retained amount must exactly equal collected platform fee
- Admin Console may change future reward rates with versioned effective dates; historical trades keep their snapshot

### 13.4 Fee visibility

The normal interface should be clean and neutral:

- show `Platform fee 2.00%`
- use an info tooltip for creator/referral allocation details where relevant
- do not use defensive copy or dollar examples on every card

However, do **not hide money from users**. Before live bot activation and in transaction confirmations/receipts, show the applicable rate and exact estimated/actual amount, plus network/priority fees. Transparency is mandatory for a real-money product.

### 13.5 Ledger entries

For each execution, create balanced immutable entries for:

- user trade notional
- platform fee collected
- Discord or KOL creator payable
- referral payable when eligible
- DegenAration retained revenue
- network/priority fee
- reversals/adjustments

Store:

- basis-point configuration snapshot
- token and quote currency amounts
- price source
- executed amount
- rounding remainder policy
- creator/referrer identity snapshot
- transaction signature
- execution leg
- idempotency key

### 13.6 Admin revenue dashboard

Admin Console must show privately:

- gross 2% platform fees
- Discord creator allocations
- KOL creator allocations
- referral allocations
- DegenAration net retained revenue
- network costs where paid by platform
- pending, available, paid, reversed amounts
- daily/weekly/monthly volume and revenue
- per-source and per-strategy economics

Do not expose the owner’s private revenue dashboard to normal users.

---

## 14. Referral system and editable slug

Preserve and complete the earlier referral requirements.

### 14.1 Attribution

- Stable server-side referral relationship.
- Capture before sign-in and finalize after verified authentication.
- Do not trust client-submitted user IDs.
- Prevent self-referral, duplicate attribution, linked-account farming, and obvious abuse.
- Once valid attribution is established, do not silently overwrite it.
- Track invited users, qualified users, eligible trading volume, reward entries, reversals, and payouts.

### 14.2 Editable referral URL

Eligible approved affiliates may edit only the final slug.

Example:

```text
https://<canonical-domain>/r/jsdfnsdnfs
```

to:

```text
https://<canonical-domain>/r/degenaration
```

Rules:

- user edits only the slug, never the domain or route prefix
- lowercase normalized form
- allow safe letters, numbers, and hyphens
- minimum/maximum length
- unique case-insensitive index
- reserved-word list
- profanity/impersonation protection
- rate-limit changes
- preserve previous slugs as safe redirects when appropriate
- immutable audit history
- no ownership transfer through slug editing
- approval eligibility must be server verified

### 14.3 Reward display

Show clearly:

- referral link
- invited users
- qualified users
- eligible volume
- pending rewards
- available rewards
- paid rewards
- reward-rate info button
- recent reward events

Use real ledger data only.

---

## 15. Discord application command cleanup

Fix duplicate `/register` and make the command set purposeful.

### 15.1 Single command registry

Create one source of truth for command definitions and handlers.

- Do not independently register the same command in multiple files.
- Do not mix global and guild-scoped copies in production.
- Use environment-specific command deployment.
- Deployment must bulk-replace stale commands and remove duplicates.
- Add a uniqueness test and a post-deploy verification command.

### 15.2 Required command set

Keep only commands with a real product purpose. Adapt names to current behavior, but a sensible minimal set is:

#### `/register`

Purpose: begin or resume the current guild’s DegenAration source application.

- available only to guild owner or users with approved Manage Guild permission
- verifies guild and bot permissions
- creates/reuses one application record
- returns an ephemeral secure website link
- never creates duplicate guild applications

#### `/status`

Purpose: show integration health for the current guild.

- application state
- approved channels
- latest received call timestamp
- parser/scanner health summary
- actionable permission issues
- ephemeral response for privileged users

#### `/channels`

Purpose: list or configure approved/listening channels according to permission policy.

- no duplicate channel records
- validate bot read permissions
- direct user to website when complex changes are required

#### `/test-call`

Purpose: validate parsing and scanner readiness without executing a trade.

- privileged users only
- clearly marked test
- never submits a live swap
- returns parsed mint/filter result and correlation ID

#### `/help`

Purpose: concise command list and support link.

Do not add commands only to make the bot appear feature-rich. Remove obsolete, overlapping, unhandled, or undocumented commands.

### 15.3 Command quality

Every command requires:

- description
- permission policy
- DM/guild policy
- ephemeral/public response policy
- rate limit
- handler
- error response
- audit event where privileged
- integration test
- documentation in `docs/launch/DISCORD_COMMANDS.md`

---

## 16. Affiliate loading and runtime-state repair

The Affiliate page must never sit indefinitely on a spinner.

### Required async-state pattern

Every major request must have:

- skeleton matching final content
- bounded timeout
- empty state
- recoverable error state
- retry action
- stale-data fallback when safe
- correlation ID available in details/support view
- telemetry

Specific Affiliate requirements:

- load Discord creator, KOL creator, referral, and payout data independently
- one failing panel must not blank the entire page
- cache stable summaries but invalidate after trade/payout events
- show last updated time
- preserve last known data during transient failures with a stale indicator
- remove giant empty panels with centered spinners

Apply the same pattern to KOL marketplace, Portfolio, Admin Console, and source details.

---

## 17. Portfolio redesign and data integrity

Keep the existing Portfolio features but improve the hierarchy and data states.

### 17.1 Header metrics

Show compact cards or a unified metric strip for:

- total portfolio value
- available SOL
- allocated/locked SOL
- realized PnL
- unrealized PnL
- net PnL

Use real data, tabular numerals, and concise labels.

### 17.2 Performance chart

- 7D, 30D, 3M
- real reconciled equity series
- separate cash flows from trading return
- useful tooltip
- deposit/withdraw markers when appropriate
- intentional empty state
- no oversized blank chart panel

### 17.3 Tabs

- Overview
- Positions
- Trades
- Deposits & withdrawals

Each tab must have populated, loading, empty, error, and paginated states.

### 17.4 Wallet page

Reduce the text-heavy wallet screen.

Recommended structure:

- Deposit panel with QR, address, copy, and network warning
- Balance and automation limit panel
- concise automation-access status row with info drawer
- live swap only when it has a necessary purpose in the current product; otherwise remove it from the public wallet page and keep trading inside bots
- no giant paragraphs
- no internal engine labels
- clear revoke/manage automation access action

---

## 18. PnL cards and custom graphics

Preserve the earlier requirement for original winning, losing, and portfolio PnL cards.

- Use the existing DegenAration logo.
- Create original code/SVG/Canvas artwork.
- No copied WagieBot, Binance, TealStreet, or Mizar art.
- No generic emoji or clip art.
- Winning card: dark/gold with controlled emerald performance accents.
- Losing card: dark/gold with restrained crimson accents.
- Portfolio card: premium gold/black performance summary.
- Include referral URL/QR for eligible affiliates; canonical website URL otherwise.
- Generate data server-side from authoritative ledgers.
- High-resolution static export must be excellent.
- Animated preview may be subtle and optional.

Use the same visual language for small empty-state illustrations and product glyphs, but do not turn the application into an illustration-heavy landing page.

---

## 19. Admin Console changes

Keep Admin Console private to the verified admin role and add the operational tools required for launch.

### Required areas

- platform revenue and volume
- creator/referral liabilities
- withdrawals and reconciliation
- Discord application/source health
- signal/parser/scanner health
- KOL strategy health
- queue/worker/provider health
- command deployment status and duplicate check
- failed transactions and replay/reconcile actions
- emergency entry pause and withdrawal incident circuit breaker
- feature/config version history
- immutable audit log

The emergency withdrawal circuit breaker must be audited, visible only to admin, and used only for incidents. It must not create routine withdrawal approval work.

---

## 20. Implementation sequence

Follow this exact sequence to avoid wasting time and prevent visual work from hiding data defects.

### Phase 1 — one focused audit

Inspect:

- existing route/component structure
- current UI tokens and global styles
- Discord command registration paths
- source application and approved channel records
- raw Discord event ingestion
- signal parser and deduplication
- scanner adapters and market-data providers
- performance sampling/aggregation
- fee and commission ledger
- referral attribution/reward logic
- wallet and withdrawal implementation
- async query/error behavior
- production environment checks

Record concise findings in `docs/launch/RELEASE_CHECKLIST.md`. Do not stop for approval.

### Phase 2 — financial and withdrawal repair

- implement 200-bps platform fee
- allocate creator/referral shares
- add ledger invariants/migrations
- implement self-service user-principal withdrawals
- preserve affiliate payout rules
- add idempotency/reconciliation tests

### Phase 3 — signal and performance repair

- repair Discord/KOL journal
- backfill current approved sources where honest
- fix scanner/provider/worker defects
- update marketplace projections
- add admin diagnostics

### Phase 4 — Discord commands

- unify registry
- remove duplicate `/register`
- deploy exact command set
- add tests and verification

### Phase 5 — runtime-state repair

- fix Affiliate indefinite loading
- fix empty KOL and Portfolio behavior
- add timeout/error/retry/stale states

### Phase 6 — UI system

- semantic tokens
- global background
- icon system
- layout and component hierarchy
- concise copy and info drawers
- Discord card redesign without covers
- Bot, Affiliate, Portfolio, Wallet, Admin visual cleanup

### Phase 7 — visual and functional validation

- desktop/tablet/mobile screenshots
- populated/empty/loading/error states
- release tests
- security and ledger invariants
- final diff review

---

## 21. Database and migration requirements

Adapt existing tables instead of duplicating entities.

Required schema capabilities include:

- platform fee configuration versions
- execution fee snapshots
- creator revenue allocations
- referral revenue allocations
- immutable balanced ledger entries
- user withdrawal intents and executions
- raw source events
- normalized signals
- signal price samples
- signal outcomes
- source-period aggregates
- KOL-period aggregates
- Discord command deployment records
- worker/provider health events

Required constraints:

- unique idempotency keys
- unique Discord application command name per active scope/environment
- unique raw event source key
- unique signal/time-bucket sample
- nonnegative amounts
- valid basis-point ranges
- balanced ledger transaction invariant
- immutable historical fee configuration snapshot
- correct ownership and RLS
- UTC timestamps
- indexes for marketplace periods and latest status

Migrations must be forward-safe and preserve existing source, bot, trade, user, and ledger data.

---

## 22. Tests

Use the existing test stack. Add minimal justified dependencies only.

### 22.1 Fee tests

Test exact integer outcomes for:

- $100-equivalent buy at 200 bps
- $100-equivalent sell at 200 bps
- Discord creator 70-bps allocation from the 200-bps fee
- KOL creator 20-bps allocation from the 200-bps fee
- referral reward percentage of collected platform fee
- no referral
- creator + referral combination
- rounding at smallest units
- partial fill
- retry with same idempotency key
- failed/reverted transaction
- reversal
- ledger balance

### 22.2 Withdrawal tests

- available principal withdrawal
- zero balance
- amount above available
- locked capital
- invalid address
- duplicate submission
- provider failure
- signature stored before subsequent write failure
- reconciliation after restart
- non-owner authorization denial
- emergency incident pause
- affiliate payout remains separate

### 22.3 Performance-journal tests

- direct mint call
- supported link call
- embed call
- duplicate/cross-post
- message edit
- invalid mint
- unsupported venue
- baseline price capture
- provider outage/backfill
- sample deduplication
- +50%, 2x, 5x outcome
- maximum drawdown
- 1D/7D/30D aggregation
- cache refresh
- two existing approved sources project measured data

### 22.4 Discord command tests

- exactly one `/register`
- correct environment scope
- stale duplicates removed
- permission denial
- one application per guild
- `/status`
- `/channels`
- `/test-call` never trades
- `/help`
- handler errors

### 22.5 UI/browser tests

At minimum:

1. Header shows only Bots, Affiliate, Portfolio for a normal user.
2. No emoji icons exist in production UI.
3. Global background renders the approved subtle DegenAration pattern.
4. Discord cards have no fake cover banner and show the server PFP prominently.
5. Discord cards show real tracking/performance states.
6. KOL marketplace has working populated and empty states.
7. Affiliate cannot remain on an indefinite spinner.
8. Portfolio chart and histories have populated/empty/error states.
9. User with spendable balance can open and complete the withdrawal flow in isolated test infrastructure.
10. User does not encounter routine admin-approval or activation-lock copy.
11. Bot forms use progressive disclosure and info buttons.
12. Platform fee shows `2.00%`; exact amounts appear in confirmation/receipt.
13. Mobile retains fees, risk controls, and actions.
14. Admin revenue/scanner/withdrawal diagnostics remain inaccessible to normal users.

### 22.6 Visual regression evidence

Capture screenshots at approximately:

- 1440px or wider desktop
- 1024px tablet
- 390px mobile

Capture:

- Bots overview
- Discord marketplace populated with two current sources
- Discord source details
- Discord bot form and review
- KOL marketplace populated and empty
- KOL builder
- My Bots
- Affiliate tabs
- Portfolio populated and empty
- Withdrawal modal and progress
- Wallet
- winning/losing/portfolio PnL cards
- Admin scanner/revenue/withdrawal diagnostics

Store under the repository’s established artifact directory and index them in `docs/launch/RELEASE_EVIDENCE.md`.

---

## 23. Forbidden public UI content

Remove or rewrite public strings that communicate internal implementation rather than user value. Examples include:

- immutable accounting implementation claims
- controlled release approval
- activation locked
- no fallback fills
- database reserves
- engine not configured
- provider names unless necessary for a transaction or error
- developer-oriented explanations of reconciliation or workers
- repeated risk essays under controls

Do not hide meaningful risk, fees, transaction status, or errors. Translate them into concise user language and put technical details behind an info/support detail view.

Also prohibit:

- emoji icons
- Lorem Ipsum
- fake call history
- fake gains
- random decorative letters
- repeated geometric covers
- unexplained abbreviations
- buttons without handlers
- permanent spinners
- disabled withdrawal in a healthy public launch

---

## 24. Release gates

Do not report completion until all applicable checks pass:

- clean dependency install
- formatting
- lint
- strict typecheck
- unit tests
- integration tests
- end-to-end browser tests
- production build with validation enabled
- migration dry run
- RLS/authorization tests
- financial ledger invariant checks
- withdrawal idempotency/reconciliation tests
- Discord command uniqueness check
- Discord/KOL performance-journal verification
- scanner adapter tests
- no secret leakage
- no release-blocking dependency vulnerability without mitigation
- no indefinite loading state
- no duplicate `/register`
- no fake Discord cover banners
- no emoji icons in production UI
- no public activation-lock/controlled-release text
- desktop/tablet/mobile visual review
- accessibility smoke test

For missing external production credentials, implement and test everything possible, then mark the exact gate `BLOCKED` with the required action. Do not falsely mark it passed.

---

## 25. Acceptance criteria

The remediation is complete only when all statements below are true.

### Visual quality

- The global background has subtle original DegenAration depth and no flat unfinished appearance.
- The UI uses a coherent design system and icon language.
- No generic emojis or AI-style random artwork remain.
- Discord listings use the real server PFP prominently and no fake cover photo.
- Primary pages are concise and comfortable for beginners.
- Detailed guidance is available through info buttons rather than repeated paragraphs.
- Desktop, tablet, and mobile layouts are polished.

### Withdrawals

- Users can withdraw spendable principal without routine admin approval.
- The flow is secure, idempotent, reconciled, and visible in history.
- Locked funds and temporary provider failures are explained accurately.
- Affiliate reward payout rules remain separate.

### Fees and rewards

- Every confirmed swap leg charges exactly 200 bps according to the defined basis.
- Discord creator receives 70 bps from the platform fee on eligible Discord copied executions.
- KOL creator receives 20 bps from the platform fee on eligible KOL copied executions.
- Referral rewards are paid from platform revenue according to the configured rate.
- The ledger balances exactly.
- The normal UI states `2.00% platform fee` without defensive marketing copy.
- Confirmation and receipts transparently show exact amounts.

### Discord/KOL performance

- The two existing approved Discord sources are publicly visible with proper avatars.
- New eligible calls are durably journaled.
- Historical data is backfilled where reliable.
- Marketplace cards show actual measured counts/statuses instead of permanent zero/dashes.
- 1D/7D/30D aggregates update correctly.
- KOL strategy status and net performance are visible and accurate.
- Scanner and provider failures are diagnosable in Admin Console.

### Discord commands

- `/register` exists exactly once.
- Every published command has a purpose, handler, permission rule, test, and documentation.
- Stale or duplicate commands are removed from Discord.

### Runtime behavior

- Affiliate does not remain indefinitely loading.
- Empty and error states are clear and actionable.
- No visible control is decorative or nonfunctional.
- No user-facing screen exposes unnecessary internal engineering details.

---

## 26. Final response format

After implementation, return one concise evidence-based report containing:

1. Confirmed root causes
2. What was changed
3. UI/design-system files changed
4. Financial/withdrawal migrations and logic changed
5. Performance-journal/scanner repairs
6. Discord command cleanup
7. Exact validation commands and results
8. Browser flows verified
9. Screenshot evidence paths
10. External blockers, if any
11. Remaining non-release-blocking limitations
12. Claude/Codex coordination summary: branch, verified commits, Codex findings resolved or pending, and whether Codex review was unavailable
13. Readiness status: `NOT READY`, `READY FOR STAGING`, or `READY FOR CONTROLLED MAINNET REVIEW`

Do not fill the final message with implementation commentary. Do not claim perfection without evidence.

---

## 26A. Claude Code run mode

Execute this as one normal Claude Code implementation task. Do not use a looping skill, do not repeatedly ask for permission to continue, and do not stop after producing a plan. Keep the user-facing progress messages concise.

Use Claude's subagents only for focused independent review, not to duplicate the main implementation. Use Codex only after a committed checkpoint is ready for review. If Codex usage is exhausted, continue without waiting and record `Codex review unavailable due to usage limit` in the coordination report.

Do not use `--dangerously-skip-permissions`. Request approval for genuinely sensitive operations. Never provide or request a funded production wallet seed/private key. Automated tests must not spend mainnet funds.

---

## 27. Begin

Begin from the repository root now.

1. Read `CLAUDE.md`, `AGENTS.md`, the canonical launch specification, and the coordination files.
2. Perform one focused audit against the confirmed defects in this prompt.
3. Create/update the required Claude subagents, repository skills, coordination files, and launch documents.
4. Implement financial and withdrawal correctness first.
5. Repair Discord/KOL performance journaling and scanner reliability.
6. Remove duplicate Discord commands.
7. Fix indefinite loading and runtime states.
8. Apply the senior DegenAration UI system and concise copy.
9. Run all release gates and capture evidence.
10. Report only verified results.
