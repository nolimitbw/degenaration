# Browser evidence

Captured 2026-08-05 against **https://degenaration.vercel.app** over CDP, by attaching to a
Chrome the owner signed into themselves. No credential, OTP or Privy token passed through the
capture process; every captured string is redacted at capture time (`scripts/lib/cdp.mjs`).

**Read what build this is.** The deployed application is `29291c9`. The database behind it is
current — all seven migrations and app-bridge v13 were applied on 2026-08-05 — but the
frontend is not this branch. So these frames evidence the **deployed** UI, and any row they
close is closed for that build. Fixes made after capture are listed as such.

`node scripts/capture-browser-evidence.mjs --plan public|private --base <url>`

## Result

| Plan | Routes | Frames | Horizontal overflow | Forbidden public copy | Emoji as UI icon |
|---|---|---|---|---|---|
| public | 5 | 20 | **0** | 0 | 0 |
| private | 8 | 32 | **8** — every route at 390px | 0 | 0 |

Widths: 390 (mobile emulation), 768, 1024, 1440. Per-frame observations, including console
errors and failed requests, are in `public-results.json` and `private-results.json`.

## Defect found, root-caused and fixed

Every **signed-in** route scrolled horizontally by 56px at 390px. No public route did.

Root cause, isolated by hiding candidates and re-measuring: the app header. Hiding the
backdrop left 446px; hiding `<header>` gave exactly 390px. Measuring its children at 390px:

```
padding 16+16 · nav button 21 · gap 12 · logo lockup 154 (shrink-0) · gap 12 · account controls 231
= 462px of content in a 390px viewport
```

Two defects, one cause. The row overflowed by 56px, **and** because the logo is `shrink-0`
and the account controls are fixed-width, the only flexible child left was the navigation
button — which collapsed to **21px**, under half the 44px minimum tap target, on the control
that opens navigation on mobile.

Fixed by rendering `Logo`'s existing `compact` variant below `sm` and restoring `shrink-0` on
the navigation button. The logo mark itself is unchanged — not scaled, redrawn or replaced;
only the wordmark is dropped at the narrowest width, recovering 122px.

Verified by simulating exactly that change in the live page and re-measuring:

| Route | scrollWidth before → after | nav button before → after |
|---|---|---|
| `/portfolio` | 446 → **390** | 21 → **44** |
| `/affiliate` | 446 → **390** | 21 → **44** |
| `/bots/manage` | 446 → **390** | 21 → **44** |
| `/admin` | 446 → **390** | 21 → **44** |

## What these frames do and do not prove

- **Do:** the signed-in shell, Portfolio and its four tabs, Affiliate, My Bots, onboarding and
  the owner console all load without console errors or failed requests, at four widths, with
  no forbidden operator copy and no emoji used as an interface icon. `/admin` renders for the
  owner, which also confirms the session is the admin identity.
- **Do not:** exercise a save, an edit, or a withdrawal. The wallet holds 0.000 SOL, so the
  Withdraw screen cannot show a non-zero spendable figure and runbook step B2 stays open.
  Nothing was signed and nothing was broadcast.
