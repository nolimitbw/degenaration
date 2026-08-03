/**
 * Server-side withdrawal idempotency.
 *
 * Step 4 of docs/ai/ACCOUNTING_MODEL.md. Before this, withdrawalIdempotencyKey() built a key,
 * the route returned it, and nothing consumed it -- there was no store of used keys, so it
 * prevented nothing. lib/withdrawal.js says so in its own comment. The only real bounds on a
 * double withdrawal were a disabled submit button and the user having to sign each transfer,
 * neither of which survives a retried fetch, a duplicated request, or two tabs.
 *
 * The server is non-custodial and cannot broadcast anything, so the protection it can offer
 * is to refuse to BUILD a second transaction for a request already in flight, and to record
 * the signature of the one it did build. Both are asserted here against real PostgreSQL.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const walletSql = await readFile(`${repo}/supabase/degenaration-wallet-registration.sql`, "utf8");
const intentsSql = await readFile(`${repo}/supabase/degenaration-withdrawal-intents.sql`, "utf8");
const withdrawSql = await readFile(`${repo}/supabase/degenaration-user-withdrawals.sql`, "utf8");
const fanoutSql = await readFile(`${repo}/supabase/degenaration-trade-intent-fanout.sql`, "utf8");

const stateRpc = withdrawSql.slice(
  withdrawSql.indexOf("create or replace function public.app_user_withdrawable_state("),
  withdrawSql.indexOf("revoke execute on function public.app_user_withdrawable_state")
);

const FIXTURE_TABLES = ["app_private.app_users", "app_private.trade_intents"];

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;

  create function app_private.admin_secret_ok(p_secret text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_secret is not null and p_secret = 'wd-test-secret' $$;

  create function app_private.ensure_app_user(p_privy_user_id text)
  returns void language plpgsql security definer set search_path = ''
  as $$
  begin
    insert into app_private.app_users (privy_user_id) values (trim(p_privy_user_id))
    on conflict (privy_user_id) do nothing;
  end $$;

  create function app_private.reject_immutable_mutation()
  returns trigger language plpgsql set search_path = ''
  as $$ begin raise exception 'history is immutable' using errcode = '55000'; end $$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);
// is_solana_address lives in the wallet migration and the withdrawal RPCs depend on it. Only
// that function is taken: the rest of the file touches trading_wallets, which this fixture
// deliberately does not create.
await db.exec(walletSql.slice(
  walletSql.indexOf("create or replace function app_private.is_solana_address"),
  walletSql.indexOf("create or replace function public.app_user_upsert_wallet")
));
await db.exec(fanoutSql.slice(0, fanoutSql.indexOf("-- 4. Link the queue row to the intent")));
await db.exec(intentsSql);
await db.exec(stateRpc);
await db.exec(`
  revoke execute on function public.app_user_withdrawable_state(text, text)
    from public, anon, authenticated;
  grant execute on function public.app_user_withdrawable_state(text, text) to service_role;
`);

const SECRET = "wd-test-secret";
const ALICE = "did:privy:alice";
const BOB = "did:privy:bob";
const WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const DEST = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SIG_A = "5".repeat(88);
const SIG_B = "6".repeat(88);
const SOL = 1_000_000_000n;

await db.query("insert into app_private.app_users (privy_user_id) values ($1::text), ($2::text)", [ALICE, BOB]);

const open = (user, amount, dest = DEST, wallet = WALLET) => db.query(
  `select public.app_user_open_withdrawal_intent(
     $1::text, $2::text, $3::text, $4::text, $5::bigint) as r`,
  [SECRET, user, wallet, dest, amount.toString()]
).then((r) => r.rows[0].r);

const sign = (user, id, sig) => db.query(
  "select public.app_user_record_withdrawal_signature($1::text, $2::text, $3::uuid, $4::text) as r",
  [SECRET, user, id, sig]
).then((r) => r.rows[0].r);

const settle = (user, id, outcome, err = null) => db.query(
  "select public.app_user_settle_withdrawal($1::text, $2::text, $3::uuid, $4::text, $5::text) as r",
  [SECRET, user, id, outcome, err]
).then((r) => r.rows[0].r);

const availability = (user) => db.query(
  "select public.app_user_withdrawable_state($1::text, $2::text) as r", [SECRET, user]
).then((r) => r.rows[0].r);

const results = {};

// ---- a durable intent is created, with a server-generated key ---------------------------

const first = await open(ALICE, SOL);
assert.equal(first.ok, true);
assert.equal(first.state, "created");
assert.equal(first.replay, false);
assert.equal(first.amountLamports, "1000000000");
assert.equal(first.destination, DEST);
assert.ok(first.id && first.correlationId);
assert.match(first.idempotencyKey, /^withdraw:did:privy:alice:/,
  "the key is derived server-side from the owner and terms, never supplied by the client");
assert.match(first.fingerprint, /^[0-9a-f]{64}$/, "an immutable sha256 request fingerprint");
results.durableIntentCreated = "PASS";

// ---- a retry returns the EXISTING request, it does not build a second -------------------

const retry = await open(ALICE, SOL);
assert.equal(retry.id, first.id, "the same request returns the same withdrawal");
assert.equal(retry.replay, true, "and is flagged as a replay so the route refuses to rebuild");
const rowCount = await db.query(
  "select count(*)::integer n from app_private.withdrawal_intents where owner_privy_user_id = $1::text",
  [ALICE]
);
assert.equal(rowCount.rows[0].n, 1, "one row, not two");
results.retryReturnsExisting = "PASS";

// ---- concurrent duplicates collapse to one ----------------------------------------------

const racers = await Promise.allSettled(Array.from({ length: 6 }, () => open(ALICE, SOL)));
const ids = new Set(racers.filter((r) => r.status === "fulfilled").map((r) => r.value.id));
assert.equal(ids.size, 1, "six concurrent identical requests produce exactly one withdrawal");
results.concurrentDuplicatesCollapse = "PASS";

// ---- a pending withdrawal reduces what else may be withdrawn ----------------------------

const avail = await availability(ALICE);
assert.equal(
  avail.pendingWithdrawalLamports, "1000000000",
  "THE FIX: an unsettled withdrawal is now deducted, so a second request cannot be approved " +
  "against lamports the first is about to spend"
);
results.pendingWithdrawalDeducted = "PASS";

// ---- a different amount or destination is a different withdrawal ------------------------

const other = await open(ALICE, 2n * SOL);
assert.notEqual(other.id, first.id, "a different amount is a different request");
assert.equal(other.replay, false);
const otherDest = await open(ALICE, SOL, "3nCFXtLSmw3vTKp7hGL1DZmDLBvUuVDQ8s9y4Ae1n6Ra");
assert.notEqual(otherDest.id, first.id, "a different destination is a different request");
assert.equal(
  (await availability(ALICE)).pendingWithdrawalLamports, "4000000000",
  "all three pending withdrawals are counted"
);
results.distinctTermsAreDistinctWithdrawals = "PASS";

// ---- the signature is persisted, once -----------------------------------------------------

const signed = await sign(ALICE, first.id, SIG_A);
assert.equal(signed.ok, true);
assert.equal(signed.duplicate, false);
assert.equal(signed.state, "submitted");

const signedAgain = await sign(ALICE, first.id, SIG_A);
assert.equal(signedAgain.duplicate, true, "re-posting the same signature is idempotent");

const conflicting = await sign(ALICE, first.id, SIG_B);
assert.equal(conflicting.ok, false);
assert.equal(conflicting.status, 409);
assert.match(conflicting.error, /different transaction signature/i,
  "two signatures for one intent means two broadcasts — the thing this prevents");
results.signaturePersistedOnce = "PASS";

// ---- the recorded signature and the agreed terms are immutable ---------------------------

await assert.rejects(
  () => db.query("update app_private.withdrawal_intents set amount_lamports = 1 where id = $1::uuid", [first.id]),
  /terms are immutable/i
);
await assert.rejects(
  () => db.query("update app_private.withdrawal_intents set destination_address = $2::text where id = $1::uuid",
    [first.id, "3nCFXtLSmw3vTKp7hGL1DZmDLBvUuVDQ8s9y4Ae1n6Ra"]),
  /terms are immutable/i
);
await assert.rejects(
  () => db.query("update app_private.withdrawal_intents set tx_signature = $2::text where id = $1::uuid",
    [first.id, SIG_B]),
  /signature is immutable/i
);
results.termsAndSignatureImmutable = "PASS";

// ---- no second withdrawal may claim the same signature -----------------------------------

await assert.rejects(
  () => sign(ALICE, other.id, SIG_A),
  /duplicate key|unique/i,
  "one signature belongs to one withdrawal, globally"
);
results.signatureGloballyUnique = "PASS";

// ---- a signed withdrawal must be reconciled, not failed ----------------------------------

const refusedFail = await settle(ALICE, first.id, "failed", "provider timeout");
assert.equal(refusedFail.ok, false);
assert.equal(refusedFail.status, 409);
assert.match(refusedFail.error, /reconciled against the network/i,
  "lamports may already have left; flipping to failed would free capital the chain has taken");
results.signedWithdrawalNeedsReconciliation = "PASS";

// ---- confirmation settles and releases the pending deduction -----------------------------

const confirmed = await settle(ALICE, first.id, "confirmed");
assert.equal(confirmed.ok, true);
assert.equal(confirmed.state, "confirmed");
assert.equal(
  (await availability(ALICE)).pendingWithdrawalLamports, "3000000000",
  "a confirmed withdrawal stops being pending — the lamports have left and the on-chain " +
  "balance already reflects them"
);
const settleAgain = await settle(ALICE, first.id, "confirmed");
assert.equal(settleAgain.duplicate, true, "settling twice is idempotent");
results.confirmationReleasesPending = "PASS";

// ---- an unsigned withdrawal may be failed, and that frees the capital ---------------------

const failable = await open(ALICE, 5n * SOL);
const failed = await settle(ALICE, failable.id, "failed", "user cancelled in wallet");
assert.equal(failed.ok, true);
assert.equal(failed.state, "failed");
assert.equal(
  (await availability(ALICE)).pendingWithdrawalLamports, "3000000000",
  "a failed unsigned withdrawal returns its capital"
);
results.failedWithdrawalReleasesCapital = "PASS";

// ---- after settling, the same terms may be requested again -------------------------------

const again = await open(ALICE, SOL);
assert.notEqual(again.id, first.id, "a settled withdrawal does not block an identical later one");
assert.equal(again.replay, false, "the user genuinely may want to send the same amount again");
results.settledTermsMayRepeat = "PASS";

// ---- cross-user access is denied -----------------------------------------------------------

const stolen = await sign(BOB, again.id, SIG_B);
assert.equal(stolen.ok, false);
assert.equal(stolen.status, 404, "another user's withdrawal is not found, not merely refused");
const stolenSettle = await settle(BOB, again.id, "confirmed");
assert.equal(stolenSettle.status, 404);

const bobAvail = await availability(BOB);
assert.equal(bobAvail.pendingWithdrawalLamports, "0", "one user's pending is not another's");
results.crossUserDenied = "PASS";

// ---- validation ------------------------------------------------------------------------------

await assert.rejects(() => open(ALICE, SOL, "0OIl-not-base58"), /invalid destination/i);
await assert.rejects(() => open(ALICE, SOL, DEST, "0OIl-not-base58"), /invalid wallet/i);
await assert.rejects(() => open(ALICE, 0n), /invalid amount/i);
await assert.rejects(() => open(ALICE, -SOL), /invalid amount/i);
const badOutcome = await settle(ALICE, again.id, "whatever");
assert.equal(badOutcome.status, 400);
const badSig = await sign(ALICE, again.id, "   ");
assert.equal(badSig.status, 400);
results.validation = "PASS";

// ---- authorization ----------------------------------------------------------------------------

await assert.rejects(
  () => db.query(
    "select public.app_user_open_withdrawal_intent($1::text, $2::text, $3::text, $4::text, 1::bigint)",
    ["wrong", ALICE, WALLET, DEST]
  ),
  /unauthorized/i
);
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => open(ALICE, SOL), /permission denied/i);
  await assert.rejects(() => sign(ALICE, again.id, SIG_B), /permission denied/i);
  await assert.rejects(() => settle(ALICE, again.id, "confirmed"), /permission denied/i);
  await db.exec("reset role");
}
results.authorization = "PASS";

// ---- complete history --------------------------------------------------------------------------

const history = await db.query(
  "select public.app_user_list_withdrawals($1::text, $2::text, 50::integer) as r", [SECRET, ALICE]
).then((r) => r.rows[0].r);
assert.equal(history.ok, true);
assert.ok(history.withdrawals.length >= 5, "every withdrawal appears in history, settled or not");
assert.ok(history.withdrawals.some((w) => w.state === "confirmed" && w.txSignature === SIG_A));
assert.ok(history.withdrawals.some((w) => w.state === "failed"));
assert.ok(history.withdrawals.every((w) => w.amountLamports && w.destination));
results.completeHistory = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS",
  ...results
}, null, 2));

await db.close();
