# Running Claude Code on your Mac

A `CLAUDE.md` cannot give a cloud session access to your machine. Access comes from
running Claude Code **locally**. Then it genuinely has your filesystem and terminal, and
can do the deploy work with you.

## Install

Open Terminal (⌘-Space, type "Terminal"):

```bash
npm install -g @anthropic-ai/claude-code
```

If `npm` is missing, install Node first from nodejs.org (the LTS build), then re-run.

## Get the code onto your Mac

```bash
cd ~/Developer                      # or wherever you keep projects
git clone https://github.com/nolimitbw/degenaration.git
cd degenaration/xzy
npm install
```

Start Claude Code **inside `xzy/`** so it picks up this project's `CLAUDE.md` rather than
degenaration's:

```bash
claude
```

## What it can then do

Everything the cloud session could not: run `openssl` to generate your secrets, run
`curl` against the Telegram API, run `npm run probe:jupiter` against the real Jupiter
endpoint, drive `vercel deploy`, read the `.env` file you create, and see the actual
errors your machine produces.

A good first message:

> Read CLAUDE.md and DEPLOY.md. I want the bot replying to /start. Walk me through
> Layer 1 and do every step you can yourself.

## Permissions

`.claude/settings.json` in this folder pre-approves the commands this project needs —
npm, node, git, curl, openssl, vercel, supabase — so you are not answering a prompt every
thirty seconds. It denies `sudo`, `rm -rf /`, and a few other things that are never part
of this work.

If you want it to stop asking entirely, `/config` → set permission mode, or launch with:

```bash
claude --dangerously-skip-permissions
```

That skips every prompt including ones you would want to see. Reasonable in a repo you
can `git checkout` back; less so when the session is also holding your wallet encryption
key. Your call.

## Secrets stay on your machine

Put real values in `xzy/.env`, which is gitignored. Never paste a bot token, service key,
or `WALLET_ENCRYPTION_KEY` into a chat window — a local Claude Code session can read the
file directly, so there is never a reason to.
