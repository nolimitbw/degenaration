# Authenticated browser evidence — E-6, 2026-08-05

The owner signed in to a Chrome started with `--remote-debugging-port=9222` and this session
attached a fresh tab in the same profile. 32 frames across 8 private routes at 390 / 768 /
1024 / 1440, plus targeted DOM measurements. No transaction was signed or broadcast, no
control that submits or moves funds was clicked, and no wallet address, token or cookie is
recorded here or in any committed artifact.

`docs/ai/evidence/browser/private-results.json` and the `*-{mobile,tablet-768,tablet,desktop}-*.jpg`
frames are the raw record.

---

## The first run captured the signed-out product and would have filed it as proof

`capture-browser-evidence.mjs` waited 1200ms after resize, which is enough for the shell and
not for Privy to restore the session. Every one of the first 32 frames reported
`signedIn: false` — the connect prompt — on a browser that was signed in, while the header was
already rendering the wallet chip.

Signed-out screenshots filed as authenticated evidence are worse than none, because the parity
rows they would close are exactly the ones that need a session. The capture now waits for the
wallet chip and **fails loudly** if it never appears, rather than measuring whatever is on
screen at the 1200ms mark.

Everything below is from the corrected run.

---

## What the deployed build gets right

| Property | Result |
|---|---|
| Console errors | **0** across all 8 routes × 4 widths |
| Failed requests | **0** |
| Indefinite spinners | **0** |
| Forbidden operator copy (§23) | **0** |
| Emoji used as an interface icon | **0** |
| Admin console, signed-in owner | Renders: `VERIFIED OWNER WORKSPACE`, `flipthatsol@gmail.com · signed Google identity required`, real counts — USERS 5, ACTIVE BOTS 0, OPEN POSITIONS 0, PENDING REVIEWS 0 |
| Admin API, no credential | `/api/admin/summary` → **401** |
| Product APIs, no credential | `/api/product/{affiliate,portfolio,bots}` → **401** |
| Portfolio truthfulness | 0.000 SOL, `Positions 0`, `Trades 0`, `+0.000 SOL` PnL — the account is unfunded, and the figure is a direct per-request `getBalance`, so there is no second number to disagree with |
| Affiliate truthfulness | 0 SOL across all four metrics with info affordances, `No earnings in this period` — no fabricated values |
| Bot Manager | `0 active · 0 paused · 0 drafts` with an honest empty state |

## Defect 1 — 56px of horizontal overflow on every authenticated route

All 8 private routes overflow at 390px, every one by the identical amount. Root-caused rather
than inferred: `main` measures 390 and `body.scrollWidth` measures 446, and the offender is the
header's account cluster, `div.ml-auto.flex.items-center.gap-2`, right edge 446.

It appears only when signed in, which is why the signed-out audit finds nothing — signed out
that cluster is a narrow placeholder.

**Already fixed at HEAD**, in `b6099c4`. Proven by applying the repo's fix to the live signed-in
DOM one part at a time and measuring:

| Stage | `documentElement.scrollWidth` | nav button |
|---|---|---|
| deployed `29291c9` | **446** — 56px of overflow | **21 × 44** |
| `+ min-w-0` on the cluster, `+ shrink-0` on the nav button | 444 | 44 × 44 |
| `+ compact logo below sm` (repo HEAD) | **390** — none | 44 × 44 |

So this is a **deployment gap, not a code defect**. Production runs `29291c9`; the fix landed
after it. It closes when the application is deployed and needs no further code.

## Defect 2 — three Affiliate controls at 16px, found only with a session

At 390px, signed in, on `/affiliate`:

| Control | Measured | Fixed |
|---|---|---|
| `Connect Discord` | 96 × **16** | ✅ |
| `Add bot` | 63 × **16** | ✅ |
| `Open application` | 99 × **16** | ✅ |
| `Copy referral link` (×2) | 32 × **32** | ✅ |

All three text links are the actions that start Discord onboarding — the first thing a source
owner touches. They are rendered through one `CreatorStep` action slot, so the fix is one
place: the slot gets `min-h-11` on mobile and returns to its compact size at `sm`, where the
input device is a pointer. Text size and colour are unchanged; only the hit area grows.

## Defect 3 — the risk-acceptance checkbox label

`/onboarding` and `/login` both render `I understand that I can lose my entire trading
balance.` as a 13px checkbox in a label with no minimum height. The label is the tap target,
and it measured under 44px. Both now carry `min-h-11 sm:min-h-0`.

## Defect 4 — both audits measured only one dimension of a tap target

The header's navigation button was **21px wide and 44px tall**. A `height < 44` filter passes
it, so the audit that existed to catch exactly this control reported it as compliant.

Both harnesses now test `min(width, height) < 44`, and count a wrapping `<label>` as the target
because the label is what the finger hits. Tightening it immediately found a fifth defect that
had been invisible: the brand home link is the 32px compact mark, so it was a **32 × 44**
target on every route. Widened to 44 × 44 on mobile — the header row measures 307px of content
in 390px, so the 12px is free, and the mark itself is untouched.

## Every remaining sub-44px control on the deployed build, accounted for

Re-measured with the corrected `min(width, height)` filter. The counts are HIGHER than the
first pass because the filter now catches the two controls the height-only version passed.
Every one is fixed in this repository and awaiting the application deploy — none is open:

| Route (390px) | Count | Which controls |
|---|---|---|
| portfolio, positions, trades, movements | 2 | skip-link (36px, off-screen until focused) + nav button **21px wide** |
| bot-manager, admin | 2 | same two |
| onboarding | 3 | those two + the risk-acceptance checkbox label |
| affiliate | 6 | those two + `Connect Discord`, `Add bot`, `Open application`, `Copy referral link` |

The skip-link is not a touch target — it is `-translate-y-20` and only reachable by keyboard
focus, at which point it is 137 × 36 with a visible focus ring. It is the irreducible baseline
of this measurement, not a defect.

After the deploy the expected count at 390px is **1 on every route**, the skip-link alone. The
local audit already reports that: `verify:responsive` runs the current build and passes with
zero findings under the same filter.

---

## What a session could NOT close, and why

### The PnL cards are blocked on E-3, not E-6

Rows I1 / I2 / I3 were recorded as waiting for a signed-in session. They are not. With the
session, the share controls are **correctly disabled**: the account holds 0 positions and has
no reconciled performance snapshot, and the route refuses a period with no snapshot rather than
rendering `0.00%`. Calling `/api/product/pnl-card` directly returns 401, because the route
requires the Privy identity token the app attaches — and extracting that token is forbidden.

Proving these rows needs **one settled position**, which needs the worker (**E-3**). No
credential and no session changes that.

### Builder and Bot Manager parity rows cannot be closed against production

The deployed builder is an older component: 8 sections — `Identity and source`, `Optional
description`, `Funding and exposure`, `Risk limits`, `Take profit`, `Stop loss`, `Security
filters`, `Execution and retries` — against the repository's 10, and it carries none of the
pending-control notices added this session.

Production is ~80 commits behind the repository. Signed-in evidence gathered there describes a
build that no longer exists in this codebase, so it cannot close a row about current code. The
server side of those rows is already covered by `verify:bot-lifecycle` (10 properties); what
remains unproven is the browser interaction **against the current build**, which needs the
application deployed.

No bot was created, saved or edited. Doing so would write production rows on the owner's
account, which is not required to read the form's state and is not reversible by inspection.


---

# Post-deployment verification — `3facdfb`, 2026-08-05

Deployed `7cdfd3d` plus two deploy-support commits to `de-generation/degenaration`
(`prj_dNXJlDAhMucn0xTLXa66rNGP8iTi`), aliased to `https://degenaration.vercel.app`.
Rollback target preserved and Ready: `dpl_Bt5cXhvkcaiquiEcYZLiRFY27RyB`.

**The deployed SHA is `3facdfb`, not `7cdfd3d`.** Two commits were needed to make the deploy
possible and verifiable, and both are recorded rather than folded in silently:

- `839a912` — `.vercelignore`. The first CLI deploy uploaded **426.9MB** for a 24MB tracked
  tree and failed on transport. The first version of that file used unanchored patterns, which
  also matched `lib/server/*` (the build failed loudly with `Can't resolve '@/lib/server/admin'`),
  `lib/supabase.ts`, and `app/docs/page.tsx` — a live route that would have vanished with **no
  error at all**. Every directory pattern is now anchored; `/docs` returns 200.
- `3facdfb` — `/api/build`, which the verification list asked for and which did not exist.

| Requested check | Result |
|---|---|
| `/api/build` reports the deployed commit | `3facdfb`, branch `claude/continue-codex-unfinished-2026-08-02`, `environment: production`, from `VERCEL_GIT_COMMIT_SHA` |
| Authenticated private routes load | **32/32** frames, `signedIn: true` on every one |
| No infinite spinners | **0** |
| No mobile overflow | **0/32** — was 8/8 routes before the deploy |
| Mobile tap targets | **1 per route**, the skip-link — exactly the predicted post-deploy figure |
| Mizar-familiar navigation and builder | Nav is Bots · Affiliate · Portfolio; the builder is the current **10-section** component, was 8 |
| Discord marketplace | `HIT RATE (PEAK)` · `UP NOW` · `MEDIAN PEAK` · `MEDIAN NOW` all rendering, 2 sources, `Tracking started Jul 18` |
| Bot Manager · Affiliate · Portfolio · Admin | All render; Admin as `VERIFIED OWNER WORKSPACE` with real counts |
| PnL cards | Share controls correctly **disabled** — 0 positions, no reconciled snapshot. **E-3**, not a UI gap |
| Admin restricted server-side | `/api/admin/summary` → **401** with no credential; all product APIs → 401 |
| Browser console | **0 errors, 0 failed requests** across all 32 frames |
| Financial rows changed | **None.** Every table identical to the pre-deploy baseline; `mainnet_execution_enabled` still `false` |
| Transactions | None signed, none broadcast |

## Tap-target counts at 768 and above are by design, not findings

The summary flags 24 frames with more than one sub-44px control — all at 768px and wider. The
design system specifies `sm:min-h-10`, a 40px control height above the `sm` breakpoint, and 44px
is a **touch** minimum. Above `sm` the input device is a pointer. Mobile, where it matters, is
**1 on every route**.

## A measurement that was wrong three times

The pending-control notices added to the bot builder appeared absent on production. They are
not. The probe read `innerText` per `<details>`, and the builder nests sections, so the text sat
in a node the regex never examined; a second attempt read `innerText` in the same task as
toggling `open`, before layout. The decisive check is the server-rendered HTML, which contains
the string **4 times on production and 4 times locally** — identical. The notices ship.
