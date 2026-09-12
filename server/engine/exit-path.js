/**
 * The store functions the automation worker cannot exit a position without.
 *
 * Kept in its own module so worker.js and the test suite read the SAME list. A list
 * duplicated in a test drifts from the one the process actually enforces, and then the test
 * passes while the guard it claims to cover no longer guards anything.
 *
 * See docs/adr/ADR-001-worker-deployment.md, action item 4.
 */
const EXIT_PATH_REQUIREMENTS = [
  // Capture: a confirmed buy becomes a monitorable position.
  "loadSubmittedExecutions", "settleCallExecution", "openPosition",
  // Exit: that position can be evaluated, claimed exactly once, and settled.
  "loadOpenPositions", "claimPositionExit", "recordPositionExitSig", "settlePositionExit"
];

/** Which requirements this store is missing. Empty means the path is wired. */
function missingExitPath(store) {
  return EXIT_PATH_REQUIREMENTS.filter((name) => typeof store?.[name] !== "function");
}

module.exports = { EXIT_PATH_REQUIREMENTS, missingExitPath };
