# UI copy

Enforced by `npm run check:visible-copy`. Spec: `FINAL_LAUNCH_SPEC.md` §6, §11.4, §23.

## The principle

Say what it means for the user. Never describe the implementation.

Being honest about limits is **required**. Sounding like an engineering changelog is not.

| Don't | Do |
|---|---|
| "Mainnet activation locked" | "Automated trading not yet available" |
| "Automated activation requires controlled release approval. No fallback fills." | *(removed — a permanent warning footer is not a product state)* |
| "The database reserves these limits atomically before the worker requests a signature." | "These caps apply to every automated trade." |
| "Immutable commission accounting for confirmed Discord and KOL copied trades." | "Track creator and referral earnings." |
| "Automated bot activation and payouts remain locked during release review." | "You confirm every transaction in your own wallet. Automated trading and payouts are not yet available." |

Each replacement still tells the user automation is unavailable. What changed is that it
now reads as a product state instead of an internal status report.

## Limits

- Page subtitle: one sentence, 50–100 characters
- Card description: one sentence, max two lines
- Field helper text: omit by default; use an info control when explanation genuinely helps
- Tooltip: under ~240 characters
- Longer guidance belongs in a right-side info drawer, not on the page

Do not repeat one idea across heading, card, field, and footer. Do not put a filler
eyebrow above every title. Do not present warnings as permanent paragraphs — use
contextual alerts only when action is required.

## Required primary copy

| Surface | Title | Subtitle |
|---|---|---|
| Bots | `Bots` | `Automate approved Discord calls or run a community strategy.` |
| Discord marketplace | `Discord Sources` | `Approved call communities with measured on-chain performance.` |
| KOL marketplace | `KOL Strategies` | `Copy public strategies built and tracked on DegenAration.` |
| Affiliate | `Affiliate` | `Track creator and referral earnings.` ✅ shipped |
| Portfolio | `Portfolio` | `Balances, positions, performance, and transactions.` |
| Wallet | `Wallet` | `Fund your automation wallet and manage spending limits.` |

## Forbidden

The checker fails the build on: `activation locked`, `activation remains locked`,
`release locked`, `release gates`, `release review`, `remain(s) locked`,
`controlled release`, `no fallback fills`, `database reserves`, `engine not configured`,
`immutable accounting`, `atomically`, `lorem ipsum`, `unlock your potential`,
`revolutionize your trading`, `coming soon`, `todo:`, `tbd`, and any emoji or Unicode
pictogram used as an interface icon.

Admin Console (`app/admin/`, `components/admin/`) is exempt — operational detail belongs
there.

## Scope note

The checker scans `app/`, `components/`, **and `lib/`**. It originally scanned only the
first two and missed `AUTOMATED_MAINNET_RELEASE.reason`, which renders in the header
popover. That was caught by looking at the rendered page, not by grepping — a reminder
that a static check is a floor, not a substitute for opening the app.

## Never

Do not hide meaningful risk, fees, transaction status, or errors. Translate them into
concise user language and put technical detail behind an info or support view. Do not
fabricate balances, performance, calls, coverage, users, volume, or testimonials. Label
demonstration, simulated, paper, stale, delayed, and devnet data clearly.
