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
  // Applied in production, and the file that defines the worker_claim_call_execution body
  // #11 replaces. Without it in the baseline the rollback of #11 has nothing to restore.
  "automation-execution-integrity.sql",
  // Applied in production, and the file that defines the attach_call_execution_intent body
  // #11 replaces.
  "degenaration-trade-intent-fanout.sql",
  // Applied in production, and the file that defines bot_approved_call_channels — the map #12
  // rebuilds on the shared authorization predicate.
  "degenaration-discord-public-profiles.sql",
  // Applied in production, and the file that defines admin_decide_call_channel, which #12
  // replaces to refuse approving a channel on a removed source.
  "public-source-profiles.sql",
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
  {
    n: 10,
    apply: "degenaration-discord-current-return.sql",
    rollback: "10-discord-current-return.sql",
    reapply: ["degenaration-discord-call-performance.sql"],
    note:
      "Adds current-return aggregates beside the peak ones, so the marketplace stops reporting only " +
      "best-case outcomes. Supersedes #4 in full and MUST FOLLOW IT — both replace " +
      "app_public_list_discord_marketplace at arity 4, and applying #10 before #4 leaves #4's body " +
      "installed. Read-only, no DDL, no DML.",
  },
  {
    n: 11,
    apply: "degenaration-bot-entry-limits.sql",
    rollback: "11-bot-entry-limits.sql",
    reapply: [
      "automation-execution-integrity.sql",
      "degenaration-trade-intent-fanout.sql",
      // Inside the package rather than in the baseline: #1 defines attach_call_execution_config,
      // which #11 replaces. Reverse order makes this safe — #11's rollback reapplies #1's body,
      // and #1's own rollback then removes everything #1 added.
      "degenaration-subscriber-config-versioning.sql",
    ],
    note:
      "Enforces maximum open trades, maximum capital, per-token exposure, token cooldown, " +
      "first-call-only, the automatic-entry switch and the emergency stop inside " +
      "worker_claim_call_execution — the one instant capital stops being free. MUST FOLLOW #1: it " +
      "reads subscriptions.subscriber_config_snapshot. Both functions are replaced at unchanged " +
      "arities ((uuid, uuid) and ()), so no overload is created and the rollback needs no explicit " +
      "drop. Adds one nullable column. Rolling back returns seven controls to persisted-but-unenforced " +
      "with nothing surfaced to the user, so prefer rolling forward; see the script header.",
  },
  {
    n: 12,
    apply: "degenaration-registered-channel-authorization.sql",
    rollback: "12-registered-channel-authorization.sql",
    reapply: [
      "degenaration-discord-signal-ingestion.sql",
      "degenaration-discord-edit-retraction.sql",
      "degenaration-discord-public-profiles.sql",
      "public-source-profiles.sql",
    ],
    note:
      "THE SECOND ARITY CHANGE. bot_ingest_discord_signal_v2 goes 17 -> 18 arguments (p_guild_id, " +
      "defaulted so a bot build predating it keeps ingesting), and the 17-argument signature is " +
      "dropped explicitly in BOTH directions. MUST FOLLOW #9, whose body it is built on. Makes the " +
      "journal's gate check the source's approval state — which it never did, while the listener's " +
      "map always had — and refuses to approve a channel on a removed source. Rolling back " +
      "silently restores all three holes; see the script header.",
  },
  {
    n: 13,
    apply: "degenaration-subscription-channel-scope.sql",
    rollback: "13-subscription-channel-scope.sql",
    reapply: ["degenaration-bot-entry-limits.sql"],
    note:
      "Enforces subscriptions.channel_id, which app_user_save_bot has always written and nothing " +
      "ever read — a bot restricted to one channel copied every approved channel of its source. " +
      "MUST FOLLOW #11, whose worker_claim_call_execution body it is a superset of. Same arity " +
      "(uuid, uuid), no DDL, no DML. Rolling back returns the control to persisted-but-unenforced.",
  },
  {
    n: 14,
    apply: "degenaration-current-drawdown-bucket.sql",
    rollback: "14-current-drawdown-bucket.sql",
    reapply: ["degenaration-discord-current-return.sql"],
    note:
      "Adds currentlyDown50 over current_x, because the profile row labelled \"Down 50%+\" was " +
      "counting peak_x < 0.5 — calls that never recovered half the entry, not calls that are down " +
      "half. A call that opened flat and fell 78% reported 0. Supersedes #10 in full and MUST " +
      "FOLLOW IT; both replace app_public_list_discord_marketplace at arity 4. No DDL, no DML.",
  },
  {
    n: 15,
    apply: "degenaration-exit-reason.sql",
    rollback: "15-exit-reason.sql",
    reapply: ["degenaration-exit-plan-state.sql"],
    note:
      "worker_settle_position_exit cleared pending_exit_kind on settlement before anything read " +
      "it, so nothing recorded WHY a position closed. Captures it into exit_reason on close only. " +
      "MUST FOLLOW #5, which defines the body. Same arity (9), one nullable column, one partial " +
      "index. Rolling back discards reasons already recorded and cannot reconstruct them.",
  },
  {
    n: 16,
    apply: "degenaration-freeze-after-stop.sql",
    rollback: "16-freeze-after-stop.sql",
    reapply: ["degenaration-subscription-channel-scope.sql"],
    note:
      "Enforces stopLoss.freezeAfterStop, which was unimplementable until #15 recorded WHY a " +
      "position closed. Supersedes #13 in full and MUST FOLLOW IT and #15. Same arity " +
      "(uuid, uuid), no DDL, no DML. Rolling back lets a bot re-enter a token that just stopped " +
      "it out while its editor still shows the switch on.",
  },
  {
    n: 17,
    apply: "degenaration-stop-breach-state.sql",
    rollback: "17-stop-breach-state.sql",
    reapply: [],
    note:
      "Adds the durable stop-delay clock. stopLoss.delaySeconds was unenforceable without it: a " +
      "debounce needs to know WHEN the breach started, and holding that in process memory loses " +
      "it on the restart that matters most. Fully additive — one nullable column, one new " +
      "function. MUST be applied BEFORE the worker build that reads it: server/engine/store.js " +
      "selects stop_breached_at and PostgREST answers an unknown column with 400.",
  },
  {
    n: 18,
    apply: "degenaration-admin-revenue.sql",
    rollback: "18-admin-revenue.sql",
    reapply: [],
    note:
      "One new read-only function: platform revenue by period, the confirmed/pending split, " +
      "available-to-withdraw, and the allocation invariant (creator + referral + retained == " +
      "platform fee) reported rather than assumed. Writes nothing, touches no existing object.",
  },
  {
    n: 19,
    apply: "degenaration-auto-reentry.sql",
    rollback: "19-auto-reentry.sql",
    reapply: ["degenaration-freeze-after-stop.sql"],
    note:
      "Enforces `autoReentry`, the one new control section 4 of the release directive adds. " +
      "Distinct from firstCallOnly: that one is about the SIGNAL (any repeat call for a token " +
      "already acted on), this one is about the POSITION LIFECYCLE (a token already traded to " +
      "close). Supersedes #16 in full and MUST FOLLOW IT. Same arity (uuid, uuid), no DDL, no " +
      "DML. Absent reads as ON so an older snapshot is not silently tightened.",
  },
  {
    n: 20,
    apply: "degenaration-worker-liveness.sql",
    rollback: "20-worker-liveness.sql",
    reapply: [],
    note:
      "One new read-only function answering whether a worker is heartbeating. public." +
      "worker_heartbeat had been deployed and never called, so app_private.worker_leases held " +
      "zero rows while the worker ran — and one status document read that zero as proof the " +
      "worker had never started. Fully additive; writes nothing. Rolling it back makes RUN " +
      "fail closed, which is the correct direction.",
  },
  {
    n: 21,
    apply: "degenaration-revenue-withdrawal.sql",
    rollback: "21-revenue-withdrawal.sql",
    reapply: [],
    note:
      "The revenue-withdrawal ledger — a FOURTH money table, deliberately. Reusing " +
      "payout_requests would report creator payouts as company withdrawals and double-count " +
      "the creator allocation trade_executions already removes once. Draws against " +
      "retained_fee_lamports only, so it cannot reach client principal or the creator and " +
      "referral shares. Fully additive: one table, five functions, one trigger; no existing " +
      "object touched. Its rollback REFUSES if any withdrawal is recorded, because that table " +
      "is the only evidence company money moved and under which signature.",
  },
  {
    n: 22,
    apply: "degenaration-dca-placement.sql",
    rollback: "22-dca-placement.sql",
    reapply: [],
    note:
      "Dollar-cost averaging: positions.filled_dca_levels plus worker_record_dca_fill. The " +
      "four dca.* controls were already COUNTED TOWARD REQUIRED CAPITAL and never placed, " +
      "which is the only unenforced control that reserves the user's money. Fully additive: " +
      "one defaulted column, one new function; worker_open_position and " +
      "worker_settle_position_exit are untouched, so no arity change. MUST be applied BEFORE " +
      "the worker build that reads it — store.js selects filled_dca_levels and PostgREST " +
      "answers an unknown column with 400.",
  },
  {
    n: 23,
    apply: "degenaration-discord-scanner-acknowledgments.sql",
    rollback: "23-discord-scanner-acknowledgments.sql",
    reapply: [],
    note:
      "Adds the default-on per-source scanner acknowledgment switch and exposes it through " +
      "the listener's approved-channel map. The rollback restores the prior map body before " +
      "dropping the column, so an incident rollback never leaves the listener RPC broken.",
  },
  {
    n: 24,
    apply: "degenaration-discord-rejected-signals.sql",
    rollback: "24-discord-rejected-signals.sql",
    reapply: [],
    note:
      "Adds a separate authorized journal writer for parser rejections. It can write only " +
      "raw_signals and rejected parsed_signals; it cannot create a canonical call, delivery, " +
      "or trade intent. Fully additive and replay-idempotent.",
  },
  {
    n: 25,
    apply: "degenaration-call-performance-journal.sql",
    rollback: "25-call-performance-journal.sql",
    reapply: [],
    note:
      "Adds the live market-observation writer, monotonic milestone journal, call tracking " +
      "state and source journal statistics. It backfills only the immutable call-time price; " +
      "no historical peak or milestone is inferred. The rollback removes only these additions.",
  },
  {
    n: 26,
    apply: "degenaration-discord-owner-linking.sql",
    rollback: "26-discord-owner-linking.sql",
    reapply: [],
    note:
      "Adds short-lived single-use Discord owner-link sessions, immutable ownership audit " +
      "events, verified source ownership and fail-closed Discord creator allocation. The " +
      "rollback removes only this flow and leaves prior ownership history untouched.",
  },
  {
    n: 27,
    apply: "degenaration-bot-run-readiness.sql",
    rollback: "27-bot-run-readiness.sql",
    reapply: [],
    note:
      "Adds one read-only, service-only RUN preflight for live Discord source approval, " +
      "registered channel scope, duplicate active bots and the current UTC daily entry budget. " +
      "It writes no balances, subscriptions, profiles or journals.",
  },
];
/** The functions whose arity changes — the reason explicit drops exist at all. */
export const ARITY_CHANGES = [
  { fn: "public.worker_open_position", from: 15, to: 16, migration: 5 },
  { fn: "public.worker_settle_position_exit", from: 8, to: 9, migration: 5 },
  { fn: "public.bot_ingest_discord_signal_v2", from: 17, to: 18, migration: 12 },
];
