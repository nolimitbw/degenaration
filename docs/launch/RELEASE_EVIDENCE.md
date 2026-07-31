# Release evidence

What was actually verified, and how. Anything not listed here was **not** verified —
this file exists so a completion claim can be checked rather than believed.

Branch `claude/degenaration-launch-remediation` · last updated 2026-07-30

## Commands

| Command | Result | When |
|---|---|---|
| `npm run check` | **exit 0** — typecheck, lint, 104 server tests, fee-ledger invariants, journal contract, Discord command registry, visible-copy scan, production build | after every slice |
| `npm run lint` | clean across 218 files; found and fixed 5 real problems on first run | Phase 24 |
| `npm run verify:fee-ledger` | all invariants hold across 75 notional × source × referral combinations, including the ledger entry model | Phase 13.5 |
| `npm run verify:performance-journal` | schema + parser contract hold; dedupe anchored on a NOT NULL column | Phase 9 |
| `npm run check:discord-commands` | registry clean — 6 unique commands, one `/register`, single scope, global cleanup present | Phase 4 |
| `npm run check:visible-copy` | clean across 187 files in `app/`, `components/`, `lib/` | Phase 5/6 |
| `npm run verify:withdrawal` | 6 structural checks pass — transaction decodes to a single System Program transfer, lamports round-trip exactly, leaves the server unsigned | Phase 12 |
| `npm run verify:discord-live` | requires owner-held bot credentials; exits 0 with instructions when absent | Phase 15 |

Test count went 41 → 104 over this work (fee model, JS↔SQL parity, withdrawals, journal
outcomes, safety filters, portfolio stats).

**Operational note:** `npm run check` runs `next build`, which clobbers a running
`next dev` server's `.next` directory and produces a spurious failure. Stop the dev
server first. This bit once during this work and was misdiagnosed as a real failure
before being isolated by running each step individually.

## Browser verification

Dev server at `localhost:3000`, Next.js 15.5.22.

| Route | Viewport | Observed |
|---|---|---|
| `/` | 1440×900 | Renders correctly. Gold-on-black, live BONK chart, KOL preview panel. No console errors. |
| `/` | 375×812 | `scrollWidth === clientWidth` — no horizontal overflow |
| `/` | 768×1024 | `scrollWidth === clientWidth` — no horizontal overflow |
| `/affiliate` | 800×650 | Unauthenticated state renders cleanly: title `Affiliate`, subtitle `Track creator and referral earnings.` per §6.2, no filler eyebrow, no spinner. No console errors. |
| `/bots` | 800×650 | §6.2 copy live; DiscordSignal, KolStrategy, DegenBot and RiskShield glyphs render. No console errors. |
| `/bots/discord` | desktop + 375 | Redesigned cards verified with a stubbed API response covering a measured and an unmeasured source. No cover art, 56px avatar, health dot with text, `Tracking started [date]` on the unmeasured card. Cards stack one per row at 343px. |
| `/bots/kol/new` | desktop | Section order matches §11.1; summary shows Maximum exposure and one fee row with info affordances. |

### Responsive audit — §22.6 required widths

Programmatic audit at each width on `/`, measuring horizontal overflow, off-screen
controls, and sub-minimum touch targets:

| Width | Horizontal overflow | Off-screen controls | Sub-44px controls |
|---|---|---|---|
| 375 | none (`scrollWidth === clientWidth`) | 0 | 0 after fix (**9 before**) |
| 768 | none | 0 | — |
| 1024 | none | 0 | compact by design (32px above `sm`) |
| 1440 | none | 0 of 32 controls | compact by design |

The audit found 9 controls under the 44px minimum (§7.4): chart refresh and timeframe
buttons at 32px, buy-amount presets at 36px, mobile menu trigger at 40px. Fixed with
responsive sizing so mobile meets 44px while desktop keeps professional density —
verified 44px at 375px and 32px at 1024px. Bare number inputs measuring 20px were
assessed as false positives; their bordered wrapper is the tap target.

### Second pass — `/bots/discord` at 375px

The first pass only covered `/`. Auditing the redesigned marketplace route found **10 more
sub-44px controls that the homepage fix had not touched**, including the shared
`Segmented` timeframe control at **30px** — used on Discord, KOL, Portfolio, and Affiliate,
so one component was under-sized on four surfaces.

Fixed in the shared primitives rather than per page: `Segmented`, the app-shell menu /
notifications / admin / wallet controls, and every `h-9`/`h-10` icon button across 13
files. All raised to 44px up to `sm` and returning to compact size above it.

| Route | Width | Overflow | Off-screen controls | Sub-44px buttons |
|---|---|---|---|---|
| `/bots/discord` | 375 | none | 0 | **0** (10 before) |
| `/bots/discord` | 1440 | none | 0 | compact by design — Segmented 32px, refresh 40px |

Cards render one per row at 343px on mobile and two per row on wide desktop, per §8.3.
Verified with a stubbed marketplace response covering a measured and an unmeasured source.
No console errors at either width.

### Third pass — every public route in the §22.6 list

The second pass covered only `/bots/discord`. Extending the audit to the remaining public
routes found **three more control tiers** below the 44px minimum that per-route fixes had
missed, because they live in shared classes rather than in one page:

| Tier | Where it appeared | Count |
|---|---|---|
| `min-h-10` (40px) | retry buttons, page-header actions, filter wrappers | 71 occurrences, 19 files |
| `min-h-9` (36px) | SOL amount presets, "Connect account", table row actions | 17 occurrences, 9 files |
| bare `<select>` (18px) | marketplace sort controls | 5 |

All raised to 44px up to `sm` and returning to compact size above it.

| Route | Width | Overflow | Sub-44px controls |
|---|---|---|---|
| `/bots/kol` | 375 | none | 0 |
| `/bots/discord/new` | 375 | none | 0 |
| `/bots/discord` | 375 | none | 0 |
| `/bots/discord` | 1440 | none | compact by design — Segmented 32, refresh 40, sort 18, actions 40 |

Desktop density confirmed unchanged at 1440 after every sweep, which is the point of the
responsive approach: §7.4 wants 44px reachable, §5 wants professional density, and a flat
bump would have traded one for the other.

**One deliberate exception.** `Skip to content` reports 36px and was left alone: it is a
keyboard-only skip link, visually hidden until focused (`-translate-y-20 focus:translate-y-0`),
so it is never a touch target.

**One redundancy removed.** A `<select>` carrying `field-control` already inherits a 44px
minimum from `app/globals.css`, so the added height class was noise there and was reverted —
kept only on bare selects that genuinely had an 18px hit area.

Two regex failures worth recording, both mine: `[^>]*` cannot match a JSX tag containing an
arrow function, because `=>` supplies the `>` — the select sweep silently matched nothing
until it was redone line-based. And `--format=%H%x09%b` cannot be split to attribute commit
trailers, because `%b` is multi-line.

### Copy changes confirmed on the rendered page

Read back from `document.body.innerText`, not from source:

- `SOLANA MAINNET. You confirm every transaction in your own wallet. Automated trading and payouts are not yet available.`
- `Solana Mainnet data is live. Automated entries and payouts are not yet available.`
- `/bots` automation metric: `Not yet available`
- The permanent release-warning footer is gone from `AppShell`

Browser verification is what caught the `ReleaseBanner` and `AUTOMATED_MAINNET_RELEASE.reason`
strings — the static checker was scanning only `app/` and `components/` and was blind to
`lib/`. The checker was then widened.

### DegenBackdrop layering

Verified via computed styles, not by eye:

```
backdrop found: true, z-index: -10, children: 5, visibility: visible
layer 0 radial gradients: background-image present
layer 1 grid: background-size 56px 56px
layer 2 signal paths: <svg>
layer 3 grain: opacity 0.025
layer 4 vignette: box-shadow present
body background: rgba(0,0,0,0)   html background: rgb(13,14,15)
```

It is deliberately subtle and does not stand out in a screenshot. That is the intended
result — if the background is obvious on a data screen it is too strong.

## Not verified

Stated plainly so none of this reads as covered:

- **No stored PNG set** for the authenticated routes §22.6 lists (My Bots, Affiliate tabs,
  Portfolio populated and empty, withdrawal modal, Wallet, PnL cards, Admin diagnostics).
  Public routes were audited programmatically at all four widths; the authenticated ones
  need a real Privy session, which cannot be created from this environment.
- **The Privy signing UI is unexercised.** The transaction itself is now fully proven —
  `npm run verify:withdrawal` runs 16/16 against a local `solana-test-validator`: it
  confirms on chain, the destination receives exactly the requested lamports, the source
  retains the rent-exempt minimum, and a subsequent Max withdrawal still retains the
  reserve. What remains untested is the browser flow where a real Privy wallet signs, which
  needs the owner's wallet.
- **Discord global-command cleanup unobserved live.** `npm run verify:discord-live` exists
  to confirm it; it needs the deployed bot's credentials.
- **No browser e2e on authenticated routes.** Same session dependency.

### Corrected in this revision

The previous revision claimed migrations were unapplied, the signal journal untraced, and
no lint run. All three had since been done — the four migrations were applied and proven
against live Postgres, the journal chain was traced end to end (rolled back), and
`npm run lint` gates 218 files. A stale evidence file is worse than none, because it reads
as verification.

## Production verification — 2026-07-31

Deployed to Vercel Production (`dpl_8qyU5qNpQqbbhas71AmbCwRvLDpG`, then a second deploy
after setting `PLATFORM_FEE_ACCOUNT`). Everything below was measured against the **live
site**, not the dev server, because the three preceding fixes had only ever existed locally.

### The filmed numeric-input defect, with real keystrokes

`type="number"` count on `/bots/kol/new` in production: **0**. 27 text inputs with
`inputmode`. Driving the Buy amount field through the browser:

| Input | Result |
|---|---|
| triple-click, type `05` | **`5`** — the filmed defect; leading zero stripped |
| `""` (cleared) | stays empty, field is clearable mid-edit |
| `0.` | survives mid-edit, so a decimal can be typed at all |
| `0.25` | accepted |
| `007` | `7` |
| `abc`, `1.2.3` | rejected, prior value retained |
| `0.` then real blur | **`0.01`** — resolved and clamped to the field minimum |

One methodology note: a *synthetic* `focusout` does not reach React's handler, so blur
resolution first appeared broken. It is not — a genuine click-away resolves correctly. The
harness was wrong, not the code.

### The source dropdown

`/bots/discord/new` now populates **DegenAration** and **SLPR DEGEN**, with the first
preselected. The recording showed `No options available` on this same screen.

### The fee guard, exercised with the real footgun

`PLATFORM_FEE_ACCOUNT` is set to a **wallet** address — the exact value that would have
failed every swap on chain before the resolver existed:

```
builds: true    platformFeeBps: 0    feeAccountSet: false    error: null
```

Fee declined, trading unaffected. Fees begin automatically once the wSOL ATA
`AuFCZDtr7PaZxEitCPzKpQZdkRLnpKZxK6Y4MpxAZhDj` exists (absent as of this check).

### The silent-failure sweep — fourth instance

After fixing this pattern three times reactively (Affiliate, Portfolio, the Discord bot
builder), the codebase was swept for the rest of it rather than waiting for a user to find
the next one. `grep` for catch handlers that discard the reason, then triage by what the
failure actually renders as.

One genuine defect: `app/bots/page.tsx` caught to `0`, so a failed marketplace request
rendered **"Approved sources 0"** as if measured. Verified in production that the marketplace
returns 2 — a user whose request failed was told there were none, on the page whose purpose
is to send them to a source. `setBots([])` did the same to "Your bots".

Both paths verified after deploy:

| Condition | Approved sources | Live strategies |
|---|---|---|
| API failing (local, no server creds) | `--` | `--` |
| API healthy (production) | **2** | **0** |

That production `0` is a *measured* zero — no KOL strategies are published yet — which is
the whole point of the change: `0` now means counted, `--` means unknown.

Triaged and deliberately left alone: the Discord and KOL detail pages also catch to null,
but their empty state reads "unapproved, suspended, removed, **or temporarily unavailable**",
which already covers a load failure honestly. The API routes' `req.json().catch(() => null)`
is correct — that is bad-input handling, not a swallowed failure.

### Internal language reaching the public UI

Tracing why the builder had displayed `server not configured` found the general case, not
just that one string. `lib/product-api.ts` `parseResponse` throws the server's `error` field
verbatim, and the Portfolio and Affiliate dashboards render whatever it throws — so three
`lib/server/app-bridge.ts` strings were public, including `database request failed`, which
names the architecture outright.

Users now read "This is temporarily unavailable. Please try again shortly." Operator detail
is not lost; it moves to the server log with the operation name:

```
[app-bridge] app_public_list_discord_marketplace: SUPABASE_URL or ADMIN_KEY is not set
```

Business errors from the edge function still pass through — those are user-actionable.

**Why the checker missed it.** `check-visible-copy` exempts `lib/server/`, correct for
server-only text but also where the product APIs build client-bound error fields. A second
pass now scans `app/api/product/` and `app-bridge` for internal vocabulary in `error:`
literals, scoped so bot and admin endpoints may keep technical errors.

The new rule was verified **by breaking it** — reintroducing `server not configured` fails
at the exact line, removing it passes. A check that has never failed proves nothing; the
JSX regex in this project silently matched nothing three separate times.

Verified after deploy: production marketplace still returns 2 sources, no error.

### Displayed numbers checked against the database, not against the API

The site's numbers had only ever been checked against the API that produces them, which
proves consistency, not truth. Queried live Postgres directly:

| Table | Rows | What the site shows |
|---|---|---|
| `app_private.kol_strategies` | 0 | "Live strategies 0" — **true**, not a failure |
| `raw_signals`, `parsed_signals`, `signal_deliveries` | 0 | Discord metrics as dashes — correct |
| `durable_jobs`, `worker_leases` | 0 | worker has still never run |
| `commission_ledger_entries`, `payout_requests` | 0 | no fees collected yet |
| `trade_executions`, `trade_intents`, `public.trades` | 0 | no trades |

This matters for requirements 6 and 7: the empty Discord performance figures are the honest
rendering of an empty journal, not a UI defect. It also means **the fee invariants cannot be
confirmed against live rows** — there are none. What guarantees them today is the database
constraints, so those were verified instead: every CHECK on the ledger and payout tables
reports `convalidated = true`, including the balanced-allocation and rate-bounds rules.

### A fee the UI described wrongly

`payout_requests` pins `processing_fee_lamports = 43000000` exactly, which against the
`gross_lamports >= 100000000` minimum is 43% of the smallest permitted payout. That rate is
deliberate and specified (`DEGENARATION_MASTER_SPEC.md:1025`), and applies only to creator
and referral payouts — never to user principal withdrawals. The constraint is correct.

The description was not. The affiliate FAQ called it a **"network processing fee"**; Solana
network fees are ~0.000005 SOL, and `request_payout` posts this one to
`commission_ledger_entries` with `account_type = 'platform'`. It is this platform's revenue.
Verified in SQL before touching the wording rather than inferring from the name.

The confirmation checkbox also hardcoded "0.043 SOL" instead of rendering the server's
value — a tickbox affirming a fee should state the fee actually being charged. Both fixed;
the Portfolio table already modelled this correctly with separate Network fee and Platform
fee columns.

### Self-review of the session's own changes

Eighteen commits landed in one day across 22 code files, and the numeric layer — which
touches every money entry field in the product — had had no independent pass. Reviewing it
found two real defects in the pure logic that the existing 122 tests did not cover:

| Defect | Effect |
|---|---|
| `clamp` had a `max > 0` guard | `clamp(50, 0, 0)` returned 50 — any maximum of zero or below was silently ignored |
| `normalizeWhileTyping("00")` returned `""` | typing a second zero erased the field |

The `max > 0` guard reads like a "0 means unlimited" convention. Every call site was checked
before removing it: all maxima in the product are real positive limits (100 trades, 99%,
10080 minutes, 10000 bps), so the guard only ever hid a bug.

Verified in production after deploy: `00` → `0`, `000` → `0`, `05` → `5`, `0.25` unchanged.

**Deliberately not changed.** A value above `max` still commits to parent state mid-typing,
because clamping happens on blur. Clamping the minimum while typing would fight the user
(a min of 0.01 would jump the field as soon as `0` was typed), and the server already
rejects out-of-range payloads through `boundedInteger` and the relational checks in
`lib/server/bot-validation.ts`. Recorded rather than turned into a worse behaviour.

**The tests were verified by breaking the fix.** Both bugs reintroduced → suite fails;
restored → passes. Test count stayed 122 throughout because these are assertions inside an
existing case, so the count alone would not have shown whether they ran. That distinction is
the same one that made the JSX regex, the git trailer split, and the RLS probe all read as
passes while checking nothing.

### The fee was being charged against the wrong mint

Continuing the self-review into `lib/server/fee-account.ts` — the file that decides whether
a fee is charged and where it lands — found the most consequential defect of the session.

The resolver was called with the swap's **input** mint. Jupiter collects the ExactIn
platform fee in the **output** mint, and this app sends no `swapMode`, so every swap is
ExactIn. Confirmed against the live quote endpoint rather than from documentation:

```
GET /swap/v1/quote  SOL -> BONK  amount=10000000  platformFeeBps=200
  swapMode    : ExactIn
  platformFee : {"amount": "511657893", "feeBps": 200}
```

`511657893` is BONK at 5 decimals. Two percent of the SOL input would be 200000 lamports.
The fee is denominated in the token received.

**The worker was the dangerous half.** It probed only that `PLATFORM_FEE_ACCOUNT` was some
initialised token account, then attached it to every swap. On a buy that hands Jupiter a
wSOL account while the fee is collected in the token being bought — and since Jupiter does
not validate `feeAccount`, the transaction builds and then fails **on chain**. That is
precisely the failure the guard was written to prevent, slipping through because the guard
was checking the wrong mint.

Both fixed. The route resolves against `outputMint`; the worker records the configured
account's mint at probe time and requests the fee only when the swap's output matches it.

Verified after deploy — both legs still build with the fee correctly skipped, and the
resolver now targets a different account per leg:

| Leg | Output | Fee account |
|---|---|---|
| Sell (BONK → SOL) | wSOL | `AuFCZDtr7PaZxEitCPzKpQZdkRLnpKZxK6Y4MpxAZhDj` — the one tracked in B-1 |
| Buy (SOL → BONK) | BONK | `97zMsUNUks8h9716eiVUQZ8dsF8DDVppjeemHVGQsQcH` |

**This corrects guidance given repeatedly earlier in this session.** Creating the wSOL
account was described as the single remaining step for fee collection. It is worth creating
and it enables the **sell** leg, but it was never going to collect on buys. Charging buys as
well means an account per token traded and dust across all of them; that is a business
decision, and Jupiter's Referral Program is the mechanism for it.

Gate tests verified by removal: the BONK-output case fails without the mint check and
passes once restored.

### The amount field could show a different number than it would trade

Reviewing the React layer of the numeric work (the pure logic had been reviewed; the
component had not) found this, and it reproduced on the deployed site:

```
click into BUY AMOUNT, then press +
  input shows : 0.6
  summary says: 0.70
```

The displayed buy amount and the amount the strategy would actually trade disagreed, on the
control that decides how much money each entry spends.

The stepper and the SOL presets set the parent value without touching the field's own text,
and the resync effect was guarded by `if (!editing.current)`. Once the input had focus,
every external change was ignored and the box kept its old number. Chrome usually hides this
because clicking a button blurs the input first; **Safari does not focus buttons on click**,
so there it happens with ordinary use.

The guard now compares against the last value the field itself emitted, so changes it did
not cause are shown even mid-edit — while the user's own typing still never resyncs, which
is what keeps a cleared field cleared and a half-typed `0.` intact.

Verified in production with focus held on the input throughout:

| Path | Input | Summary | Agree |
|---|---|---|---|
| Stepper `+` | `0.6` | `0.60` | yes |
| Preset `1 SOL` | `1` | `1.00` | yes |

**A false negative worth recording.** The first attempt to reproduce this used
`input.focus()` and reported no bug — programmatic focus did not set the editing flag, so
the test never simulated a user mid-edit and the hypothesis looked disproven. A real click
reproduced it immediately. Nearly the same failure as the RLS probe earlier: the check ran,
returned a clean answer, and was measuring the wrong thing.

### Checking my own app-bridge change for masked errors

The message change earlier could have hidden user-actionable errors, so the paths were
traced rather than assumed. It had not: every non-2xx response the edge function produces is
internal (`method not allowed`, `bad json`, `unknown operation`, `unauthorized`,
`bridge operation failed`), and business errors come back as HTTP 200 with `ok: false`,
which still passes through verbatim.

That trace did surface a real defect. The withdrawal modal hardcoded the **0.1 SOL minimum
in three places** — the initial amount, the validity check, and the amount field's own `min`,
which drives blur clamping — while the server already returns `minimumPayoutLamports` and the
database pins it (`payout_requests_gross_lamports_check`: `gross_lamports >= 100000000`).

It matters more than a tidy-up. If client and server ever disagree, the client lets a submit
through, the RPC raises `minimum payout is 0.1 SOL`, and the edge function replaces raised
exceptions with a generic message before it reaches the browser — so the user gets an
unexplained "temporarily unavailable" on a money action with no way to tell what was wrong.
The client is what holds the line, so it must read the server's number.

Third instance of the same class today, after the `0.043` fee literal and the platform fee
that had been living in seven places.

`QuickBuyEditor` was checked in the same pass and is sound: drafts are held as strings with
the validity gate, and `save()` filters on `n > 0`, so an empty or half-typed preset is
dropped rather than saved as a zero-SOL buy button.

### The withdrawal validator could approve more than the balance

The self-review reached the code that moves user funds. `spendableLamports` subtracted
`locked` and `pending` without flooring them, so a negative value **added**:

```
balance 1 SOL, locked -1 SOL  ->  spendable ~2 SOL
validateWithdrawal then APPROVED 1.5 SOL against a 1 SOL balance
```

Those figures come from the database, so this guards an accounting bug or a reversal race
rather than a hostile caller — which is exactly when a silent over-approval is hardest to
notice. The chain would reject such a transfer, but bounding what can move is this module's
whole purpose; it should not issue a transaction that cannot settle.

Deductions are now floored at zero and the result capped at balance minus the reserve, so
no combination of inputs can exceed what the account holds.

**The idempotency key protects nothing, and its comment said it did.** It read "Stable key
so a retried submission can never create a second transfer". The route returns it and
nothing consumes it — there is no store of used keys. The comment now records what actually
prevents a double withdrawal (submit disabled in flight; the user signs every transaction;
the server holds no keys) and what making it real would require, including the per-attempt
`requestId` the client does not send — without which two deliberate identical withdrawals
would collide on one key and the second be refused.

This is the same shape as the database audit asserting "policy denies" for an operation RLS
does not cover: a claim that reads as protection while nothing enforces it.

**A break-test that proved nothing.** The first attempt removed only the negative floor and
the suite still passed — the floor and the balance ceiling cover each other, so removing one
guard proves nothing. Restoring the entire original function fails the suite; the fix passes.
Sixth instance this session of a check that had to be checked.

### JS-to-SQL fee parity, verified against the deployed database

`lib/fee-model.js` has **no production callers** — the live allocation runs in SQL, and the
JS model is the specification the trigger is checked against. So the question that matters
is whether the two agree, and the standing test did not answer it: it compared the model to
`sqlFloorBps`, a JavaScript restatement of the SQL written in the same file. That proves
agreement with a transcription and would keep passing if production diverged.

Executed the real formulas against the deployed project and compared:

| Vectors | Components | Result |
|---|---|---|
| 24 notionals (1 → 999999999999) | platform @200, discord creator @70, kol creator @20, referral @1000-of-fee | **JS matches the live database on every one**, and every allocation balances |

Those observed values are now literals in the suite as `LIVE_SQL_VECTORS`, so the standing
test is pinned to production behaviour rather than to its own restatement, with the
re-capture query in the comment.

Verified by drifting `DISCORD_CREATOR_BPS` 70 → 71: the live-vector test fails at notional
999. Restored, 123 pass.

### Authentication review

The highest-stakes code not previously covered. `lib/server/privy.ts` is sound: tokens are
verified against Privy's JWKS with issuer and audience pinned, `jose` enforces `exp` and
`nbf`, a missing subject throws, and every failure path closes to 401.

`ownsPrivyWallet` has one fail-open, now named rather than left implicit:

| Token contents | Client claim | Result |
|---|---|---|
| linked account has an id | different id | **rejected** |
| linked account has **no** id | anything | **accepted** |

**Not a vulnerability.** Authority comes from the ADDRESS → USER binding, which holds in
every case — the identity token must share the access token's subject, and that subject must
have the Solana address among its linked accounts. Verified directly: a wrong address or a
wrong subject is rejected even with the id absent. Callers build against the verified
address, pass `walletId` alongside it rather than instead of it, and the server holds no
keys, so it cannot move funds either way.

**Left as is rather than tightened.** Requiring an id that Privy may legitimately omit would
break withdrawals for those accounts, and there is no exploitable gap to justify that risk
on a live financial app.

The behaviour is now asserted in the suite, with the condition under which it stops being
safe recorded at the function: the moment anything treats `walletId` as authoritative —
choosing a signing wallet, keying a balance lookup — the id must become mandatory. That is
how this becomes a real hole later, and nothing recorded it.

Verified the assertions are load-bearing by dropping the address comparison: the suite fails.

### The API input validators had no tests at all

`lib/server/guard.ts` guards the trading path for **41 routes** — which mints are
addressable, how large a swap may be, what slippage is allowed — and carried no coverage,
because the plain-node runner cannot require a `.ts` module. That is precisely why
`fee-model`, `numeric-input`, `withdrawal` and `privy-wallet` are all `.js`. The validators
now are too, as `lib/server/input-rules.js`, with `guard.ts` re-exporting them so all 41
routes and its public API are unchanged.

Two defects the new tests pin:

| Defect | Effect |
|---|---|
| `validSlippageBps` could return a fraction | Jupiter answers `"Query parameter slippageBps cannot be parsed: ParseIntError"` for `300.7` and returns no quote — the swap fails outright |
| The rate-limit map never released anything | Entries were overwritten on expiry but never deleted, so it grew by one per distinct ip+path and never shrank |

Neither is reachable from the app today — the UI already rounds slippage, and serverless
recycling has been masking the map growth. Both are fixed because a sanitiser that emits a
value the downstream API refuses is not sanitising, and a cache that only grows is a leak
whether or not the platform currently hides it.

**A silent break caught by the compiler.** Extracting `isMint` as plain JS lost its type
predicate (`s is string`), which every trading route relies on to narrow `unknown`. `tsc`
failed immediately; `input-rules.d.ts` now declares the predicate with a note on why it must
stay one.

New coverage: base58 mint validation, u64 and 100-SOL bounds at their exact boundaries, the
buy/sell cap asymmetry, exponent and fractional rejection, slippage integrality and cap, and
that `sanitizeError` leaks neither stack frames nor an unbounded message.

Verified in production after the refactor: a valid swap builds, and `amount: 0`, `"1e9"` and
a short mint each return **400**, not 500 — so the re-export is correctly wired.

### Rate limiting on the withdrawal endpoint

`lib/server/distributed-rate-limit.ts` protects the endpoint that builds fund-moving
transactions and, being `.ts`, had the same absence of coverage as `guard.ts`. Two gaps:

**The withdrawal POST was the only mutating money route without `failClosed`.** `bots`,
`kol-subscriptions`, `payouts` and both referral routes all set it. Without it, a bridge
outage dropped this endpoint back to the in-memory limiter in `guard.ts` — which is **per
instance**, and therefore no real bound across a serverless fleet.

Setting it costs nothing in availability: `resolveState` already returns 503 when the bridge
cannot verify the balance, so a request surviving a failed-open limiter was going to fail a
few lines later regardless. It now fails closed at the first gate rather than the third.

**A malformed success was read as permission:**

```ts
if (result.data.allowed !== false) return null;   // {} means allowed
```

Any response missing the field passed, and `failClosed` did **not** cover it — that only
guards `!result.ok`. A bridge answering 200 with an unexpected body disabled the limit
entirely, on every route, silently. The check is now positive: `allowed` must be a boolean,
and anything else takes the configured fail-closed path.

Verified in production after deploy: the withdrawal endpoint returns **401** without a token,
not 503 — so the limiter passes through normally when the bridge is healthy and the
fail-closed path engages only on real failure.

## Readiness

**READY FOR STAGING — not for mainnet.**

No requirement is BLOCKED. Every remaining gap is a physical dependency: a funded wallet,
a deployed worker, or a signed-in session. Before mainnet, `PLATFORM_FEE_ACCOUNT` must be
set (currently 0 bps collected) and **OPEN_BLOCKERS B-6 must be resolved** — the worker
reads legacy tables carrying no safety configuration, so a deployed worker would execute
without the filters users configured.
