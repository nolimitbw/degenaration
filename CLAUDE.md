# CLAUDE.md — degenaration

Auto-trading memecoin platform on Solana. This app moves real money. Correctness,
safety, and honest product states matter more than speed.

## Single source of truth (read these first, every session)

This project is built by **two AI agents — Claude (me) and Codex — sharing one repo.**
To keep us from undoing each other's work, we follow the SAME rules. Those rules live in:

1. **`AGENTS.md`** — the authoritative operating manual for BOTH agents. Read it fully.
2. **`docs/DEGENARATION_MASTER_SPEC.md`** — the authoritative product specification.
3. **`IMPLEMENTATION_STATUS.md`** — current PASS / PARTIAL / FAIL / BLOCKED state.

If anything in this file ever conflicts with `AGENTS.md` or the master spec, **`AGENTS.md`
and the master spec win.** Do not reintroduce patterns they prohibit.

## Brand & design — obey AGENTS.md, not old neon styling

The current, approved identity is **gold, white, and dim-black** (`gold` #f0b429 accent,
near-black surfaces, white primary text, green gains, red losses). See the "Design System
Rules" and "Prohibited AI-Generated Visual Patterns" sections of `AGENTS.md`.

Do NOT use the retired neon look — no toxic-green page washes, gradient text, glowing
blobs, or heavy glassmorphism. If you see leftover neon utilities in old code, treat them
as debt to migrate toward the gold/white/black system, not as the target style.

## How Claude and Codex divide work (avoid collisions)

- **Before editing, look at the working tree** (`git status`, `git diff`). The other agent
  may have uncommitted changes. Never revert, reformat, or delete work you did not make.
- **Keep changes focused and atomic.** Small, coherent commits after verified work so the
  other agent can see what changed and why.
- **Don't fight the spec.** If you believe the master spec is wrong, flag it to the owner
  (per "When to interrupt" below) — do not silently build something different.
- A good split: one agent implements a feature, the other reviews the diff against the
  spec. Either agent can do either role; the shared rules keep the output consistent.

## Autonomy contract (the owner wants to be left alone)

Default to acting, not asking. Work the backlog top to bottom on your own.

- Decide and proceed on anything reversible: which item is next, file structure, copy,
  styling within the gold/white/black system, refactors, test edits, bug fixes. Make the
  sensible choice, log it in `docs/activity-log.md`, keep going.
- Self-verify instead of asking the owner to check. Report what you actually observed.
- Batch, don't ping. Collect anything that genuinely needs the owner into ONE list at the
  end of your turn.

### When to interrupt the owner (the ONLY reasons to stop and ask)

1. Secrets/credentials only they hold — Supabase service key, Privy secret, Helius key,
   host login, `PLATFORM_FEE_ACCOUNT`. Never invent or guess these.
2. Going live with real money — mainnet with real funds, `DELEGATED_SIGNING=on`, or
   anything that lets the engine move actual SOL.
3. Irreversible or outward-facing actions — production deploy, `git push`, deleting files
   you did not create, publishing, spending money.
4. A real fork in product direction, or a material contradiction in the master spec.

## Verify before claiming done (same command Codex uses)

Before reporting completion, run:

```bash
npm run check
```

That runs typecheck + tests + build together. Do not skip a failing command or edit
scripts/tests/type rules to hide a failure. Also exercise the actual page/flow in the
browser for any UI change. See the full "Definition of Done" in `AGENTS.md`.

## Version control

Never auto-commit `docs/activity-log.md` or planning docs. Never `git push`, deploy,
force-push, rewrite history, or run destructive git commands unless the owner explicitly
asks. Review the existing diff before editing.
