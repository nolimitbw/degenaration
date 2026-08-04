---
description: One full DegenAration scan, status update, then straight into the first root-cause fix
---

Perform ONE scan of the repository and then start fixing. The failure mode this command exists
to prevent is scanning repeatedly and never implementing.

Scan these areas once, recording evidence as you go:

- **Financial** — wallet registration, principal accounting, available/locked/pending,
  `trade_intents`, `trade_executions`, `positions`, `position_lots`, `position_exits`,
  withdrawal intents, fees, commissions, referral rewards, payouts, reconciliation.
- **Trading** — Discord commands and ingestion, parser, mint validation, routes, scanner
  adapters, filters, KOL signals, fan-out, quote, simulation, submission, confirmation,
  settlement, retries, duplicate prevention, worker leases, queues.
- **Product** — auth, onboarding, Bots, both marketplaces, bot setup and editing, Affiliate,
  Portfolio, withdrawal, PnL cards, responsive and accessibility behavior, and the
  loading / empty / error / provider states of each.
- **Admin** — authorization, client list, balances, volume, positions, histories, sources,
  health, audit log, incident controls.
- **Release** — tests, migrations, RLS, secrets, dependencies, build, rollback.

The highest-yield thing to look for, because it has been the root cause four separate times:
**a table that several surfaces read and nothing writes.** It fails silently — a left join
renders a dash instead of raising. Check writers before checking readers.

```bash
npm run check                 # the whole suite; exit 0 or nothing else matters
git log --oneline -20         # what changed since the status docs were written
```

Then update `docs/ai/IMPLEMENTATION_STATUS.md`, `docs/ai/OPEN_BLOCKERS.md` and
`docs/ai/RELEASE_CHECKLIST.md` with PASS / PARTIAL / FAIL / BLOCKED. PASS requires
reproducible evidence — a commit, a verifier, a database assertion. Source inspection alone
is never PASS.

Do not stop after updating the documents. Begin the first root-cause fix in the same turn.
