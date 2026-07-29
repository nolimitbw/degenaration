# DegenAration Repository Instructions

DegenAration is an automated Solana trading product. It can affect real money.

> **Two agents share this repo: Codex and Claude.** This file (`AGENTS.md`) and
> `docs/DEGENARATION_MASTER_SPEC.md` are the single source of truth for BOTH. Claude's
> `CLAUDE.md` defers to them. Before editing, check `git status`/`git diff` for the other
> agent's uncommitted work and never revert or reformat changes you did not make.

Correctness, authorization, financial integrity, reconciliation, and honest product
states take priority over development speed, convenience, animation, or visual polish.

## Authority and Priority Order

The authoritative product specification is:

* `docs/DEGENARATION_MASTER_SPEC.md`

Read it completely before modifying code.

Review every attached video, image, and functional reference identified by the master
specification before making broad product or UI changes.

When requirements appear to conflict, apply this priority order:

1. Security and authorization
2. Financial correctness and reconciliation
3. The master specification
4. Persisted system-of-record data
5. Existing verified product behavior
6. Tests and browser evidence
7. Visual references
8. Visual polish and implementation convenience

Never silently resolve a conflict in favor of a less secure, less accurate, or less
honest implementation.

Ask the owner only when the decision requires:

* a secret or credential only the owner can provide
* an irreversible product decision
* authorization to enable real-money mainnet execution
* resolution of a material contradiction in the master specification

For reversible implementation decisions, choose the safest reasonable option,
document the decision, and proceed.

## Required Workflow

For every non-trivial task:

1. Read the relevant specification sections, implementation, schema, tests, services,
   components, and design tokens.
2. Inspect the current behavior before editing it.
3. Write a concise implementation plan with affected files and acceptance criteria.
4. Proceed without routine approval.
5. Make focused changes that reuse existing services, contracts, and components.
6. Run targeted checks while developing.
7. Exercise every changed browser flow.
8. Review rendered screenshots at required viewport sizes.
9. Review the final diff for dead code, unrelated churn, unsafe claims, debug output,
   exposed data, secrets, and unverified assumptions.
10. Run `npm run check`.
11. Update required implementation, reference-coverage, and release records.
12. Report only behavior supported by code, tests, browser evidence, authorization,
    and persisted data evidence as applicable.

Do not claim that work is complete based only on source-code inspection.

Do not report tests, commands, browser flows, database checks, deployments, or
screenshots that were not actually completed.

## Change Scope

* Keep changes focused on the requested behavior.
* Do not perform unrelated visual redesigns, architecture rewrites, dependency
  migrations, or formatting churn.
* Preserve working repository patterns unless there is a documented correctness,
  security, performance, or maintainability reason to change them.
* Do not replace functioning systems with mock implementations.
* Do not remove incomplete functionality merely to make a screen appear finished.
* Do not hide errors, unavailable states, or unsupported functionality behind
  optimistic UI.

## Non-Negotiable Product Requirements

* Preserve the approved DegenAration logo and gold, white, and dim-black branding.
* Treat attached media as binding functional and visual references.
* Maintain `docs/degenaration-reference-coverage.md` with source timestamps,
  implemented components, affected routes, and screenshot evidence.
* Normal users may see only Bots, Affiliate, and Portfolio in product navigation.
* Admin access must be verified and enforced server-side.
* Never trust a client-provided email, role, wallet metadata field, query parameter,
  cookie value, local storage value, or client state as authorization evidence.
* Never execute mainnet transactions during development or automated testing.
* Never expose secrets, private keys, seed phrases, signing material, OAuth secrets,
  service-role keys, database credentials, or production credentials.
* Never weaken strict type checking, tests, authorization, database security,
  transaction confirmation, reconciliation, or accounting rules to obtain a passing
  build.
* Every visible control must:

  * perform a working action using authorized and persisted data
  * be clearly disabled with an exact technical reason
  * or be protected by a documented feature flag
* Use integer or decimal-safe accounting for SOL, tokens, fees, commissions, payouts,
  balances, limits, and PnL.
* Never use JavaScript floating-point arithmetic for ledger or settlement math.
* Financial history is immutable.
* Archive financially relevant records instead of hard-deleting them.
* Do not claim unsupported scanner venue coverage, transaction completion, balances,
  performance, profitability, execution quality, or mainnet readiness.
* Maintain `IMPLEMENTATION_STATUS.md` with `PASS`, `PARTIAL`, `FAIL`, and `BLOCKED`
  requirements.
* Run the mandatory independent final audit defined in the master specification
  before reporting overall completion.

## Authorization and Data Security

* Perform authorization checks at the server boundary for every privileged operation.
* Apply authorization independently of whether the client hides or disables a
  control.
* Return only the minimum data required for the current user and action.
* Do not expose internal records merely because their identifiers are difficult to
  guess.
* Validate ownership and access for all user-addressable resources.
* Use structured parsers and typed contracts at every trust boundary.
* Validate all external provider responses before storing or acting on them.
* Fail closed when identity, role, ownership, execution state, or financial state
  cannot be verified.
* Use correlation IDs for privileged, financial, and asynchronous operations.
* Log sufficient information for reconciliation without logging secrets or signing
  material.
* Browser clients must never receive a Supabase service-role key.

Authorization-sensitive changes require positive and negative tests, including:

* authorized access succeeds
* unauthorized access fails
* cross-user access fails
* altered client role or wallet metadata does not grant access
* missing identity fails closed
* direct API access cannot bypass UI restrictions

## Financial and Execution Safety

Automated execution requires:

1. A durable execution intent
2. An idempotent claim
3. Reserved limits or balances
4. A submitted transaction signature
5. Confirmation tracking
6. Reconciliation
7. A terminal success, failure, cancellation, or unresolved state

Never represent submission as confirmation.

Never represent confirmation as successful reconciliation.

Never report a balance, fill, fee, payout, commission, or PnL value unless its source
and accounting state are known.

Execution, confirmation, and reconciliation paths must tolerate:

* retries
* duplicate delivery
* delayed provider responses
* process restarts
* partial failures
* stale data
* missing confirmations
* conflicting provider states

`paper` and `solana-devnet` are the development execution modes.

`solana-mainnet` remains gated until controlled review and explicit owner
authorization.

## Architecture Boundaries

* Next.js App Router and TypeScript live in `app/`, `components/`, and `lib/`.
* Privy is the primary user identity and wallet provider.
* Supabase Postgres is the durable system of record.
* `app-bridge` and `bot-bridge` expose allowlisted operations only.
* The Discord gateway and automation worker are separate long-running services.
* Provider-specific market and scanner responses terminate in server-side adapters.
* Browser components must not call untrusted providers directly when a server-side
  adapter is required.
* Do not move privileged logic into client components.
* Do not duplicate financial or authorization rules across multiple layers when a
  shared server-side contract should own them.

## Product Design Direction

Build a compact, premium, data-first trading workspace.

The product must feel intentionally designed for active use. It must not resemble a
generic AI-generated landing page, template dashboard, or decorative cryptocurrency
concept.

Prioritize:

1. Information hierarchy
2. Data clarity
3. Stable layout
4. Fast task completion
5. Financial-state honesty
6. Accessibility
7. Visual refinement

Visual decoration must never make financial or execution states harder to understand.

## Design System Rules

* Preserve the approved gold, white, and dim-black identity.
* Use semantic design tokens rather than scattered arbitrary values.
* Gold is an accent, not a page wash or universal background.
* Use restrained borders, shadows, and surface elevation.
* Keep card radii at 8px or less.
* Do not nest decorative cards.
* Use consistent spacing, typography, control heights, and grid dimensions.
* Prefer clear alignment and spacing over decorative containers.
* Keep content density appropriate for a professional trading interface.
* Use stable dimensions so live or asynchronous data does not cause avoidable layout
  shifts.
* Reserve strong emphasis for genuinely important actions, warnings, and financial
  states.
* Do not make every section visually equal.
* Use visual hierarchy to distinguish primary tasks, supporting information, and
  metadata.
* Mobile layouts must be deliberately composed rather than produced by blindly
  stacking desktop columns.

## Prohibited AI-Generated Visual Patterns

Do not introduce any of the following unless they are explicitly required by an
approved reference:

* purple, blue, or multicolor gradient page backgrounds
* gold gradient page washes
* glowing blurred circles or decorative light blobs
* excessive glassmorphism
* gradient text used as decoration
* fully rounded pill controls everywhere
* excessive rounded cards
* cards inside cards without a structural reason
* identical three-column feature-card grids
* generic icon, heading, and paragraph card collections
* oversized marketing hero sections inside the authenticated application
* centered text across every section
* decorative charts with fabricated or meaningless data
* fake activity feeds
* decorative statistics without persisted data
* floating cryptocurrency symbols
* random sparkles, glowing borders, or excessive ambient animation
* emojis used as product-interface icons
* large empty areas introduced only to make the interface appear premium
* generic copy such as “Unlock your potential” or “Revolutionize your trading”

Do not solve weak hierarchy by adding more cards, backgrounds, gradients, badges, or
shadows.

## Typography and Content

* Use a restrained and consistent typography scale.
* Maintain clear differences between page titles, section headings, labels, values,
  helper text, and metadata.
* Avoid oversized headings inside operational screens.
* Use tabular numerals where financial values need stable alignment.
* Keep labels concise and technically accurate.
* Use specific, believable product language.
* Do not fabricate balances, performance, calls, trades, coverage, users, volume,
  revenue, testimonials, rankings, or integrations.
* Do not present placeholder data as live data.
* Clearly label demonstration, simulated, paper, stale, unavailable, delayed, and
  devnet data.
* Do not repeat the same concept in a heading, description, badge, and button.

## Buttons and Interactive Controls

Every visible control must have a defined purpose.

For every changed button, link, menu item, tab, form, toggle, modal, and table action,
verify:

* authorized behavior
* persisted-data behavior where applicable
* destination or handler
* loading behavior
* disabled behavior
* success behavior
* failure behavior
* keyboard behavior
* mobile behavior
* stale-data behavior where applicable

Button labels must describe the action precisely.

Prefer labels such as:

* `Create bot`
* `Pause bot`
* `View transaction`
* `Copy wallet address`
* `Request payout`

Avoid vague labels such as:

* `Continue`
* `Explore`
* `Discover`
* `Get started`

unless the destination and context make the action unambiguous.

Additional rules:

* Use primary actions sparingly.
* Do not use pill-shaped buttons by default.
* Do not use gradients inside buttons unless an approved reference requires them.
* Provide hover, active, focus-visible, loading, and disabled states.
* Maintain a minimum 44px touch target.
* Do not use a clickable `div` when a semantic button or link is appropriate.
* A disabled financial action must explain the exact blocking condition.
* Never make an unavailable action appear successful or ready.

## Icons and Tooltips

* Use Lucide icons for familiar actions.
* Do not mix unrelated icon libraries without a documented reason.
* Icons must not be the only indication of a financial or destructive state.
* Provide accessible names for icon-only controls.
* Provide accessible tooltips for unfamiliar icon actions.
* Tooltips must explain the action rather than restating the icon name.

## Required Product States

Provide deliberate states for applicable screens and components:

* initial loading
* incremental loading
* empty
* stale
* delayed
* unavailable
* unauthorized
* disabled
* validation error
* provider error
* database error
* partial completion
* success
* unresolved execution
* reconciled terminal state

Do not use an infinite spinner for terminal failures.

Do not show an empty state when data failed to load.

Do not collapse stale, unavailable, delayed, failed, and empty into the same visual
state.

## Responsive and Accessibility Requirements

Verify layouts at:

* 375px
* 768px
* 1024px
* 1440px

Inspect each required viewport for:

* horizontal overflow
* clipped content
* overlapping controls
* broken navigation
* unreadable financial tables
* unstable layout shifts
* awkward text wrapping
* excessive empty space
* cramped actions
* poor modal dimensions
* hidden status information
* inaccessible hover-only behavior

Accessibility requirements:

* Use semantic HTML.
* Support keyboard navigation.
* Provide visible focus states.
* Preserve logical focus order.
* Use accessible labels and names.
* Maintain sufficient contrast.
* Respect `prefers-reduced-motion`.
* Ensure dialogs manage focus and close with Escape.
* Ensure menus and popovers are keyboard-operable.
* Do not communicate financial status through color alone.

## Visual Implementation Workflow

Before broad UI changes:

1. Inspect the current rendered route.
2. Review applicable media references.
3. Inventory existing components and design tokens.
4. Identify the exact visual problems being solved.
5. Define the intended information hierarchy.
6. Define acceptance criteria before coding.

After UI changes:

1. Start the application.
2. Exercise the changed flow with realistic authorized states.
3. Capture screenshots at all required viewport sizes.
4. Review the screenshots rather than judging only from JSX or CSS.
5. Compare the output with the approved references.
6. Record concrete defects.
7. Fix high-severity defects.
8. Repeat browser verification.
9. Update `docs/degenaration-reference-coverage.md`.

Screenshot evidence must identify:

* route
* viewport
* user or authorization state
* product state
* execution mode where relevant
* timestamp
* evidence file location
* known limitation, if any

Do not report a visual match merely because the same colors or components were used.

## Browser Flow Verification

Browser verification must accompany all user-visible UI work.

Test every changed path from entry to terminal state, including applicable:

* normal success
* validation failure
* unauthorized access
* unavailable provider
* empty data
* stale data
* loading state
* disabled state
* server failure
* retry
* mobile navigation
* keyboard interaction

Check the browser console for:

* runtime errors
* hydration errors
* failed requests
* accessibility warnings
* repeated requests
* leaked sensitive data

A control is not considered functional because it changes local component state.

It is functional only when it completes its intended authorized behavior, persists or
retrieves the correct data where applicable, handles failure honestly, and presents
the correct resulting state.

## Code Quality

* Prefer concise solutions and existing repository patterns.
* Use strict TypeScript.
* Use structured parsers and typed contracts at trust boundaries.
* Avoid unsafe casts that bypass contract validation.
* Do not add an external dependency unless the existing stack cannot reasonably solve
  the requirement.
* Pin dependency versions and commit lockfile changes when a dependency is required.
* Keep comments to one sentence and only for non-obvious behavior.
* Remove temporary logs, test hooks, bypasses, and debug UI before completion.
* Do not expose data beyond the minimum required for the current user and action.
* Keep API lists bounded and cursor-paginated when they can grow.
* Use UTC timestamps.
* Use correlation IDs for privileged or asynchronous operations.
* Keep server-only modules out of client bundles.
* Do not weaken linting, type checking, tests, or compiler configuration.
* Do not suppress errors without addressing their cause.

## Database Requirements

Supabase Postgres is the durable system of record.

Database changes require:

* a reviewed migration
* explicit authorization and RLS consideration
* a test query
* verification against realistic data states
* Supabase security advisor review
* Supabase performance advisor review
* rollback or forward-repair guidance
* confirmation that browser clients do not require service-role access

Financially relevant migrations must preserve history and support reconciliation.

Do not hard-delete financially relevant data.

Do not rely on client filtering as a substitute for database or server authorization.

## Verification Commands

Run applicable targeted tests while developing.

Before reporting completion, run:

```bash
npm run typecheck
npm run test
npm run build
npm run check
```

Do not skip a failing command merely because another command passes.

Do not modify scripts, tests, type rules, or build settings solely to hide a failure.

When a required command cannot run, report:

* the exact command
* the exact blocking reason
* the portion of work that remains unverified
* whether the limitation affects safety or release readiness

## Definition of Done

Work is complete only when all applicable conditions are satisfied:

* The implementation follows the master specification.
* Authorization is enforced server-side.
* Financial calculations use safe accounting.
* Persisted data reflects the intended behavior.
* All changed controls function end to end.
* Required loading, empty, disabled, stale, success, and failure states exist.
* Browser verification was completed at required viewport sizes.
* Relevant screenshots were reviewed and recorded.
* Targeted tests pass.
* `npm run check` passes.
* No secrets or sensitive data were exposed.
* No unsupported product or financial claims were introduced.
* `IMPLEMENTATION_STATUS.md` is accurate.
* `docs/degenaration-reference-coverage.md` is current.
* The independent final audit was completed when required.
* Known limitations and blockers are reported honestly.

## Version Control and Existing Work

* The worktree may contain user changes.
* Never revert, overwrite, reformat, or remove changes you did not make.
* Review the existing diff before editing.
* Keep commits focused and atomic after significant verified changes.
* Do not commit `docs/activity-log.md` or unrelated planning documents.
* Do not push or deploy unless the user explicitly requests it.
* Never use destructive Git commands unless the user explicitly asks.
* Do not force-push.
* Do not rewrite history.
* Do not discard untracked files.
* Do not use broad reset, clean, checkout, or restore operations against user work.

## Activity and Release Records

* Write concise progress notes to `docs/activity-log.md` when useful.
* Do not auto-commit `docs/activity-log.md`.
* Markdown filenames use kebab-case except:

  * `docs/DEGENARATION_MASTER_SPEC.md`
  * `IMPLEMENTATION_STATUS.md`
* Maintain `docs/degenaration-release.md` with:

  * verification commands
  * browser checks
  * database checks
  * deployments
  * known blockers
  * unresolved risks
  * rollback or forward-repair guidance
* Release records must distinguish verified behavior from planned or blocked behavior.
