# CLAUDE.md — degenaration

Auto-trading memecoin platform on Solana. This app moves real money. Correctness,
safety, and a consistent premium UI matter more than speed. Read this file fully
before touching code.

## The one rule: do not rush

Sessions here fail when they sprint to "done" in a few minutes and leave a mess.
Follow this loop for every non-trivial task. Do not skip steps.

1. Understand — read the relevant files and this design system BEFORE writing code.
   Never invent a page from scratch when a pattern already exists.
2. Plan — for anything beyond a one-line fix, write a short numbered plan. You do
   NOT need approval to proceed on backlog/roadmap work — make the reasonable call,
   note it, and build. Only pause for the "When to interrupt the user" list below.
3. Build — implement in small, coherent edits. Reuse existing components and tokens.
4. Self-review — reread your own diff. Delete dead code, console.logs, TODOs, scraps.
5. Verify — actually exercise it (`npm run build`, load the page) before claiming done.
6. Report honestly — if the build fails or a step was skipped, say so plainly.

A task is NOT done just because a file was written. See "Definition of done" below.

## Autonomy contract (read this — the owner wants to be left alone)

The owner does not want to babysit sessions or be asked to approve routine work.
Default to acting, not asking. Work through the backlog top to bottom on your own.

- Decide and proceed on anything reversible: which roadmap item is next, component
  and file structure, copy, styling within the design system, refactors, test edits,
  bug fixes. Make the sensible choice, log it in `docs/activity-log.md`, keep going.
- Do NOT hand a decision back to the owner just because it is "non-trivial." Pick the
  best option, state the assumption in one line, and continue. If you are between two
  reasonable options, pick the one that is easier to reverse and move on.
- Self-verify instead of asking the owner to check: `npm run build`, load the page,
  run `server/test/run.js`. Report what you actually observed, not "please confirm."
- Batch, don't ping. If you hit things that genuinely need the owner (see below),
  collect them into ONE list at the end of your turn. Never interrupt mid-work with
  a single question when you could keep making progress on other backlog items first.

### When to interrupt the owner (the ONLY reasons to stop and ask)

1. Secrets/credentials only they hold — Supabase service key, Privy app secret,
   Helius key, host login, `PLATFORM_FEE_ACCOUNT`. Never invent or guess these.
2. Going live with real money — flipping to mainnet with real funds, setting
   `DELEGATED_SIGNING=on`, or anything that lets the engine move actual SOL.
3. Irreversible or outward-facing actions — production deploy, `git push`, deleting
   files you did not create, publishing, spending money.
4. A real fork in the product direction that changes what gets built, not how.

Everything else: just do it. Then report what you did and what (if anything) from
the list above is now waiting on them.

## Backlog (work top to bottom; keep this list updated as you finish items)

Full detail in `FEATURES-ROADMAP.md`. Current priority order:

1. Trenches feed + Explorer screener polish — biggest daily-use surfaces.
2. Wallet Tracker (second copy source) with buy alerts.
3. Holdings performance chart + shareable PnL card.
4. Limit orders + snipe-on-launch wired into the engine.
5. Account security (2FA, session manager), Telegram bot.
6. Finish the 24/7 delegated-signing worker — CODE is done and tested; blocked only
   on owner-held secrets + a host (see reason #1 above). Devnet-test before mainnet.

## Anti-patterns that created the current mess (never do these)

- Creating `Thing2.tsx` / `page-new.tsx` instead of editing the real file. If you
  need to replace something, replace it in place.
- Leaving `.bak` files or dead directories (e.g. `app/explorer.bak/`). Delete scraps.
- Duplicating a component that already exists in `components/` or `app/`.
- One-off hex colors, ad-hoc spacing, or inline styles that ignore the design system.
- Declaring victory without running the build.
- Deleting a file you did not create without flagging it to the user first.

## Tech stack (use what is here, add nothing without asking)

- Next.js 14 App Router, TypeScript, React 18.
- Tailwind CSS 3 + the tokens below. Framer Motion for animation.
- Auth: `@privy-io/react-auth`. Data: Supabase (`lib/supabase.ts`, `lib/queries.ts`).
- Chain: `@solana/web3.js`, `@solana/spl-token`. Swaps via Jupiter (see `server/`).
- No new dependencies without explicit approval. Check `package.json` for versions.

## Design system — every page must look like one product

Colors (tailwind.config.ts) — use the token names, never raw hex:
- `void` #07070b (page bg), `panel` #0d0d15 (cards), `edge` #1c1c2a (borders)
- `toxic` #a3ff12 (primary accent), `hotpink` #ff2d78, `cyber` #7b5cff
- `dim` #8b8b9e (muted text)

Fonts: `font-display` for headings, `font-mono` for numbers/addresses/data.

Reusable CSS utilities in `app/globals.css` — use these instead of reinventing:
- `.glass` glass panel, `.gradient-border` hover border, `.gradient-text` animated text
- `.grid-bg` background grid, `.text-glow-toxic` / `.text-glow-pink` glows

Shared components — reuse before building new: `AppShell`, `Nav`, `Footer`,
`GlowCard`, `SwapPanel`, `Search`, `Ticker`, `Toast`, `TokenDrawer`, `Candles`.

UI bar: dark, dense, "trading terminal" feel. Numbers monospaced and right-aligned.
Consistent card padding and radius. Loading and empty states are required, not
optional. Never ship a page that looks different from the rest of the app.

## Code conventions

- Concise, precise code that matches the surrounding file's style.
- Comments: one line, one sentence, only when non-obvious. No emojis.
- Money/trade logic: validate inputs, handle failure, never swallow errors silently.
- Least privilege: do not expose keys, RPC secrets, or user data to the client.
- Markdown files use kebab-case names. Write progress notes to `docs/activity-log.md`
  (create `docs/` if missing); do not auto-commit logs or docs.

## Definition of done (all must be true before you say "done")

- [ ] `npm run build` passes.
- [ ] The change was actually loaded/exercised, not just written.
- [ ] Uses design tokens and existing components; visually consistent with the app.
- [ ] No duplicate files, `.bak` dirs, dead code, or stray console.logs.
- [ ] No new dependencies or deleted files without the user having approved them.
- [ ] Errors, loading, and empty states are handled.

## Deploy

Production deploy (only when the user asks):
`npm_config_cache=/tmp/degen-npm npx vercel --prod --yes`
Never auto-commit or auto-push. Deploy only on explicit request.
