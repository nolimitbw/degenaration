# Discord listener — deployment evidence

Written 2026-08-05. Nothing was signed or broadcast; `mainnet_execution_enabled` is `false`
throughout.

## The listener now running

Railway project `degenaration-bot`, service `degenaration-bot`, environment `production`.
Source `nolimitbw/degenaration` @ `claude/continue-codex-unfinished-2026-08-02`, root
`server/bot`, deployment `db1842ea` from commit **`61f9f09`**.

```
[bot] logged in as DegenAration#9645
[bot] removed 5 stale global command(s)
[bot] 6 slash commands ready in SLPR DEGEN
[bot] 6 slash commands ready in DegenAration
[bot] watching 2 approved channel(s)
```

No secret value appears in the logs.

## A false positive I recorded and then corrected

The first successful deployment (`b8b169bd`) logged `[bot] build degenaration-bot-embed-v1`
and I reported it as running the embed fixes. **It was not.** `BOT_BUILD` is an environment
variable I had set myself minutes earlier, so it described my intent rather than the code.

The build was commit `2f03090` from 2026-07-29 — a week old. Two facts proved it:

- it logged **5** slash commands, and its `COMMANDS` array has five entries, missing
  `TEST_CALL_COMMAND`;
- `git show 2f03090:server/bot/parser.js | grep -c "component\|attachment"` returns **0**.

A build marker that is settable from the environment cannot evidence a code version. The
commit hash and a behaviour that only the new code produces can, which is why the count of
registered commands is the check used here: 5 means the old build, 6 means `61f9f09`.

## Command reconciliation (spec §15)

| Question | Answer |
|---|---|
| Six in source, five registered — which was missing? | **`/test-call`**. It was absent from the deployed week-old build, not lost during registration. |
| Were there stale duplicates? | **Yes — five stale GLOBAL commands**, now removed. A global and a guild command of the same name both appear in Discord's picker, which is how duplicate `/register` was visible. |
| Is `/register` unique now? | **Yes.** One definition, published guild-scoped only. `client.application.commands.set([])` clears the global scope; `guild.commands.set()` bulk-replaces per guild, so re-running cannot accumulate. |

## Duplicate-ingestion safety while two listeners run

`degencalls` on Render is still connected to the same two guilds and has NOT been retired,
by instruction. Both listeners can therefore see the same message. That cannot double-trade:

- `app_private.raw_signals` is keyed on `source_ref` = `discord:<guild>:<channel>` plus
  `external_event_id`, and the ingest RPC is idempotent on it;
- a `content_hash`-anchored unique index closes the case where `external_event_id` is null.

`degencalls` has forwarded nothing in its lifetime (`ingestion.attempts: 0` against
`quarantined: 50`), so in practice only one listener is producing events at all.

**Retirement plan, to run only after the new listener processes one real automated call:**
compare both health surfaces for the same message id, confirm the new listener journaled it,
then stop the Render service. Retire nothing before that, because `degencalls` also performs
guild profile sync (53/61 successes) and approved-channel refresh (21,337/21,341) which the
new listener must be shown to cover first.

## Journal state at handover

`raw_signals` = 1 — a **delete** event, `discord:1520209045544374342:1521876069693526158`,
persisted with `deleted_at` set and journaled by parser `discord-v3` as
`rejected / "source message deleted"`. History preserved rather than erased. It proves the
write path end to end; what has never arrived is a call embed.

`calls` = 1, the 2026-07-18 `/alpha` entry, `last_scanned_at` null.

Until a real automated embed arrives, every surface shows a truthful state — Monitoring,
Collecting data, Insufficient history — and no metric is fabricated.
