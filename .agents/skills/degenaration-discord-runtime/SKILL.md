---
name: degenaration-discord-runtime
description: Enforces DegenAration Discord.js Gateway ingestion, approved-channel authorization, message-shape normalization, immutable/versioned call journaling, idempotent acknowledgments, command deployment, and runtime health. Use whenever Discord events, parsers, channel registration, scanner replies, Gateway reconnects, or bot deployment are changed.
---

# DegenAration Discord runtime

Read `docs/launch/FINAL_LAUNCH_SPEC.md` sections 9, 10, and 15 and
`docs/coordination/AI_HANDOFF.md` before changing the bot.

## Trace one chain

Follow one real event through:

```text
Gateway event -> exact guild/channel authorization -> raw immutable event
-> normalized message fields -> mint candidates -> on-chain validation
-> canonical versioned call -> baseline snapshot -> durable fan-out
-> optional idempotent acknowledgment
```

Find the first empty or rejected persisted stage. Do not infer scanner health from a table
unless runtime code actually writes that table.

## Ingestion rules

- Authorize the exact active and approved `(guild_id, channel_id)` pair before creating a
  canonical call or trade intent. Persist a truthful diagnostic reason for every rejection.
- Accept human, bot, and webhook messages. Ignore only this application itself.
- Normalize content, every embed field, URLs, action-row links, attachments, and referenced
  messages before extracting candidates. Fetch Discord partials when possible.
- Handle create, update, and delete. Deduplicate by guild/channel/message, version edits,
  and preserve retraction history.
- Reject multiple plausible mints as `ambiguous_mint`; never guess or trade.
- Validate the selected mint and route on chain before eligibility.

## Acknowledgments

Reply only after the accepted call version is durably committed. Use a database-backed
idempotency key per message/version so reconnects and replays cannot duplicate replies.
Never acknowledge an unregistered or rejected call as journaled, and never react to the
application's own acknowledgment.

## Commands and deployment

Keep one command registry and one production scope. Bulk-replace stale commands, verify
uniqueness after deployment, and ensure `/test-call` cannot create an execution intent.
Before switching a listener deployment, prove its build SHA, credentials readiness,
heartbeat, registered-channel refresh, and single-listener authority. Do not broadcast a
funded mainnet transaction without explicit owner approval.

## Evidence

Require targeted tests for message shapes, wrong-channel rejection, ambiguity, edit/delete,
replay, duplicate acknowledgment, and fan-out. Then run:

```bash
npm run verify:discord-ingestion
npm run verify:discord-replay
npm run verify:registered-channel
npm run verify:pipeline-e2e
npm run check:discord-commands
```

Production completion additionally requires a journal/database assertion, bot heartbeat,
one registered-channel call, exactly one acknowledgment, and deployed SHA verification.
