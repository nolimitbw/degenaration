# Degenaration — Security Self-Audit

A candid review of the current code. **Green** = already safe. **Fix before real money** =
must be done before mainnet/public launch. This is a self-audit, NOT a substitute for an
independent professional review (still required — see GO-LIVE.md Phase E).

## Green (already done right)

- **Non-custodial by design.** No private keys anywhere in the codebase. The user's wallet
  signs; the platform only builds unsigned transactions. This is the single most important
  property and it holds.
- **Secrets isolated.** Real keys live in `.env.local` / `server/.env`, both gitignored.
  Only `NEXT_PUBLIC_*` values (safe to expose) reach the browser. `PLATFORM_FEE_ACCOUNT`
  is read server-side only.
- **Database Row Level Security.** Every user table (profiles, subscriptions, trades) has
  RLS so a user can only read/write their own rows, enforced by Postgres, not the app.
- **Untrusted-input discipline.** The Discord parser only ever extracts base58 addresses,
  never executes message content, and ignores ambiguous/oversized messages (tested).
- **Rug-check gate.** Every auto-buy is screened for liquidity, mint/freeze authority, and
  risk score before execution.

## Fixed (implemented + tested)

- **[DONE] Rate-limiting on all API routes.** Per-IP limiter in `lib/server/guard.ts`
  applied to price/quote/rugcheck/swap. Verified: rapid calls return HTTP 429.
- **[DONE] `/api/swap` requires authentication.** Rejects requests without a Bearer token
  (HTTP 401). The client sends the Supabase session token.
- **[DONE] Input validation + bounds.** Mints must be valid base58; amounts must be positive
  integers within a max; slippage capped at 20%; swaps with >15% price impact rejected.
  Verified: bad mint → 400, negative amount → 400.

## Fix before real money (still open)

1. **Verify session-key scope in Privy.** Confirm the delegated signer is limited to swap
   instructions with a spend cap, and can never sign a transfer/withdraw. Test that revoking
   permission actually stops trading.
4. **Validate all trade inputs server-side.** Enforce max amount, allowed mints, and the
   user's daily cap in the API/engine — never trust values sent from the client.
5. **Idempotency on trades.** Guard against a call being executed twice (dedupe on Discord
   message id) so a retry can't double-spend.
6. **Slippage & sanity bounds.** Reject quotes with excessive price impact before signing.
7. **Audit log.** Write every automated action to `trades` (schema supports it) so anything
   unexpected is traceable.
8. **Secrets rotation.** The Discord bot token was shared in a chat during setup — rotate it
   in the Discord Developer Portal before going public, and never paste tokens anywhere again.

## Do not skip

- Independent security review before mainnet.
- Legal review of Terms / Risk Disclosure for your jurisdiction (GO-LIVE.md Phase F).
- Start on devnet, then tiny real amounts, then a small closed group — never straight to public.
