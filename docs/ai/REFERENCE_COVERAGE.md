# Reference coverage

Updated: 2026-08-01

## Distinct states found

| Source | Screens, dialogs, tabs, dropdowns, controls, and states checked |
| --- | --- |
| V1 Affiliate | Rewards summary; Discord Alpha/Volatility/Payout tabs; 24H/7D/30D ranges; earnings chart and empty state; FAQ accordions; payout modal; asset/network/destination/amount fields; minimum, fee, daily limit; insufficient balance validation; cancel/confirm; payout history |
| V2 Discord | Marketplace grid; per-source image/name/status/performance; 1D/7D/30D; source selection; bot name; max trades; wallet; buy presets; server/channel; TP toggle/rows/add/remove/trailing; SL/trailing/dynamic; retry expansion; security checklist dialog; final grouped confirmation; acknowledgement; save toast and return |
| V3 KOL | Builder; visibility; wallet; price-drop/reference/lookback; quick-set modal; auto-refresh/count/degen mode; manual token universe; DEX chips; 24+ per-row filters; preview results; DCA rows/expiry; TP; SL/delay/dynamic/freeze; priority/slippage/MEV-style protection; retries/cooldown; risk/capital review; save/publish |
| V4 Manager | Discord and KOL tables; status; source/strategy; 30D performance/volume; fees; capital; trades; created date; row menu; actual-config edit; pause/delete/save; manager return; empty state |
| V5 Portfolio | Wallet selector/actions; performance/realized/unrealized/available/total; 1D/7D/30D; chart hover tooltip; Main Stats/MC Distribution; Portfolio/Trades/Swaps; table loading; empty wallet; deposit dialog; bridge dialog |
| I1-I3 PnL | Winning, losing, and portfolio landscape cards; dominant signed PnL; token; entry/current or exit; duration; source; generated time; identity; referral/canonical link and matching QR |

## DegenAration component coverage

| Area | Implemented surface | Reference coverage | Known exact gap |
| --- | --- | --- | --- |
| Product shell | `components/AppShell.tsx` | Focused Bots/Affiliate/Portfolio navigation | New multi-viewport task evidence pending |
| Discord marketplace | `/bots/discord` | Source cards, filtering, periods, real avatar, accepted/rejected/executed calls, processing/execution timestamps, freshness, and three ledger windows | Forward RPC migration and live-card evidence pending; responsive failure state is captured at three widths |
| Discord setup | `components/product/BotBuilder.tsx` | Source/channel, budget, TP/SL, filters, retries, review/save | Order aligned and desktop evidence captured; authenticated source/save proof pending |
| KOL marketplace/setup | `/bots/kol`, `BotBuilder` | Presets, trigger, DCA, filters, preview, exits, execution | Three-width builder evidence captured; DEX selection stays hidden until worker-enforced |
| Bot manager/edit | `/bots/manage`, edit routes | Separate kinds, status/actions, actual config/version save, 30D fees/gas, safe archive confirmation | Preset/zero-value hydration and fee display fixed; authenticated lifecycle/edit proof remains |
| Affiliate | `/affiliate` | Earnings ranges/tabs, explanations, payout/FAQ/history | Eligible payout evidence needs account fixture/session |
| Portfolio | `/portfolio` | Balances, performance, stats, tabs, withdrawal, empty/error | MC distribution lacks provider data; signed-in evidence pending |
| PnL share | `/api/product/pnl-card` and share actions | Original 1600x900 gold/black server-authoritative card, real DegenAration mark, signed PnL, and matching QR/referral fallback | Authenticated render proofs pending; completed-trade exit price is blocked on durable ledger linkage |

## Functional dependency coverage

| Dependency | Current evidence | Status |
| --- | --- | --- |
| Discord registration/duplicate removal | Static command check and registry code | PARTIAL until observed against live application |
| Gateway ingestion/parser/mint/dedupe/journal | Tests and live database rollback proof in implementation tracker | PARTIAL until deployed worker produces runtime signals |
| Scanner/risk filters | 35 filters and fail-closed enforcement | PARTIAL: worker must receive per-subscriber config (B-6) |
| Fan-out/trade intents/sign/submit/confirm/reconcile | Unit/integration evidence and settlement migrations | PARTIAL: worker deployment and controlled devnet/browser run pending |
| Fees/commissions/referrals | Integer invariant tests and live database proof | PASS at calculation/data layer |
| Portfolio/withdrawal | Local-validator 16/16 and reconciled empty states | PARTIAL: Privy UI signature pending |
| Durable bot configuration versions | API/version schema and manager edit path | PARTIAL: edit hydration repair and browser proof pending |

## Evidence register

Existing evidence is retained and not regenerated without a relevant change:

- Current production comparison frames:
  `.references/SETTINGS AND FUNCTIONS IDEA/extracted-frames/current-build-2026-07-30/`
- Existing release evidence: `docs/launch/RELEASE_EVIDENCE.md`
- Implementation and database proof: `docs/coordination/IMPLEMENTATION_STATUS.md`
- Reference audit history: `docs/launch/REFERENCE_MATRIX.md` and
  `docs/degenaration-reference-coverage.md`

New evidence from this milestone is under `docs/ai/evidence/`; its README records route,
viewport, tested state, assertions, and verification result. Builder coverage now exists at
desktop, tablet, and mobile. The Discord marketplace shell and truthful provider-failure
state now have the same three-width coverage. Live source-card evidence remains PARTIAL
until `degenaration-discord-marketplace-parity.sql` is applied and the bridge is available.

## Coverage policy

- Similar-looking forms remain separate rows when their controls or state transitions
  differ.
- A truthful unavailable state is preferable to a fabricated metric or zero.
- UI existence cannot close a row whose persistence, authorization, worker behavior, or
  financial calculation is unverified.
- Reference conflicts are resolved in favor of DegenAration safety requirements and
  original identity, with the conflict recorded rather than hidden.
