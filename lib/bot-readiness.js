/**
 * Can this bot RUN? One ordered list of checks, each with a reason a user can act on.
 *
 * WHAT THIS REPLACES
 *
 * Three strings the release directive names as failed acceptance evidence:
 *
 *     "Configuration passes client validation. Server and scanner checks still apply."
 *     "Activation needs trading enabled"
 *     "Activation needs the execution worker"
 *
 * All three share one defect, and it is not their wording. They were computed on the CLIENT
 * from a frozen constant, so they said the same thing to every user in every state — a user
 * with no wallet, a user with no capital, and a user whose only problem was the fee account
 * all read the identical sentence. A message that cannot vary is not a diagnosis.
 *
 * THE RULE
 *
 * The checks are ORDERED, and RUN shows exactly ONE reason: the first failure. Listing every
 * failure at once reads as a wall and buries the one the user can fix now; and several later
 * checks are not even meaningful until the earlier ones pass (there is no point costing capital
 * against a wallet that is not connected).
 *
 * Ordering runs from "the user can fix this in the next ten seconds" to "the operator must do
 * something". A user must never be shown a platform blocker while their own form is incomplete,
 * because they would wait for us when the fix was theirs.
 *
 * FAIL CLOSED. An unknown fact is a failure, never a pass. `undefined` for "is the worker
 * alive" means we could not tell, and activating a bot on a fact we could not establish is the
 * exact shape of every defect this project has spent its time removing.
 *
 * Pure. No I/O, no environment, no clock beyond what is passed in — so the whole table is
 * testable in the synchronous runner, and the route stays a thin fact-gatherer.
 */

/**
 * Ordered. Each check gets the facts object and returns:
 *   true            pass
 *   a string        the one precise, fixable reason shown next to RUN
 *
 * `blocking: "user"` means the person looking at the screen can fix it; `"operator"` means
 * they cannot, and the copy must not imply otherwise.
 */
const CHECKS = [
  {
    id: "authenticated",
    blocking: "user",
    check: (f) => f.authenticated === true || "Sign in to activate a bot."
  },
  {
    id: "configuration",
    blocking: "user",
    // The server's own validation verdict, not the client's. The old copy admitted "server and
    // scanner checks still apply" precisely because the client could not speak for the server;
    // this check IS the server, so the admission is no longer needed.
    check: (f) => f.configurationValid === true
      || (typeof f.configurationError === "string" && f.configurationError
        ? f.configurationError
        : "This configuration is not valid yet.")
  },
  {
    id: "wallet",
    blocking: "user",
    check: (f) => f.walletOwned === true || "Connect the Solana wallet this bot will trade from."
  },
  {
    id: "delegation",
    blocking: "user",
    check: (f) => f.walletDelegated === true
      || "Grant delegated execution to this wallet so the bot can trade without you signing each entry."
  },
  {
    id: "source",
    blocking: "user",
    // Discord only; a KOL bot has a strategy instead and the fact is reported as not-applicable.
    check: (f) => f.sourceApproved === undefined && f.botKind !== "discord"
      ? true
      : f.sourceApproved === true
      || "Choose an approved Discord source. The one selected is no longer approved."
  },
  {
    id: "channel",
    blocking: "user",
    // Enforced again in the claim by app_private.authorized_call_channel. Checked here so the
    // user learns it at activation rather than by watching a bot receive nothing for a week.
    check: (f) => f.channelRegistered === undefined && f.botKind !== "discord"
      ? true
      : f.channelRegistered === true
      || "That channel is not a registered approved channel for this source. Choose another, or select all approved channels."
  },
  {
    id: "duplicate",
    blocking: "user",
    check: (f) => f.duplicateActiveBot === false
      || "You already have an active bot on this source. Pause or archive it first."
  },
  {
    id: "dailyBudget",
    blocking: "user",
    check: (f) => f.dailyBudgetAvailable === true
      || "The daily entry budget is already used. New entries resume at the next UTC reset; exits continue."
  },
  {
    id: "capital",
    blocking: "user",
    check: (f) => {
      if (f.requiredLamports === undefined || f.availableLamports === undefined) {
        return "Your available balance could not be read. Try again in a moment.";
      }
      const required = BigInt(f.requiredLamports);
      const available = BigInt(f.availableLamports);
      if (available >= required) return true;
      const short = required - available;
      return `${lamports(short)} SOL short of the minimum planned capital. Reduce the buy amount, lower maximum open trades, or add funds.`;
    }
  },
  {
    id: "emergencyStop",
    blocking: "user",
    check: (f) => f.killSwitch !== true
      || "Emergency stop is on for this bot. Switch it off to activate."
  },
  // ── from here the user cannot fix it, and the copy must not pretend they can ──────────────
  {
    id: "platformEmergencyStop",
    blocking: "operator",
    check: (f) => f.platformEntriesPaused !== true
      || "New entries are paused platform-wide during an operational incident. Open positions keep exiting."
  },
  {
    id: "worker",
    blocking: "operator",
    // Answered by app_worker_liveness against app_private.worker_leases — the worker's own
    // heartbeat, in the database the trade would be recorded in. Not a client constant, and
    // not this container's /health port, which the app cannot reach.
    check: (f) => f.workerLive === true
      || (f.workerReason === "no worker has ever reported"
        ? "The execution service is not reporting yet. Nothing can be activated until it does."
        : "The execution service stopped reporting. Activation resumes when it recovers.")
  },
  {
    id: "signer",
    blocking: "operator",
    check: (f) => f.signerConfigured === true
      || "Automated signing is switched off. Activation resumes when it is enabled."
  },
  {
    id: "feeAccount",
    blocking: "operator",
    check: (f) => f.feeAccountReady === true
      || "The platform fee account is not ready, so trades cannot be charged correctly yet."
  },
  {
    id: "mainnetPolicy",
    blocking: "operator",
    check: (f) => f.mainnetReleased === true
      || "Automated mainnet entries are not enabled yet. Save the bot and it will be ready when they are."
  }
];

function lamports(value) {
  const sol = Number(value) / 1_000_000_000;
  return sol.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/**
 * Evaluate every check and return the verdict.
 *
 * Every check runs even though only the first failure is shown, because the Admin Console and
 * the tests need the full picture, and because a check that only runs when its predecessors
 * pass never gets exercised.
 */
function evaluateReadiness(facts = {}) {
  const results = CHECKS.map((entry) => {
    let outcome;
    try {
      outcome = entry.check(facts);
    } catch {
      // A check that throws has not established its fact. Fail closed.
      outcome = "This could not be checked. Try again in a moment.";
    }
    return {
      id: entry.id,
      blocking: entry.blocking,
      ok: outcome === true,
      reason: outcome === true ? null : String(outcome)
    };
  });

  const failed = results.filter((result) => !result.ok);
  const first = failed[0] || null;
  return {
    ready: failed.length === 0,
    // Exactly one, always the first. This is what renders next to RUN.
    reason: first ? first.reason : null,
    blocking: first ? first.blocking : null,
    failedCheck: first ? first.id : null,
    checks: results
  };
}

module.exports = { CHECKS, evaluateReadiness };
