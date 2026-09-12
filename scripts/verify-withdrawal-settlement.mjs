/**
 * A withdrawal that finishes.
 *
 * app_user_record_withdrawal_signature moved an intent to `submitted` and nothing moved it
 * further. app_private.cash_movements had NO writer anywhere in the repository — the last
 * table of the authoritative accounting model still in that state — so Portfolio's
 * deposit-and-withdrawal history was structurally empty, admin's withdrawnLamports was
 * permanently zero, and, worst of the three, app_user_withdrawable_state counts `submitted`
 * as pending forever: a user who withdrew 1 SOL permanently lost 1 SOL of headroom against
 * their own funds.
 *
 * The last of those is asserted here against the real withdrawable-state function, not
 * merely against the intent row, because it is the one that costs the user something.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const results = {};
const S = "admin-test-secret";
const A = "did:privy:alice", B = "did:privy:bob";
const SIG = "5".repeat(88);

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.admin_secret_ok(p text) returns boolean
  language sql stable security definer set search_path = ''
  as $x$ select p is not null and p = 'admin-test-secret' $x$;
  -- Provisioning is covered by verify:wallet-registration; here it only has to exist so
  -- app_user_withdrawable_state can call it.
  create function app_private.ensure_app_user(p text) returns void
  language plpgsql security definer set search_path = '' as $x$
  begin insert into app_private.app_users (privy_user_id) values (p)
        on conflict do nothing; end $x$;
`);
// withdrawal_intents has a foreign key to app_users, and cash_movements plus the
// withdrawable-state function read trade_intents. Generated from the captured production
// shapes rather than hand-written, so the fixture cannot drift from what deploys.
const T = ["app_private.app_users", "app_private.trade_intents", "app_private.bot_config_versions"];
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);
await db.exec(`
  alter table app_private.trade_intents
    add column if not exists reserved_lamports bigint not null default 0,
    add column if not exists released_at timestamptz;
  create table if not exists app_private.cash_movements (
    id uuid primary key default gen_random_uuid(),
    owner_privy_user_id text not null,
    wallet_id uuid,
    movement_type text not null,
    status text not null,
    amount_lamports bigint not null,
    network_fee_lamports bigint not null default 0,
    tx_signature text,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now());
`);
await db.query("insert into app_private.app_users (privy_user_id) values ($1::text),($2::text)", [A, B]);
await db.exec(await readFile(`${repo}/supabase/degenaration-withdrawal-intents.sql`, "utf8"));
// Only the withdrawable-state function is needed here; that file also carries unrelated
// signal-ingestion DDL whose tables this fixture has no reason to build.
const withdrawalsFile = await readFile(`${repo}/supabase/degenaration-user-withdrawals.sql`, "utf8");
const fnStart = withdrawalsFile.indexOf("create or replace function public.app_user_withdrawable_state");
const fnEnd = withdrawalsFile.indexOf("$$;", fnStart);
assert.ok(fnStart >= 0 && fnEnd > fnStart, "app_user_withdrawable_state was not found");
await db.exec(withdrawalsFile.slice(fnStart, fnEnd + 3));
await db.exec(await readFile(`${repo}/supabase/degenaration-withdrawal-settlement.sql`, "utf8"));
// Rerun must be a no-op: every deployment is a rerun after a rollback.
await db.exec(await readFile(`${repo}/supabase/degenaration-withdrawal-settlement.sql`, "utf8"));
results.rerunSafe = "PASS";

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const counts = async () => one(`select
  (select count(*)::integer from app_private.cash_movements) movements,
  (select count(*)::integer from app_private.withdrawal_intents) intents`);

const newIntent = async (owner, sig, amount = 1000000000) => (await one(
  `insert into app_private.withdrawal_intents
     (owner_privy_user_id, wallet_address, destination_address, amount_lamports,
      idempotency_key, request_fingerprint, state, tx_signature, submitted_at)
   values ($1::text,'WALLET','DEST',$2::bigint,$3::text,$3::text,
           case when $4::text is null then 'created' else 'submitted' end, $4::text,
           case when $4::text is null then null else now() end)
   returning *`,
  [owner, amount, `key-${sig || owner}-${amount}`, sig]
));

const settle = (owner, id, outcome, error = null) => one(
  "select public.app_user_settle_withdrawal($1::text,$2::text,$3::uuid,$4::text,$5::text) as r",
  [S, owner, id, outcome, error]
).then((r) => r.r);

// ---- a confirmed withdrawal writes exactly one movement, atomically ----
const intent = await newIntent(A, SIG);
assert.equal((await counts()).movements, 0, "nothing is recorded before settlement");

const confirmed = await settle(A, intent.id, "confirmed");
assert.equal(confirmed.ok, true);
assert.equal(confirmed.duplicate, false);

const after = await one("select * from app_private.withdrawal_intents where id=$1::uuid", [intent.id]);
assert.equal(after.state, "confirmed");
assert.ok(after.confirmed_at, "a confirmed withdrawal carries when it confirmed");
assert.ok(after.terminal_at);

const movement = await one("select * from app_private.cash_movements limit 1");
assert.equal(movement.owner_privy_user_id, A);
assert.equal(movement.movement_type, "withdrawal");
assert.equal(movement.status, "confirmed");
assert.equal(String(movement.amount_lamports), "1000000000");
// Recorded as 0, not guessed: the user's own wallet paid it and the server never saw the
// transaction meta. A plausible invented number would be a fabricated financial figure.
assert.equal(String(movement.network_fee_lamports), "0");
assert.equal(movement.tx_signature, SIG);
results.confirmedWithdrawalIsRecorded = "PASS";

// ---- settling twice cannot double the recorded withdrawals ----
const again = await settle(A, intent.id, "confirmed");
assert.equal(again.duplicate, true, "a retry is reported as handled, not as a failure");
assert.equal((await counts()).movements, 1, "one transfer, one movement");
results.settlementIsIdempotent = "PASS";

// ---- the headroom the user was losing ----
//
// app_user_withdrawable_state counts 'submitted' as a pending withdrawal. Before this
// migration nothing left that state, so the deduction was permanent.
const stateOf = (owner) => one(
  "select public.app_user_withdrawable_state($1::text,$2::text) as r", [S, owner]
).then((r) => r.r);

const stuck = await newIntent(B, "6".repeat(88), 2000000000);
const whileSubmitted = await stateOf(B);
assert.equal(whileSubmitted.pendingWithdrawalLamports, "2000000000",
  "an in-flight withdrawal is correctly held against spendable balance");
await settle(B, stuck.id, "confirmed");
const afterSettling = await stateOf(B);
assert.equal(afterSettling.pendingWithdrawalLamports, "0",
  "and is released once it settles — without this the user loses that headroom permanently");
// The chain balance is not readable from SQL, so the function reports the pending
// deduction rather than a spendable figure. Releasing it is the whole point: while the
// intent sat in `submitted` forever, that deduction never came back.
results.pendingHeadroomIsReleased = "PASS";

// ---- a failed withdrawal is terminal and writes NO movement ----
// A never-broadcast intent CAN fail. One that carries a signature cannot be failed by
// assertion — it may already have landed — which is the pre-existing rule this migration
// must not weaken.
const failedIntent = await newIntent(A, null, 300000000);
const failed = await settle(A, failedIntent.id, "failed", "user abandoned");
assert.equal(failed.ok, true);
const failedRow = await one("select * from app_private.withdrawal_intents where id=$1::uuid", [failedIntent.id]);
assert.equal(failedRow.state, "failed");
assert.equal(failedRow.confirmed_at, null, "a failed transfer never carries a confirmation time");
assert.equal((await counts()).movements, 2, "a failed transfer moves no money and records none");

const signedFail = await newIntent(A, "9".repeat(88), 111000000);
const refusedFail = await settle(A, signedFail.id, "failed", "guessing");
assert.equal(refusedFail.ok, false);
assert.equal(refusedFail.status, 409);
assert.match(refusedFail.error, /reconciled against the network/,
  "a broadcast transfer may not be declared failed without checking the chain");
results.failedWithdrawalRecordsNoMovement = "PASS";

// ---- nothing can be settled that was never broadcast ----
const unsent = await newIntent(A, null, 400000000);
const refused = await settle(A, unsent.id, "confirmed");
assert.equal(refused.ok, false);
assert.equal(refused.status, 409);
assert.match(refused.error, /before its transaction is recorded/);
assert.equal((await counts()).movements, 2, "and no movement was invented for it");
results.unsentCannotBeConfirmed = "PASS";

// ---- cross-user isolation ----
const bobsIntent = await newIntent(B, "8".repeat(88), 900000000);
const stolen = await settle(A, bobsIntent.id, "confirmed");
assert.equal(stolen.ok, false);
assert.equal(stolen.status, 404, "holding a valid id is not enough to settle another user's transfer");
results.crossUserDenied = "PASS";

// ---- invalid input is refused rather than coerced ----
for (const outcome of ["reversed", "anything", ""]) {
  const verdict = await settle(A, intent.id, outcome);
  assert.equal(verdict.ok, false, `outcome=${JSON.stringify(outcome)} must be refused`);
}
results.invalidInputRefused = "PASS";

// ---- the pending list an owner can act on ----
const pending = (await one(
  "select public.app_user_pending_withdrawals($1::text,$2::text,0::integer) as r", [S, B]
)).r;
assert.equal(pending.ok, true);
assert.equal(pending.withdrawals.length, 1, "only the still-submitted one");
assert.equal(pending.withdrawals[0].txSignature, "8".repeat(88));
const graced = (await one(
  "select public.app_user_pending_withdrawals($1::text,$2::text,3600::integer) as r", [S, B]
)).r;
assert.equal(graced.withdrawals.length, 0,
  "a transfer inside the grace window is not yet declared missing by a page load that raced it");
results.pendingListIsScopedAndGraced = "PASS";

// ---- authorization ----
await assert.rejects(
  () => db.query("select public.app_user_settle_withdrawal('wrong',$1::text,$2::uuid,'confirmed',null)", [A, intent.id]),
  /unauthorized/i
);
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(
    () => db.query("select public.app_user_settle_withdrawal($1::text,$2::text,$3::uuid,'confirmed',null)", [S, A, intent.id]),
    /permission denied/i, `${role} cannot settle a withdrawal`);
  await assert.rejects(
    () => db.query("select public.app_user_pending_withdrawals($1::text,$2::text,0::integer)", [S, A]),
    /permission denied/i, `${role} cannot list withdrawals`);
  await db.exec("reset role");
}
results.authorization = "PASS";

// ---- reconciliation against the network -------------------------------------------------
//
// app_user_settle_withdrawal REFUSES any non-confirmed outcome for a signed intent, and is
// right to: a browser knowing its own request failed is not evidence the transfer failed.
// app_user_reconcile_withdrawal is the reconciliation that guard asks for, called only after
// the server has read the transaction.
//
// Why this matters more than it looks: nothing in production ever settled a submitted
// withdrawal, and app_user_withdrawable_state counts `submitted` toward pending — so a
// transfer that SUCCEEDED on chain subtracted its own amount from the owner's spendable
// balance forever. One live intent held 0.89 SOL that way for three days while the modal
// told the user they had nothing to withdraw.
await db.exec(await readFile(`${repo}/supabase/degenaration-withdrawal-reconciliation.sql`, "utf8"));
await db.exec(await readFile(`${repo}/supabase/degenaration-withdrawal-reconciliation.sql`, "utf8"));
results.reconcilerRerunSafe = "PASS";

const reconcile = (owner, id, landed, succeeded, error = null) => one(
  "select public.app_user_reconcile_withdrawal($1::text,$2::text,$3::uuid,$4::boolean,$5::boolean,$6::text) as r",
  [S, owner, id, landed, succeeded, error]
).then((r) => r.r);

const spendableHold = async (owner) => BigInt((await one(
  "select public.app_user_withdrawable_state($1::text,$2::text) as r", [S, owner]
)).r.pendingWithdrawalLamports);

// A landed, successful transfer confirms and records exactly one movement — the live case.
// Asserted as a DELTA, because this fixture's earlier sections leave B with holds of their
// own. A hard-coded total would be asserting the fixture's history rather than this behaviour.
const holdBefore = await spendableHold(B);
const landedOk = await newIntent(B, "L".repeat(88), 890000000);
assert.equal(await spendableHold(B), holdBefore + BigInt(890000000),
  "a submitted withdrawal holds its amount out of spendable while it is unreconciled");
const before = (await counts()).movements;
const okVerdict = await reconcile(B, landedOk.id, true, true);
assert.equal(okVerdict.ok, true);
assert.equal(okVerdict.state, "confirmed");
assert.equal((await counts()).movements, before + 1, "a confirmed transfer records one movement");
assert.equal(await spendableHold(B), holdBefore, "and stops holding the owner's balance");
results.landedSuccessConfirmsAndReleases = "PASS";

// Re-running is a no-op. The endpoint calls this on every load.
const reRun = await reconcile(B, landedOk.id, true, true);
assert.equal(reRun.duplicate, true, "reconciliation is idempotent");
assert.equal((await counts()).movements, before + 1, "and writes no second movement");
results.reconcilerIdempotent = "PASS";

// A transaction that landed and REVERTED moved no money. The hold is released and NOTHING is
// recorded — recording a movement here would invent a withdrawal that never happened.
const reverted = await newIntent(B, "R".repeat(88), 250000000);
const movementsBeforeRevert = (await counts()).movements;
const revertVerdict = await reconcile(B, reverted.id, true, false, "reverted");
assert.equal(revertVerdict.state, "failed");
assert.equal((await counts()).movements, movementsBeforeRevert,
  "a reverted transfer moved nothing, so it records nothing");
results.revertedRecordsNoMovement = "PASS";

// A signature absent from the network may still land while its blockhash lives. Freeing the
// hold early would let the owner spend lamports the chain is about to take.
const fresh = await newIntent(B, "F".repeat(88), 100000000);
const tooEarly = await reconcile(B, fresh.id, false, false);
assert.equal(tooEarly.ok, false);
assert.equal(tooEarly.status, 409, "an unlanded transfer cannot be expired inside the blockhash window");

await db.query(
  "update app_private.withdrawal_intents set submitted_at = now() - interval '10 minutes' where id=$1::uuid",
  [fresh.id]
);
const expired = await reconcile(B, fresh.id, false, false);
assert.equal(expired.state, "expired", "past the window it can never land, so the hold is released");
results.unlandedWaitsForTheBlockhashWindow = "PASS";

// The old guard is untouched: a client still cannot fail a signed withdrawal on its say-so.
const stillGuarded = await newIntent(B, "G".repeat(88), 300000000);
const clientFail = await settle(B, stillGuarded.id, "failed");
assert.equal(clientFail.ok, false);
assert.equal(clientFail.status, 409,
  "app_user_settle_withdrawal still refuses to fail a signed transfer without reading the chain");
results.settleGuardUnchanged = "PASS";

// Authorization, on the new function too.
await assert.rejects(
  () => db.query(
    "select public.app_user_reconcile_withdrawal('wrong',$1::text,$2::uuid,true,true,null)",
    [B, stillGuarded.id]),
  /unauthorized/i
);
const crossUser = await reconcile(A, stillGuarded.id, true, true);
assert.equal(crossUser.status, 404, "one owner cannot reconcile another's withdrawal");
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(
    () => db.query(
      "select public.app_user_reconcile_withdrawal($1::text,$2::text,$3::uuid,true,true,null)",
      [S, B, stillGuarded.id]),
    /permission denied/i, `${role} cannot reconcile a withdrawal`);
  await db.exec("reset role");
}
results.reconcilerAuthorization = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  ...results,
  closes: "cash_movements — the last table of the accounting model with no writer, " +
    "and the submitted withdrawals nothing ever settled"
}, null, 2));
await db.close();
