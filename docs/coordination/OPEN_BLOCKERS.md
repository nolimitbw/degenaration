# Open blockers

Only genuine external blockers belong here: missing credentials, unavailable provider
access, or irreversible business decisions. Everything else is implementation work.

## B-1 — `PLATFORM_FEE_ACCOUNT` is not set (blocks fee collection end-to-end)

Every fee path is gated on this env var. When unset, `platformFeeBps` resolves to `0`
and `app/admin/commissions/page.tsx:142` surfaces "Fees are currently disabled in
production". Fee logic, ledger allocation, and tests can all be implemented and verified
against fixtures without it, but **no fee is actually collected in production until the
owner supplies the fee wallet address.**

Required action: owner sets `PLATFORM_FEE_ACCOUNT` to the destination fee wallet.
Impacts release gate: revenue collection. Status: **BLOCKED — owner action.**

## B-2 — Delegated-signing secrets and a worker host

The 24/7 automation worker in `server/` is code-complete and tested but watch-only. It
needs owner-held signing configuration and a host before automated execution can run.
Does not block UI, fee, withdrawal, or journaling work.

Required action: owner supplies signing configuration and selects a host.
Status: **BLOCKED — owner action.**

## B-3 — Mainnet execution authorization

Spec §12 and §13 describe real-money behavior. Development and automated tests remain on
`paper` / `solana-devnet` per §2.11. Enabling `solana-mainnet` requires explicit owner
authorization and controlled review; it will not be enabled autonomously.
Status: **BLOCKED — owner decision, by design.**

## Resolved / not blockers

- **Wallet model for withdrawals.** Determined from code rather than escalated: the
  platform is non-custodial (Privy-provided user-owned wallets; `app/api/withdraw/route.ts`
  states the platform never holds keys). Withdrawals will be implemented as self-service
  user-signed transfers. See `docs/launch/RELEASE_CHECKLIST.md` F-3.
