# Launch remediation — Phase 1 audit findings

Audit date: 2026-07-30. Branch: `claude/degenaration-launch-remediation`.
Baseline before any edits: `npm run check` **passed** (typecheck + 41 server tests + production build, exit 0).

Findings are confirmed by file/line evidence, not inference.

## F-1 — Platform fee config is duplicated and uses floating-point math (release-blocking)

`PLATFORM_FEE_BPS = 200` is redeclared independently in four route files, with a fifth
hard-coded `200`:

- `app/api/quote/route.ts:6`
- `app/api/swap/route.ts:6`
- `app/api/simulate/route.ts:7`
- `app/api/platform/config/route.ts:3`
- `app/api/admin/summary/route.ts:18` (bare literal `200`)

No single source of truth, so the rate can drift per route. Spec §13.1 requires one
coherent fee model.

`app/api/simulate/route.ts:34` computes the fee in floating point:

```ts
const feeSol = applyFee ? (solBaseUnits / 1e9) * (PLATFORM_FEE_BPS / 10000) : 0;
```

Spec §2.9 and §13.1 prohibit floating-point money math; fees must use integer
lamports and basis points.

Additionally the fee is only applied when `PLATFORM_FEE_ACCOUNT` is set; when unset the
platform charges **0 bps**. See B-1.

## F-2 — No creator or referral allocation exists

No `CREATOR_*_BPS` or `REFERRAL_*_BPS` constants exist anywhere in `app/`, `lib/`, or
`server/`. Spec §13.2/§13.3 require Discord creator 70 bps, KOL creator 20 bps, and a
referral share of 1000 bps *of the collected platform fee*, all funded from the 200 bps
fee with balanced immutable ledger entries. Not implemented.

## F-3 — User principal withdrawal does not exist (release-blocking)

`app/api/withdraw/route.ts` is **admin-only**: it calls `requireAdmin`, rejects any
`from` address not in the `ADMIN_WALLETS` / `PLATFORM_FEE_ACCOUNT` allowlist, and exists
to move accumulated platform commissions out of the fee wallet. There is no user-facing
withdrawal endpoint.

The Portfolio modal is a hard-coded dead end —
`components/product/PortfolioDashboard.tsx:324` renders `UnavailableWithdrawal`, whose
copy reads "In-app transfers are not available … Funds remain controlled by the
connected wallet." This is exactly the state §12 and §23 forbid at launch.

**Wallet-model determination (spec §12.2).** The system is non-custodial: the withdraw
route's own header states "the platform never holds keys", and identity/wallets are
provided by Privy. Funds sit in user-owned wallets (Privy embedded or external
connected), not an application custodial account. Therefore the correct implementation
is a self-service transfer the **user signs with their own wallet** — no custody, no
routine admin approval, no per-user unlock flag. A custodial withdrawal queue must NOT
be built, as that would misrepresent the wallet model.

## F-4 — Duplicate `/register` is caused by mixed global and guild command scopes

`server/bot/index.js` declares each command exactly once (`register`, `alpha`, `degen`,
`onboard`, `help` — lines 30/34/39/48/52), so the duplicate is not a source-level repeat.

`server/bot/index.js:139` deploys them guild-scoped only:

```js
await guild.commands.set(COMMANDS.map((command) => command.toJSON()));
```

`guild.commands.set()` bulk-replaces the *guild* command list and never touches the
*global* list. Stale global copies registered by an earlier deployment therefore remain,
and Discord renders both the global and guild `/register`. Spec §15.1 requires exactly
one active scope and a deployment that removes stale duplicates.

Fix direction: clear the global command list once on ready, keep guild-scoped
deployment, and add a uniqueness check per §4.4 `scripts/check-discord-commands.mjs`.

## F-5 — Forbidden internal copy is visible in the public UI

- `app/bots/kol/[id]/page.tsx:233` — "Mainnet activation locked"
- `app/calls/CallsBody.tsx:159` — "Automated take-profit and stop-loss exits remain unavailable until persistent position reconciliation is verified."
- `app/docs/page.tsx:6` — "the database atomically checks …" / "controlled release review"
- `components/product/PortfolioDashboard.tsx:327` — withdrawal-unavailable paragraph (see F-3)

Spec §11.4 and §23 require these be removed or relocated to Admin Console diagnostics.

## F-6 — Retired neon design tokens are still in use

`tailwind.config.ts` still defines and components still consume `toxic` (neon green),
`hotpink`, `cyber`, and `shadow-toxic` — e.g. `app/wallet/WalletBody.tsx:90,122`
(`bg-toxic`), `components/product/PortfolioDashboard.tsx:327` (`border-toxic/35`),
`app/trenches/page.tsx:157` (`text-hotpink`). The approved identity is gold / white /
dim-black (§5.1–5.2). `gold: "#f0b429"` exists but the semantic token layer from §5.2
(`--canvas`, `--surface-*`, `--gold-*`, `--text-*`) does not.

## F-7 — Unicode glyphs used as interface icons

`✓` and `⚠` are rendered as UI affordances rather than icon components:

- `app/apply/page.tsx:90`, `app/wallet/WalletBody.tsx:90,122`
- `components/SwapPanel.tsx:91`, `app/admin/commissions/page.tsx:91`
- `app/trenches/page.tsx:157` (`⚠`)

Spec §5.6/§23 require a professional SVG icon layer with an explicit allowlist for any
retained Unicode symbol.

## Not yet audited in depth

Deferred to their implementation phases so the audit stays focused (§2.3):
Discord/KOL signal-to-journal pipeline runtime behavior (schema exists across 40 SQL
files including `degenaration-discord-signal-ingestion.sql`), Affiliate async-state
handling, scanner adapter coverage, Portfolio equity series.
