/**
 * The deployment package and its reverse, in one place.
 *
 * WHY THIS FILE EXISTS
 *
 * Every migration in the package carried a rollback in its header, as prose. None had ever
 * been executed. Running them found that the documented rollback for #5 is broken:
 *
 *   degenaration-exit-plan-state.sql widens worker_open_position from 15 to 16 arguments
 *   and worker_settle_position_exit from 8 to 9. Its header says "Rollback: reapply those
 *   two files" — but `create or replace function` at a DIFFERENT arity creates an
 *   OVERLOAD, it does not replace. Reapplying the predecessors therefore leaves BOTH
 *   arities installed, and the worker's own 15-argument call then fails with
 *
 *       function public.worker_open_position(...) is not unique
 *
 *   This is the identical defect the forward migration was already fixed to avoid, and it
 *   is worse in reverse: a rollback runs during an incident, so backing the change out
 *   would leave the worker unable to open OR settle any position, with no further rollback
 *   available to recover.
 *
 * So rollback is no longer prose. Each entry below names an executable script that removes
 * what the migration ADDED — including, for #5, the widened arities, dropped BEFORE the
 * predecessors recreate the narrow ones — followed by the predecessor files to reapply for
 * the function bodies a script cannot restore on its own.
 *
 * `npm run verify:migration-rollback` applies the package in order, rolls it back in reverse
 * through these entries, and asserts the catalog is byte-identical to the pre-package
 * baseline, then re-applies to prove the rollback left the package installable again.
 */

/**
 * Files already applied in production, in the order production applied them. This is the
 * baseline a rollback must return to, so the order matters: buy-settlement and
 * copy-execution-integrity both define worker_load_submitted_executions, and
 * copy-execution-integrity is the later of the two (b15e66b follows c6ca8d6), so it is the
 * one whose body production is actually running.
 */
export const BASELINE = [
  "degenaration-position-exit-state.sql",
  "degenaration-buy-settlement.sql",
  "degenaration-copy-execution-integrity.sql",
  "degenaration-position-bot-attribution.sql",
  "degenaration-discord-public-profiles.sql",
  "degenaration-admin-client-ledger.sql",
  "degenaration-withdrawal-intents.sql",
  // Applied in production, and the file that defines the body #8 replaces. It has to be in
  // the baseline for the rollback of #8 to have anything to restore.
  "degenaration-signal-fanout.sql",
  // Applied in production, and the file that defines the body #9 replaces.
  "degenaration-discord-signal-ingestion.sql",
];

/**
 * Apply in ascending `n`. Roll back in descending `n`: run `rollback`, then reapply every
 * file in `reapply`, in the order given.
 */
export const PACKAGE = [
  {
    n: 1,
    apply: "degenaration-subscriber-config-versioning.sql",
    rollback: "01-subscriber-config-versioning.sql",
    reapply: [],
    note: "Adds a table, 9 columns across 3 tables, 9 functions, 11 triggers. Fully additive; the rollback drops exactly those. Must be applied BEFORE the worker starts — server/engine/store.js selects three of its columns.",
  },
  {
    n: 2,
    apply: "degenaration-bot-lifecycle-safety.sql",
    rollback: "02-bot-lifecycle-safety.sql",
    reapply: [],
    note: "Two guard triggers and a unique index. Nothing it creates holds data, so the rollback is unconditional.",
  },
  {
    n: 3,
    apply: "degenaration-discord-marketplace-parity.sql",
    rollback: "03-discord-marketplace-parity.sql",
    reapply: ["degenaration-discord-public-profiles.sql"],
    note: "Replaces app_public_list_discord_marketplace at the SAME arity (4), so create-or-replace genuinely replaces. No DDL, no DML.",
  },
  {
    n: 4,
    apply: "degenaration-discord-call-performance.sql",
    rollback: "04-discord-call-performance.sql",
    reapply: ["degenaration-discord-marketplace-parity.sql"],
    note: "Supersedes #3 in full and must follow it. Same arity again, so rollback is a reapply of #3.",
  },
  {
    n: 5,
    apply: "degenaration-exit-plan-state.sql",
    rollback: "05-exit-plan-state.sql",
    reapply: [
      "degenaration-position-exit-state.sql",
      "degenaration-buy-settlement.sql",
      "degenaration-copy-execution-integrity.sql",
      "degenaration-position-bot-attribution.sql",
    ],
    note:
      "THE ONE WITH THE ARITY CHANGE. Must follow #1 (it reads call_executions.subscriber_config_snapshot). " +
      "Its rollback script drops the 16-arg and 9-arg functions first; without that the reapply below leaves " +
      "duplicate arities and every worker call raises 'function is not unique'. The reapply list is the full " +
      "set of baseline files defining what #5 replaces, in baseline order — worker_load_submitted_executions " +
      "in particular must be restored by copy-execution-integrity, because #5's version reads " +
      "call_executions.subscriber_config_snapshot and rolling #1 back afterwards drops that column.",
  },
  {
    n: 6,
    apply: "degenaration-admin-client-volume-periods.sql",
    rollback: "06-admin-client-volume-periods.sql",
    reapply: ["degenaration-admin-client-ledger.sql"],
    note: "Read-only RPC replaced at the same arity (3). Rollback loses only the added response fields.",
  },
  {
    n: 7,
    apply: "degenaration-withdrawal-settlement.sql",
    rollback: "07-withdrawal-settlement.sql",
    reapply: ["degenaration-withdrawal-intents.sql"],
    note: "Adds the cash_movements writer, one new function and one unique index. Movements already written survive the rollback and stay correct.",
  },
  {
    n: 8,
    apply: "degenaration-signal-fanout-source-ref.sql",
    rollback: "08-signal-fanout-source-ref.sql",
    reapply: ["degenaration-signal-fanout.sql"],
    note:
      "Fixes the join that made fan-out resolve no source for any real ingested call. Same arity (1), " +
      "no DDL, no DML. Independent of 1-7 — it may be applied alone. Rolling it back restores a silent " +
      "total failure of subscriber fan-out, so prefer rolling forward; see the script header.",
  },
  {
    n: 9,
    apply: "degenaration-discord-edit-retraction.sql",
    rollback: "09-discord-edit-retraction.sql",
    reapply: ["degenaration-discord-signal-ingestion.sql"],
    note:
      "Defers the edit-supersede UPDATE until the parse status is final, so an edit refused by the " +
      "same-token cooldown no longer retracts the call it was replacing while reporting that nothing " +
      "happened. Same arity (17), no DDL, no DML. Independent of 1-8. Calls already retracted by the " +
      "old behaviour cannot be restored by the rollback; production has none.",
  },
];

/** The two functions whose arity changes — the reason explicit drops exist at all. */
export const ARITY_CHANGES = [
  { fn: "public.worker_open_position", from: 15, to: 16, migration: 5 },
  { fn: "public.worker_settle_position_exit", from: 8, to: 9, migration: 5 },
];
