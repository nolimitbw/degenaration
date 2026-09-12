/**
 * Principal withdrawal: the authoritative locked figure, and the arithmetic built on it.
 *
 * The funds incident of 2026-08-04 was that app_user_withdrawable_state was absent from the
 * deployed edge function, so the withdrawal screen could never obtain a locked figure and
 * showed 0 SOL available against a funded wallet. Redeploying restores the call. This file
 * establishes what that call actually returns, and what the client-side arithmetic does with
 * it, so "the withdrawal path works again" is a measured claim rather than a hopeful one.
 *
 * Two layers are exercised together:
 *   - the RPC, against real PostgreSQL (PGlite), with fixtures generated from the captured
 *     production shape in scripts/lib/production-schema.mjs;
 *   - lib/withdrawal.js, the pure BigInt arithmetic the route and the modal both use.
 *
 * Every case the incident response asked for is covered, INCLUDING the ones that currently
 * fail to be meaningful. Where a required case cannot be satisfied because the product does
 * not track the thing, this file says so out loud instead of asserting something weaker and
 * calling it a pass.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const require = createRequire(import.meta.url);
const {
  REQUIRED_RESERVE_LAMPORTS,
  RENT_EXEMPT_RESERVE_LAMPORTS,
  NETWORK_FEE_RESERVE_LAMPORTS,
  spendableLamports,
  validateWithdrawal,
  percentOfSpendable
} = require("../lib/withdrawal.js");

const repo = process.cwd();
const db = new PGlite();
const withdrawalSql = await readFile(`${repo}/supabase/degenaration-user-withdrawals.sql`, "utf8");

// Only the function, not the raw_signals index that shares the file.
const rpc = withdrawalSql.slice(
  withdrawalSql.indexOf("create or replace function public.app_user_withdrawable_state("),
  withdrawalSql.indexOf("revoke execute on function public.app_user_withdrawable_state")
);

const FIXTURE_TABLES = ["app_private.app_users", "app_private.trade_intents"];

// The RPC reads reserved_lamports, which degenaration-trade-intent-fanout.sql adds along with
// the release trigger. Applying it here keeps this verifier honest about what the deployed
// function will actually see, rather than testing against a shape production will not have.
const fanoutSql = await readFile(`${repo}/supabase/degenaration-trade-intent-fanout.sql`, "utf8");

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;

  -- The 'p_secret is not null and' clause is not decoration and must not be dropped: the
  -- caller does 'if not admin_secret_ok(...) then raise', and 'not NULL' is NULL, which is
  -- not true, so a bare equality returning NULL would let a NULL secret straight through.
  -- Production's admin_secret_ok is null-safe in exactly this way; the stub matches it.
  create function app_private.admin_secret_ok(p_secret text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_secret is not null and p_secret = 'withdrawal-test-secret' $$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);

// Faithful to supabase/degenaration-product-rpcs.sql: the RPC calls this before reading, so
// a first-time user gets a row rather than an error. user_roles is out of scope here.
await db.exec(`
  create function app_private.ensure_app_user(p_privy_user_id text)
  returns void language plpgsql security definer set search_path = ''
  as $$
  begin
    if nullif(trim(p_privy_user_id), '') is null or char_length(p_privy_user_id) > 200 then
      raise exception 'invalid user' using errcode = '22023';
    end if;
    insert into app_private.app_users (privy_user_id) values (trim(p_privy_user_id))
    on conflict (privy_user_id) do nothing;
  end $$;
`);
// Only the intent table's own columns and trigger are needed here; the queue-binding triggers
// belong to verify-trade-intent-fanout.mjs, which owns that surface.
await db.exec(fanoutSql.slice(0, fanoutSql.indexOf("-- 4. Link the queue row to the intent")));
await db.exec(rpc);
await db.exec(`
  revoke execute on function public.app_user_withdrawable_state(text, text)
    from public, anon, authenticated;
  grant execute on function public.app_user_withdrawable_state(text, text) to service_role;
`);

const SECRET = "withdrawal-test-secret";
const ALICE = "did:privy:alice";
const BOB = "did:privy:bob";
const SOL = 1_000_000_000n;

const state = async (user, secret = SECRET) => {
  const { rows } = await db.query(
    "select public.app_user_withdrawable_state($1::text, $2::text) as result",
    [secret, user]
  );
  return rows[0].result;
};

let intentSeq = 0;
/** Goes through the real creator, so reservation is applied by the same code the worker uses. */
async function seedIntent(owner, lamports, opts = {}) {
  intentSeq += 1;
  const key = `intent-${intentSeq}`;
  await db.query(
    `select app_private.open_trade_intent(
       $1::text, $2::text, 'So11111111111111111111111111111111111111112', $3::text,
       'entry', 'solana-mainnet', $4::bigint, null, null, null, null, '{}'::jsonb)`,
    [owner, key, opts.side || "buy", lamports.toString()]
  );
  if (opts.state) {
    await db.query(
      "update app_private.trade_intents set state = $2::text where idempotency_key = $1::text",
      [key, opts.state]
    );
  }
  return key;
}

const results = {};

// ---------------------------------------------------------------------------------------
// 1. A user with available deposited principal and nothing in flight
// ---------------------------------------------------------------------------------------

await db.exec(`insert into app_private.app_users (privy_user_id) values ('${ALICE}'), ('${BOB}')`);

let alice = await state(ALICE);
assert.equal(alice.lockedLamports, "0", "no in-flight buys means nothing is locked");
assert.equal(alice.inFlightIntents, 0);

const balance = 2n * SOL;
let spendable = spendableLamports({ balanceLamports: balance, lockedLamports: 0n });
assert.equal(
  spendable, balance - REQUIRED_RESERVE_LAMPORTS,
  "a clean wallet may withdraw everything except the rent and network-fee reserve"
);
results.availablePrincipal = "PASS";

// ---------------------------------------------------------------------------------------
// 2. A user with a pending trade — the ONLY thing this RPC treats as locked
// ---------------------------------------------------------------------------------------

// Every non-terminal state a buy can occupy. Each is capital committed but not yet gone from
// the wallet, so it must not also be withdrawable.
for (const s of ["created", "validated", "capital_reserved", "quoted", "simulated",
                 "validating", "ready", "claimed", "submitting", "submitted"]) {
  await seedIntent(ALICE, SOL / 10n, { state: s });
}
alice = await state(ALICE);
assert.equal(alice.lockedLamports, (10n * (SOL / 10n)).toString(), "every in-flight buy state locks");
assert.equal(alice.inFlightIntents, 10);
results.pendingTradeLocks = "PASS";

// Terminal and settled states must NOT lock: the lamports have either left the wallet already
// (confirmed/reconciled — the on-chain balance reflects it) or were never spent
// (failed/expired/cancelled/rejected/reversed). Counting them would double-deduct and wrongly
// refuse a legitimate withdrawal. The release is performed by the trigger, not by this list,
// so a state added later without being listed here stays LOCKED rather than silently freed.
const before = BigInt(alice.lockedLamports);
for (const s of ["confirmed", "reconciled", "failed", "expired", "cancelled",
                 "quarantined", "rejected", "reversed"]) {
  await seedIntent(ALICE, 5n * SOL, { state: s });
}
alice = await state(ALICE);
assert.equal(
  BigInt(alice.lockedLamports), before,
  "settled and terminal intents must not lock — the buy either happened or it did not"
);
results.terminalIntentsDoNotLock = "PASS";

// A sell commits tokens, not SOL, so it cannot reduce withdrawable SOL.
await seedIntent(ALICE, 9n * SOL, { side: "sell", state: "submitted" });
assert.equal(
  BigInt((await state(ALICE)).lockedLamports), before,
  "a sell intent must not lock SOL — it spends the token, not the balance"
);
results.sellDoesNotLockSol = "PASS";

// ---------------------------------------------------------------------------------------
// 3. Funds locked in flight are refused, and the refusal explains itself
// ---------------------------------------------------------------------------------------

const locked = BigInt((await state(ALICE)).lockedLamports);
const tightBalance = locked + REQUIRED_RESERVE_LAMPORTS; // exactly nothing free
assert.equal(
  spendableLamports({ balanceLamports: tightBalance, lockedLamports: locked }), 0n,
  "balance fully committed leaves nothing spendable"
);
const refused = validateWithdrawal({
  owner: "11111111111111111111111111111112",
  destination: "11111111111111111111111111111113",
  amountLamports: SOL,
  balanceLamports: tightBalance,
  lockedLamports: locked
});
assert.equal(refused.ok, false);
assert.equal(refused.code, "locked-capital", "a committed balance is a locked-capital refusal, not a feature-disabled one");
assert.match(refused.message, /committed to open positions/i);
assert.equal(refused.lockedLamports, locked, "the exact locked amount is surfaced so the UI can show it");
results.lockedCapitalRefusedWithReason = "PASS";

// ---------------------------------------------------------------------------------------
// 4. A user with no funds — a validation state, never a disabled feature (spec 12.4)
// ---------------------------------------------------------------------------------------

const empty = validateWithdrawal({
  owner: "11111111111111111111111111111112",
  destination: "11111111111111111111111111111113",
  amountLamports: 1000n,
  balanceLamports: 0n,
  lockedLamports: 0n
});
assert.equal(empty.code, "zero-balance");
assert.match(empty.message, /no SOL to withdraw/i);
assert.doesNotMatch(empty.message, /unavailable|approval|locked|permission|enable/i,
  "a zero balance must never read as a permission or availability problem");
results.zeroBalanceIsValidationNotDisabled = "PASS";

// ---------------------------------------------------------------------------------------
// 5. The network-fee and rent reserve
// ---------------------------------------------------------------------------------------

assert.equal(REQUIRED_RESERVE_LAMPORTS, RENT_EXEMPT_RESERVE_LAMPORTS + NETWORK_FEE_RESERVE_LAMPORTS);
assert.equal(RENT_EXEMPT_RESERVE_LAMPORTS, 890880n, "the rent-exempt minimum for a 0-data SOL account");

// At exactly the reserve, and one lamport below it, nothing may move.
assert.equal(spendableLamports({ balanceLamports: REQUIRED_RESERVE_LAMPORTS }), 0n);
assert.equal(spendableLamports({ balanceLamports: REQUIRED_RESERVE_LAMPORTS - 1n }), 0n);
assert.equal(spendableLamports({ balanceLamports: REQUIRED_RESERVE_LAMPORTS + 1n }), 1n);

const belowReserve = validateWithdrawal({
  owner: "11111111111111111111111111111112",
  destination: "11111111111111111111111111111113",
  amountLamports: 1n,
  balanceLamports: REQUIRED_RESERVE_LAMPORTS,
  lockedLamports: 0n
});
assert.equal(belowReserve.code, "below-reserve");

// Max must never spend the reserve.
const maxOf = percentOfSpendable(spendableLamports({ balanceLamports: 3n * SOL }), 100);
assert.equal(3n * SOL - maxOf, REQUIRED_RESERVE_LAMPORTS, "Max leaves exactly the reserve behind");
results.reserveArithmetic = "PASS";

// ---------------------------------------------------------------------------------------
// 6. Cross-account access
// ---------------------------------------------------------------------------------------

await seedIntent(BOB, 7n * SOL, { state: "submitted" });
const bob = await state(BOB);
assert.equal(bob.lockedLamports, (7n * SOL).toString());
assert.notEqual(
  (await state(ALICE)).lockedLamports, bob.lockedLamports,
  "one user's in-flight capital must never appear in another user's locked figure"
);

// The RPC is keyed by owner and has no other selector, so a caller cannot widen it. The
// binding that stops user A asking about user B is in the route, not here: p_privy_user_id
// comes from a verified Privy access token (app/api/product/portfolio/withdraw/route.ts:87),
// never from the request body.
const isolated = await db.query(
  `select public.app_user_withdrawable_state($1::text, $2::text) as a,
          public.app_user_withdrawable_state($1::text, $3::text) as b`,
  [SECRET, ALICE, BOB]
);
assert.notEqual(isolated.rows[0].a.lockedLamports, isolated.rows[0].b.lockedLamports);
results.crossAccountIsolation = "PASS";

// ---------------------------------------------------------------------------------------
// 7. Authorization: the shared secret, and the role grant
// ---------------------------------------------------------------------------------------

await assert.rejects(() => state(ALICE, "wrong-secret"), /unauthorized/i);
await assert.rejects(() => state(ALICE, null), /unauthorized/i);
results.secretRequired = "PASS";

for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(
    () => state(ALICE),
    /permission denied/i,
    `${role} must not be able to execute the RPC even holding a correct secret`
  );
  await db.exec("reset role");
}
await db.exec("set role service_role");
assert.ok(await state(ALICE), "service_role — the identity the edge function uses — may execute it");
await db.exec("reset role");
results.roleGrants = "PASS";

// A user id that is empty or absurdly long is rejected by ensure_app_user before any read.
await assert.rejects(() => state("   "), /invalid user/i);
await assert.rejects(() => state("x".repeat(201)), /invalid user/i);
results.userIdValidation = "PASS";

// ---------------------------------------------------------------------------------------
// 8. Defensive arithmetic: a negative locked figure must not inflate spendable
// ---------------------------------------------------------------------------------------

assert.equal(
  spendableLamports({ balanceLamports: SOL, lockedLamports: -SOL }),
  SOL - REQUIRED_RESERVE_LAMPORTS,
  "a negative locked value from an accounting bug must be floored, not subtracted"
);
assert.equal(
  spendableLamports({ balanceLamports: SOL, lockedLamports: 0n, pendingWithdrawalLamports: -SOL }),
  SOL - REQUIRED_RESERVE_LAMPORTS
);
results.negativeInputsFloored = "PASS";

// ---------------------------------------------------------------------------------------
// 9. Required cases the product cannot currently satisfy — stated, not faked
// ---------------------------------------------------------------------------------------

const notTracked = {};

// A pending withdrawal. spendableLamports() accepts pendingWithdrawalLamports and deducts it
// correctly, but nothing supplies it: app_user_withdrawable_state does not return one, there
// is no withdrawal-intent table, and route.ts:98 calls spendableLamports with only
// { balanceLamports, lockedLamports }. So the parameter is dead in production.
assert.equal(
  spendableLamports({ balanceLamports: 2n * SOL, pendingWithdrawalLamports: SOL }),
  SOL - REQUIRED_RESERVE_LAMPORTS,
  "the arithmetic is correct in isolation..."
);
notTracked.pendingWithdrawal =
  "NOT TRACKED — no withdrawal intent is persisted anywhere, so a second withdrawal " +
  "submitted before the first confirms is bounded only by the on-chain balance.";

// Duplicate withdrawal. withdrawalIdempotencyKey() is returned by the route and consumed by
// nobody; there is no used-key store. lib/withdrawal.js:162 already says so.
notTracked.duplicateWithdrawal =
  "NOT PREVENTED SERVER-SIDE — the idempotency key is generated and discarded. What " +
  "actually bounds it: the modal disables submit in flight, the user signs every transfer, " +
  "and the server holds no keys.";

// Failed withdrawal and reconciliation. The route returns an unsigned transaction and ends
// there; no signature is persisted and no confirmation is reconciled, so a completed
// withdrawal never reaches Deposits & withdrawals.
notTracked.failedWithdrawalRecovery =
  "NOT IMPLEMENTED — no withdrawal record is written, so there is nothing to recover or " +
  "reconcile, and app_private.cash_movements stays empty.";

// Stale or unreconciled deposit. There is no deposit path to be stale: a deposit is the user
// funding their own wallet, and the balance is read live from chain per request.
notTracked.staleDeposit =
  "NOT APPLICABLE — non-custodial. The balance is a live getBalance read, never a cached " +
  "ledger figure, so it cannot go stale relative to chain.";

// ---------------------------------------------------------------------------------------

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS",
  ...results,
  formulasAsImplemented: {
    total_balance: "on-chain getBalance(wallet) — app/api/portfolio/route.ts, no ledger",
    locked_balance: "sum(trade_intents.reserved_lamports) where side='buy' and reserved_lamports > 0; " +
      "release is an explicit trigger write, never an inferred state list",
    pending_trade: "same figure as locked_balance — they are one and the same query",
    pending_withdrawal: "0, always — not tracked",
    available_balance: "max(0, balance - max(0,locked) - max(0,pending) - 15890880)",
    withdrawable_balance: "identical to available_balance",
    tradable_balance: "NOT COMPUTED — /api/swap applies no balance check; the chain rejects " +
      "an overspend at execution"
  },
  invariant: "reconciled principal = available + locked + pending holds at 0 = 0 + 0 + 0; " +
    "no principal is recorded internally at all, so there is no divergence to explain",
  requiredCasesNotSatisfiable: notTracked
}, null, 2));

await db.close();
