# Discord application commands

Registry: `server/bot/index.js` (`COMMANDS`). Automated check:
`npm run check:discord-commands`. Spec: `FINAL_LAUNCH_SPEC.md` §15.

## Why `/register` appeared twice

Commands are published **guild-scoped** through `guild.commands.set()`. That call bulk-
replaces only the *guild* command list — it never touches the *global* list. Any command
registered globally by an earlier deployment therefore kept being served alongside the
guild copy, and the Discord client rendered both.

The fix is `clearGlobalCommands()` on `ready`, which empties the global scope once at
startup. `check-discord-commands.mjs` fails the build if guild-scoped deployment is ever
reintroduced without that cleanup, or if both scopes publish the same set.

## Published set

| Command | Purpose | Permission | Response |
|---|---|---|---|
| `/register` | Submit this channel as a call source for approval | Manage Guild | ephemeral |
| `/alpha <token>` | Record an explicit call in an approved channel | any member of an approved channel | ephemeral |
| `/test-call <token>` | Check that the scanner can parse a token. **Never trades.** | Manage Guild | ephemeral |
| `/degen status` | Registration and approval state | any | ephemeral |
| `/degen profile` | Public performance profile link | any | ephemeral |
| `/degen referral` | This server's assigned referral link | any | ephemeral |
| `/degen callers` | Most active recorded callers | any | ephemeral |
| `/onboard` | Setup steps | any | ephemeral |
| `/help` | Command list | any | ephemeral |

All replies are ephemeral — the bot never posts publicly into a community's channels.

## Removed

**`/degen channel-add`** — it routed to the same handler as `/register` and performed an
identical action. Two published ways to do one thing is the overlap §15.2 prohibits.
`/register` is the single entry point.

## `/test-call` guarantees

It parses input and reports the mint, parser confidence, and whether the channel is
approved. It does not ingest a signal, create a trade intent, or submit a swap. The
registry check greps its handler body and fails if it ever reaches `ingestCall`,
`buyToken`, `sellToken`, or `executeBuy`.

## What the automated check enforces

1. No duplicate top-level command names
2. `/register` declared exactly once
3. Every command has a description
4. Exactly one deployment scope — never both guild and global
5. Guild-scoped deployment clears stale global commands
6. Every published command has exactly one handler, and no handler exists for an
   unpublished command
7. `/test-call` performs no trade or ingest
8. No subcommand collides with a top-level command name

## Deployment

Commands sync on `ready` for every cached guild and on `guildCreate` for new installs.
Deployment is bulk-replace, so removing a command from `COMMANDS` withdraws it from
Discord on the next start.

**Unverified:** the global-scope cleanup is correct by construction and covered by the
static check, but it has not been observed against a live Discord application — that
requires running the bot with production credentials. Confirm the duplicate `/register`
is gone in the client after the next worker deploy.
