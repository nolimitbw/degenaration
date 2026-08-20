# Xzy — Telegram Edition Build Plan

Status: **SUPERSEDED — kept as the record of how Xzy was scoped.**

Xzy was built and now lives in its own repository: **https://github.com/nolimitbw/XZY**.
Nothing about it remains in this repo. This document is the plan it started from, not a
description of what shipped; where the two disagree, the code in that repository is
authoritative.

What changed from this plan: the trading engine was written fresh rather than vendored
from degenaration, so the "vendoring discipline" section below never applied.

Owner decisions locked in this plan:

| Question | Decision |
| --- | --- |
| User surface | Telegram bot **+ Telegram Mini App** |
| Repo | **Separate repo**, forked from degenaration |
| Call sourcing | Channels **list themselves in the Mini App**; listed channels are the copyable sources |

---

## 1. What Xzy is

Degenaration copies calls from **Discord** channels. Xzy copies calls from **Telegram**
channels. Same engine, same money-handling rules, different ingestion surface and a
Telegram-native front end.

A user's whole loop lives inside Telegram:

1. Opens `@xzyofficialbot`, gets a wallet.
2. Opens the Mini App, browses the **channel marketplace** — Telegram channels that have
   listed themselves, ranked by verified call performance.
3. Subscribes to one or more channels with a per-channel budget and risk filters.
4. When a listed channel posts a Solana mint, Xzy buys for every subscriber whose filters
   pass, then manages TP/SL until exit.

## 2. The listing model (how calls get in)

A Telegram bot **cannot read a channel it has not been added to.** There is no API for it.
That constraint shapes the whole product, and the marketplace turns it into an advantage:
sources have to opt in, and opting in is what earns them referral revenue.

**Listing flow, from the channel owner's side:**

1. Owner opens the Mini App → "List my channel".
2. Mini App tells them to add `@xzyofficialbot` as an admin of their channel.
3. Bot receives a `my_chat_member` update the moment it is promoted. That update carries
   the chat ID, title, and **who promoted it** — which is our ownership proof. No separate
   verification code needed.
4. Channel appears as `PENDING` in the Xzy admin panel.
5. Admin approves. From then on every `channel_post` in that channel is parsed for Solana
   mints and journaled as a call.

**Manual fallback:** `/call <mint>` inside the channel, for owners who want to publish
calls deliberately instead of having every message auto-scraped. Same journal, same
`confidence: slash-command` (10,000 bps) weighting degenaration already uses.

**Explicitly out of scope:** MTProto userbot scraping of channels that have not opted in.
It violates Telegram's ToS, gets the account permanently banned, and the session file is
equivalent to a Telegram account password. Not built, not as an option, not "isolated".

**Trust rule carried over from degenaration:** a channel being *listed* is not a claim that
it is good. The marketplace ranks on **verified post-call performance** measured by our own
scanner from the price at call time — never on the channel's self-reported record, follower
count, or screenshots. A brand-new listing shows "no verified track record", not a zero.

## 3. What forks from degenaration and what gets rewritten

The separate-repo decision means the trading engine is **duplicated, not shared**. That is a
real ongoing cost: a correctness fix in copy execution has to be applied in two places or
one product silently keeps the bug. Mitigation below in §7.

### Forks essentially unchanged

| Path | Why it survives the fork |
| --- | --- |
| `server/engine/*` | copy execution, TP/SL, limits, rugcheck, prices, monitor — all platform-neutral |
| `server/bot/parser.js` | mint extraction from message text; zero Discord coupling |
| `lib/server/guard.ts`, `distributed-rate-limit.ts` | rate limiting, `isMint`, timeouts |
| `lib/server/privy*` | wallet creation and signing |
| Trading API routes | `quote`, `swap`, `price`, `rugcheck`, `portfolio`, `withdraw` |
| Supabase engine tables | `calls`, `positions`, copy subscriptions, ledgers |

### Rewritten for Telegram

| Discord thing | Xzy equivalent |
| --- | --- |
| `discord.js` gateway client | Telegram Bot API **webhook** receiver |
| `/register` slash command | `my_chat_member` promotion event |
| Guild + snowflake IDs | Chat ID (signed int64, negative for channels) |
| `isDiscordSnowflake()` | `isTelegramChatId()` |
| `parser_version: "discord-v3"` | `parser_version: "telegram-v1"` |
| Next.js web app | Telegram Mini App (Next.js, but Telegram-chrome and `initData` auth) |
| Privy web login | Telegram `initData` HMAC verification → Privy server wallet |

### Built new

- Webhook receiver with Telegram's `X-Telegram-Bot-Api-Secret-Token` check.
- Mini App `initData` verification (HMAC-SHA256 against the bot token, with an `auth_date`
  freshness window — this is the entire auth boundary, so it gets its own tests).
- Channel marketplace: listing, admin approval, verified performance ranking.
- In-chat trading UX: inline keyboards for quick-buy presets, position cards, PnL.

## 4. Auth model

This is the part most likely to be got wrong, so it is stated explicitly.

- **Mini App requests** authenticate with Telegram `initData`. The server recomputes the
  HMAC using a key derived from the bot token and rejects anything stale or mismatched.
  `initData` is never trusted client-side.
- **Bot commands** are trusted by `from.id` on a verified webhook update only.
- **Webhook** is verified by secret token header AND by the fact that the URL contains a
  random path segment. Both, not either.
- **Wallets** are Privy server wallets keyed to the Telegram user ID. Same delegated-signing
  gate as degenaration: `DELEGATED_SIGNING` stays off until the owner explicitly turns it on.

Telegram user IDs are the identity anchor. A user changing their @username must not change
their wallet — key on numeric ID, never on username.

## 5. Design

Inherits degenaration's approved identity: **gold `#f0b429`, white text, dim-black surfaces,
green gains, red losses.** No neon page washes, no gradient text, no glow blobs, no heavy
glassmorphism.

Mini App specific: respect Telegram's `themeParams` for the safe areas and header, but keep
the Xzy palette inside the content area rather than adopting the client's theme wholesale —
a copy-trading UI that changes color per client is a UI that hides risk states.

## 6. Phases

Each phase ends green on `npm run check` (typecheck + tests + build) before the next starts.

**Phase 0 — security + scaffold (blocked on owner)**
- Revoke the BotFather token that was exposed in a screenshot. Issue a fresh one.
- Create the `xzy` repo, fork degenaration into it, strip Discord.
- Env: `XZY_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, plus the existing Supabase / Privy /
  Helius / `PLATFORM_FEE_ACCOUNT` set.

**Phase 1 — schema**
- Telegram-shaped source tables: `tg_channels` (chat_id, title, username, owner_tg_id,
  status, approved_at), listing + approval audit.
- Reuse `calls` / `positions` / subscription tables as-is.

**Phase 2 — webhook + ingestion**
- `POST /api/tg/webhook/<random>` with secret-token check.
- `my_chat_member` → auto-list channel as PENDING.
- `channel_post` / `edited_channel_post` → `parseCalls()` → journal → enrich price → dispatch
  to worker. Dedup on `(chat_id, message_id, edit_version)`, mirroring the Discord content
  hash.

**Phase 3 — Mini App shell**
- `initData` auth, wallet creation on first open, balance + deposit QR.
- Channel marketplace list with verified performance columns.

**Phase 4 — trading**
- `/buy`, `/sell`, `/positions`, `/price` in chat with inline keyboards.
- Mini App trade screens reusing the engine's quote/swap routes.

**Phase 5 — copy automation**
- Subscribe to a channel with amount, min liquidity, max mcap, TP/SL.
- Global and per-source spend caps enforced server-side, never client-side.

**Phase 6 — devnet soak, then the money conversation**
- Full loop on devnet with a test channel, over multiple days.
- Mainnet with real funds is an owner decision, made separately, after the soak.

## 7. The duplication tax (accepted, but managed)

Forking means two copies of code that moves real money. To keep them from drifting:

- `server/engine/` is treated as **vendored, not owned** in the Xzy repo. Fixes land in
  degenaration first, then get ported, with the source commit SHA recorded in the port commit.
- A `VENDORED.md` in the Xzy repo lists each vendored path and the degenaration SHA it was
  taken from, so drift is visible instead of silent.
- Anything Xzy-specific goes in `server/xzy/`, never inside a vendored file.

If the porting burden turns out worse than expected, the fallback is extracting the engine
into a shared package — which is the same work as the "one repo" option, just paid later.

## 8. Open items for the owner

1. **Revoke the exposed bot token.** Nothing else starts until this is done.
2. Confirm the repo name and whether it is public or private.
3. Confirm Xzy shares degenaration's Supabase project, or gets its own.
4. Confirm the platform fee account and fee bps for Xzy — same as degenaration or separate.
