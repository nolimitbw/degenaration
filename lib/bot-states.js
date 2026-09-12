/**
 * The eight bot states, and which transitions are legal.
 *
 * Section 5 of the release directive names eight: Draft, Validated, Ready, Active, Paused,
 * Exit-only, Error, Archived. The database CHECK has six — draft, active, paused, stopping,
 * archived, error — and that mismatch is the interesting part.
 *
 * WHY THIS IS A PROJECTION AND NOT A MIGRATION
 *
 * Three of the directive's states are not persisted facts. `Validated` and `Ready` are
 * statements about a DRAFT: whether its configuration passes, and whether every readiness
 * check passes. Writing them into the status column would freeze a verdict that goes stale the
 * moment the fee account, the worker or the user's balance changes — a bot stored as "Ready"
 * while the worker is down is a stored lie, and the user would be told to press RUN on
 * something that cannot run.
 *
 * So they are DERIVED, here, from the stored status plus the live readiness verdict. The
 * database keeps facts; this file computes the label.
 *
 * `Exit-only` is the one real gap, and it is honest about it: the stored vocabulary spells it
 * `stopping` — new entries refused, open positions still exiting. Same state, older name. It
 * is projected rather than renamed because renaming a CHECK value is a migration that rewrites
 * rows to gain a synonym, and every worker query would have to change with it.
 *
 * Pure and synchronous, so the whole transition table is testable.
 */

/** What is actually stored. The database CHECK is the authority for this list. */
const STORED = Object.freeze(["draft", "active", "paused", "stopping", "archived", "error"]);

/** What the user sees. Three are derived; the rest map one to one. */
const DISPLAY = Object.freeze({
  draft: "Draft",
  validated: "Validated",
  ready: "Ready",
  active: "Active",
  paused: "Paused",
  stopping: "Exit-only",
  error: "Error",
  archived: "Archived"
});

/**
 * Legal transitions between STORED states. Terminal states have no outgoing edges.
 *
 * `archived` is terminal on purpose and is separately covered by verify:bot-lifecycle's
 * `archivedTerminal` property: an archived bot cannot be restored, because restoring one would
 * resurrect a configuration whose source may since have been removed.
 */
const TRANSITIONS = Object.freeze({
  draft: ["active", "archived", "error"],
  active: ["paused", "stopping", "archived", "error"],
  paused: ["active", "stopping", "archived", "error"],
  // Exit-only never goes back to active directly: the open positions it is draining must
  // finish first, and re-activating over them would let new entries in while the bot is
  // supposed to be winding down.
  stopping: ["archived", "error"],
  error: ["paused", "archived"],
  archived: []
});

function canTransition(from, to) {
  if (!STORED.includes(from) || !STORED.includes(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * The state to show, given what is stored and what readiness says right now.
 *
 * Only a DRAFT is refined. An active bot is Active whatever readiness currently says — its
 * stored status is a fact about the product, and overwriting it with a live verdict would make
 * a running bot appear to change state because the fee account went unready.
 */
function displayState(storedStatus, readiness) {
  const status = STORED.includes(storedStatus) ? storedStatus : "draft";
  if (status !== "draft") return { key: status, label: DISPLAY[status], derived: false };

  if (!readiness || typeof readiness !== "object") {
    return { key: "draft", label: DISPLAY.draft, derived: false };
  }
  if (readiness.ready === true) {
    return { key: "ready", label: DISPLAY.ready, derived: true };
  }
  // Validated means the CONFIGURATION passes — everything the user controls — and only
  // platform-side checks remain. It is the difference between "your form is incomplete" and
  // "you are waiting on us", and collapsing the two is what the old single sentence did.
  const configurationPasses = Array.isArray(readiness.checks)
    && readiness.checks.filter((check) => check.blocking === "user").every((check) => check.ok);
  return configurationPasses
    ? { key: "validated", label: DISPLAY.validated, derived: true }
    : { key: "draft", label: DISPLAY.draft, derived: false };
}

module.exports = { STORED, DISPLAY, TRANSITIONS, canTransition, displayState };
