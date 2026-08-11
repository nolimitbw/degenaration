# Verdict — REDESIGN

**13/30, with principle #6 (honest) at 0 — a load-bearing failure. The workspace lets a funded
user configure, review and save a copy-trading bot that cannot trade, while quoting a 2.00% fee
the platform does not charge and showing performance columns for calls it never priced.**

The rule is mechanical: total below 20, and a zero on honesty. This is not a styling verdict.
The structure itself asserts a working product, and that assertion is what has to be redesigned.

## Why redesign, not refine

The previous pass (`530549b`) fixed how the product *looks* — labels, type, rules, accent
discipline — and moved nothing on what it *claims*. It scored 2 on unobtrusive and 0 on honest
in the same audit. A refine pass would keep polishing a surface whose central problem is that it
describes a machine that is switched off.

## The five highest-leverage moves

1. **#6 Honest — make readiness the spine of the interface, not a dismissible banner.**
   Every screen that implies trading must carry the real state from `/api/platform/config`,
   which already computes eleven named checks and currently fails nine. A bot that cannot trade
   must say so where the user is looking at that bot — the builder, the manager row, the
   portfolio — not once at the top of the page.
   Evidence: `components/ReleaseBanner.tsx` (dismissible), `system_flags.mainnet_execution_enabled = false`.

2. **#6 Honest — stop quoting a fee that is not charged.**
   `feeLabel` must derive from `feeAccountSet`, not from `PLATFORM_FEE_BPS`.
   Evidence: live quote `platformFeeBps: 0, feeAccountSet: false` vs UI `2.00%`.

3. **#3 Aesthetic — collapse two type scales into one.**
   18 sizes across Tailwind names and pixel literals. Define six steps as tokens; forbid both
   raw `text-[Npx]` and the legacy names in product code.
   Evidence: `text-xs` ×300 and `text-[12px]` ×194 coexisting; `text-[8px]` ×2 surviving.

4. **#2 Useful + #10 Little — the builder must open on the four decisions that matter.**
   Source, amount, take profit, stop loss. Everything else behind one disclosure.
   Evidence: `BotBuilder.tsx` 1,783 lines / ~60 controls.

5. **#4 Understandable — replace metric jargon with what a trader asks.**
   `Retracted` / `Watching` / `Down 50%+` / `peak / now` → plain phrasing with the honest pairing
   preserved.
   Evidence: shipped column headers, `app/bots/discord/page.tsx`.

## Preserve

- The peak-vs-current pairing and its value-level gate assertion (`#1`, the one genuine idea here).
- Brand: DegenAration logo, black / gold / warm-white.
- The rules-not-boxes structure and the four text roles from `530549b`.
- Truthful absence: em dash, never a zero.
