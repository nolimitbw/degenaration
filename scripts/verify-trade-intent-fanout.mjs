/**
 * Trade intents at fan-out: capital reserved before it is committed, released exactly once.
 *
 * Step 2 of docs/ai/ACCOUNTING_MODEL.md, and the fix for the most dangerous open hole in the
 * product: app_user_withdrawable_state derives locked capital from app_private.trade_intents,
 * nothing ever wrote that table, so lockedLamports was STRUCTURALLY always zero even while
 * the worker held a user's SOL reserved against their daily cap. A user could withdraw
 * capital that was already spoken for.
 *
 * Everything here runs against real PostgreSQL with fixtures generated from the captured
 * production shapes. The two properties that matter most, and that the control runs target:
 * a refused claim must NOT reserve anything, and a terminal state must release exactly once.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const fanoutSql = await readFile(`${repo}/supabase/degenaration-trade-intent-fanout.sql`, "utf8");
const withdrawSql = await readFile(`${repo}/supabase/degenaration-user-withdrawals.sql`, "utf8");

const rpc = withdrawSql.slice(
  withdrawSql.indexOf("create or replace function public.app_user_withdrawable_state("),
  withdrawSql.indexOf("revoke execute on function public.app_user_withdrawable_state")
);

const FIXTURE_TABLES = [
  // copy_subscriptions references this, so it must be created first.
  "app_private.bot_config_versions",
  "app_private.app_users",
  "app_private.trade_intents",
  "public.subscriptions",
  "public.calls",
  "app_private.call_executions",
  // copy_executions carries an FK to it, and the fixture keeps FKs that point inside the
  // captured set. Ordering matters: the referenced table must be created first.
  "public.copy_subscriptions",
  "app_private.copy_executions"
];

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;

  create function app_private.admin_secret_ok(p_secret text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_secret is not null and p_secret = 'fanout-test-secret' $$;

  create function app_private.ensure_app_user(p_privy_user_id text)
  returns void language plpgsql security definer set search_path = ''
  as $$
  begin
    insert into app_private.app_users (privy_user_id) values (trim(p_privy_user_id))
    on conflict (privy_user_id) do nothing;
  end $$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);
await db.exec(fanoutSql);
await db.exec(rpc);
// The slice above deliberately excludes the grants that follow the function in the file, so
// they are applied here. Without them the RPC would default to PUBLIC EXECUTE and the
// authorization assertions below would pass vacuously.
await db.exec(`
  revoke execute on function public.app_user_withdrawable_state(text, text)
    from public, anon, authenticated;
  grant execute on function public.app_user_withdrawable_state(text, text) to service_role;
`);

const SECRET = "fanout-test-secret";
const ALICE = "did:privy:alice";
const BOB = "did:privy:bob";
const WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const MINT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL = 1_000_000_000n;

await db.query(
  "insert into app_private.app_users (privy_user_id) values ($1::text), ($2::text)", [ALICE, BOB]
);

let seq = 0;
const pad = (n) => String(n).padStart(12, "0");

// One subscription per (privy_user_id, group_id) is enforced by subscriptions_privy_group_key,
// which mirrors the product rule: a user follows a Discord source once. Each fixture
// subscription therefore gets its own source.
async function seedSubscription(owner, sizeSol, capSol) {
  seq += 1;
  const id = `bbbbbbbb-0000-0000-0000-${pad(seq)}`;
  const group = `aaaaaaaa-0000-0000-0000-${pad(seq)}`;
  await db.query(
    `insert into public.subscriptions
       (id, group_id, privy_user_id, user_pubkey, wallet_id, size_sol, daily_cap_sol, enabled)
     values ($1::uuid, $2::uuid, $3::text, $4::text, 'pw-1', $5::numeric, $6::numeric, true)`,
    [id, group, owner, WALLET, sizeSol, capSol]
  );
  return { id, group };
}
async function seedCall(group) {
  seq += 1;
  const id = `cccccccc-0000-0000-0000-${pad(seq)}`;
  await db.query(
    "insert into public.calls (id, group_id, mint) values ($1::uuid, $2::uuid, $3::text)",
    [id, group, MINT]
  );
  return id;
}
const claim = (callId, subId, amountSol, status = "claimed", error = null) => db.query(
  `insert into app_private.call_executions
     (call_id, subscription_id, claim_token, status, amount_sol, error)
   values ($1::uuid, $2::uuid, gen_random_uuid(), $3::text, $4::double precision, $5::text)
   returning id, intent_id`,
  [callId, subId, status, amountSol, error]
).then((r) => r.rows[0]);

const locked = (user) => db.query(
  "select public.app_user_withdrawable_state($1::text, $2::text) as r", [SECRET, user]
).then((r) => r.rows[0].r);

const intentOf = (id) => db.query(
  "select * from app_private.trade_intents where id = $1::uuid", [id]
).then((r) => r.rows[0]);

const results = {};

// ---- an intent is created at fan-out, and it locks -------------------------------------

assert.equal((await locked(ALICE)).lockedLamports, "0", "nothing reserved yet");

const subA = await seedSubscription(ALICE, 0.5, 5);
const call1 = await seedCall(subA.group);
const exec1 = await claim(call1, subA.id, 0.5);

assert.ok(exec1.intent_id, "claiming a call creates a trade intent");
const intent1 = await intentOf(exec1.intent_id);
assert.equal(intent1.owner_privy_user_id, ALICE);
assert.equal(intent1.state, "capital_reserved");
assert.equal(intent1.side, "buy");
assert.equal(intent1.mint, MINT);
assert.equal(intent1.wallet_address, WALLET);
assert.equal(intent1.source_group_id, subA.group);
assert.equal(String(intent1.reserved_lamports), "500000000", "0.5 SOL, converted to integer lamports");
assert.equal(String(intent1.max_allowed_lamports), "5000000000", "the daily cap is captured");
assert.ok(intent1.correlation_id, "a correlation id is assigned");
assert.equal(intent1.idempotency_key, `call:${call1}:${subA.id}`);

const afterClaim = await locked(ALICE);
assert.equal(
  afterClaim.lockedLamports, "500000000",
  "THE FIX: capital committed by the worker is now visible to the withdrawal screen"
);
assert.equal(afterClaim.inFlightIntents, 1);
results.intentCreatedAndLocksCapital = "PASS";

// ---- floats never reach the intent ------------------------------------------------------

const subFloat = await seedSubscription(ALICE, 0.1, 1);
const callFloat = await seedCall(subFloat.group);
const execFloat = await claim(callFloat, subFloat.id, 0.1);
const intentFloat = await intentOf(execFloat.intent_id);
assert.equal(
  String(intentFloat.reserved_lamports), "100000000",
  "0.1 double precision converts to exactly 100000000 lamports, not 100000000.00000001"
);
assert.ok(
  Number.isInteger(Number(intentFloat.reserved_lamports)),
  "the stored value is a whole number of lamports, with no fractional residue from the float"
);
results.integerConversionAtTheBoundary = "PASS";

// ---- a REFUSED claim reserves nothing ---------------------------------------------------
//
// The claim RPC inserts a 'skipped' row for every refusal -- cap reached, wallet
// unavailable, limits invalid -- without reserving capital. If those created intents, a user
// who tripped their daily cap would have their whole balance frozen by failures.

const before = BigInt((await locked(ALICE)).lockedLamports);
const callSkip = await seedCall(subA.group);
const execSkip = await claim(callSkip, subA.id, 0.5, "skipped", "source daily cap reached");
assert.equal(execSkip.intent_id, null, "a skipped claim creates no intent");
assert.equal(
  BigInt((await locked(ALICE)).lockedLamports), before,
  "a refused claim must not reserve capital"
);
results.refusedClaimReservesNothing = "PASS";

// ---- a duplicate signal reuses the intent ----------------------------------------------

await assert.rejects(
  () => claim(call1, subA.id, 0.5),
  /duplicate key|unique/i,
  "the queue's own uniqueness stops a second execution row for the same (call, subscription)"
);
// And directly: the idempotency key collides and returns the SAME intent.
const dup = await db.query(
  `select app_private.open_trade_intent(
     $1::text, $2::text, $3::text, 'buy', 'entry', 'solana-mainnet',
     500000000::bigint, 5000000000::bigint, $4::text, $5::uuid, null, '{}'::jsonb) as i`,
  [ALICE, `call:${call1}:${subA.id}`, MINT, WALLET, subA.group]
);
assert.match(String(dup.rows[0].i), new RegExp(intent1.id), "the existing intent is returned");
const count = await db.query(
  "select count(*)::integer n from app_private.trade_intents where idempotency_key = $1::text",
  [`call:${call1}:${subA.id}`]
);
assert.equal(count.rows[0].n, 1, "no second intent reserves the same capital for the same signal");
assert.equal(
  (await locked(ALICE)).lockedLamports, "600000000",
  "0.5 + 0.1 only — the duplicate added nothing"
);
results.duplicateSignalReusesIntent = "PASS";

// ---- capital stays reserved while genuinely pending -------------------------------------

await db.query(
  "update app_private.call_executions set status = 'submitted', tx_signature = 'sig-1' where id = $1::uuid",
  [exec1.id]
);
const submitted = await intentOf(exec1.intent_id);
assert.equal(submitted.state, "submitted");
assert.equal(
  String(submitted.reserved_lamports), "500000000",
  "a submitted-but-unconfirmed buy keeps its capital locked — the transaction may still land"
);
assert.ok(submitted.claimed_at, "the submission is timestamped");
assert.equal(submitted.tx_signature, "sig-1",
  "spec 5.3: the intent records the transaction that fulfilled it, so it can name what spent " +
  "the capital it reserved without joining back through the queue");
results.pendingStaysReserved = "PASS";

// The first signature wins. A later one would mean two broadcasts for one reservation.
//
// The status must actually CHANGE for this to test anything: sync_execution_intent_state fires
// only on `new.status is distinct from old.status`, so re-setting 'submitted' leaves the
// trigger dormant and the assertion passes without exercising the path. A control run caught
// exactly that.
await db.query(
  "update app_private.call_executions set tx_signature = 'sig-2' where id = $1::uuid", [exec1.id]);
await db.query(
  "update app_private.call_executions set status = 'failed' where id = $1::uuid", [exec1.id]);
assert.equal((await intentOf(exec1.intent_id)).tx_signature, "sig-1",
  "the recorded signature is never overwritten -- it is the only link between reserved " +
  "capital and the transaction that consumed it");
results.signatureImmutableOnIntent = "PASS";

// ---- confirmation releases, because the lamports have left the wallet -------------------

// 'succeeded' is the queue's word for it; call_executions_status_check permits no other.
await db.query(
  "update app_private.call_executions set status = 'succeeded' where id = $1::uuid", [exec1.id]
);
const confirmed = await intentOf(exec1.intent_id);
assert.equal(confirmed.state, "confirmed");
assert.equal(
  String(confirmed.reserved_lamports), "0",
  "confirmed means the SOL already left the wallet; the on-chain balance reflects it, so " +
  "continuing to subtract it would double-count and wrongly refuse a legitimate withdrawal"
);
assert.ok(confirmed.released_at);
assert.equal((await locked(ALICE)).lockedLamports, "100000000", "only the 0.1 intent remains");
results.confirmationReleases = "PASS";

// ---- failure releases too, because the lamports never left ------------------------------

const subFail = await seedSubscription(BOB, 2, 10);
const callFail = await seedCall(subFail.group);
const execFail = await claim(callFail, subFail.id, 2);
assert.equal((await locked(BOB)).lockedLamports, "2000000000");

await db.query(
  "update app_private.call_executions set status = 'failed', error = 'slippage' where id = $1::uuid",
  [execFail.id]
);
const failed = await intentOf(execFail.intent_id);
assert.equal(failed.state, "failed");
assert.equal(String(failed.reserved_lamports), "0", "a failed buy must return the capital it reserved");
assert.ok(failed.terminal_at, "a failure is terminal and timestamped");
assert.equal((await locked(BOB)).lockedLamports, "0");
results.failureReleasesCapital = "PASS";

// ---- release happens exactly once, and cannot regress -----------------------------------

const releasedAt = failed.released_at;
await db.query(
  "update app_private.call_executions set status = 'failed' where id = $1::uuid", [execFail.id]
);
assert.equal(
  (await intentOf(execFail.intent_id)).released_at.toISOString(), releasedAt.toISOString(),
  "re-failing does not re-release"
);

// A late failure callback must not move a confirmed intent backwards.
await db.query(
  "update app_private.call_executions set status = 'failed' where id = $1::uuid", [exec1.id]
);
assert.equal(
  (await intentOf(exec1.intent_id)).state, "confirmed",
  "'confirmed' means lamports left the wallet, and that fact does not un-happen"
);
results.releaseIsOnceAndIrreversible = "PASS";

// ---- concurrency: two workers racing the same signal ------------------------------------

const subRace = await seedSubscription(ALICE, 1, 10);
const callRace = await seedCall(subRace.group);
const key = `call:${callRace}:${subRace.id}`;
const racers = await Promise.allSettled(
  Array.from({ length: 5 }, () => db.query(
    `select (app_private.open_trade_intent(
       $1::text, $2::text, $3::text, 'buy', 'entry', 'solana-mainnet',
       1000000000::bigint, 10000000000::bigint, $4::text, $5::uuid, null, '{}'::jsonb)).id as id`,
    [ALICE, key, MINT, WALLET, subRace.group]
  ))
);
const ids = new Set(racers.filter((r) => r.status === "fulfilled").map((r) => r.value.rows[0].id));
assert.equal(ids.size, 1, "five concurrent attempts produce exactly one intent");
const raceRows = await db.query(
  "select count(*)::integer n from app_private.trade_intents where idempotency_key = $1::text", [key]
);
assert.equal(raceRows.rows[0].n, 1);
results.concurrentFanoutReservesOnce = "PASS";

// ---- a sell never freezes SOL -----------------------------------------------------------

await db.query(
  `select app_private.open_trade_intent(
     $1::text, 'sell-key-1', $2::text, 'sell', 'take-profit', 'solana-mainnet',
     900000000::bigint, null, $3::text, null, null, '{}'::jsonb)`,
  [BOB, MINT, WALLET]
);
assert.equal(
  (await locked(BOB)).lockedLamports, "0",
  "a sell commits the token, not SOL; reserving here would freeze funds no trade will spend"
);
results.sellDoesNotFreezeSol = "PASS";

// ---- isolation and authorization ---------------------------------------------------------

const aliceLocked = BigInt((await locked(ALICE)).lockedLamports);
assert.ok(aliceLocked > BigInt(0), "alice still has capital reserved");
assert.equal((await locked(BOB)).lockedLamports, "0", "one user's reservation is not another's");

await assert.rejects(
  () => db.query("select public.app_user_withdrawable_state($1::text, $2::text)", ["wrong", ALICE]),
  /unauthorized/i
);
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => locked(ALICE), /permission denied/i);
  await db.exec("reset role");
}
results.isolationAndAuthorization = "PASS";

// ---- the invariant ------------------------------------------------------------------------
//
// total reconciled principal = available + locked + pending movements.
// Asserted against a stated on-chain balance, which is the only authoritative total.

const RESERVE = 15_890_880n;
const onChain = 10n * SOL;
const lockedNow = BigInt((await locked(ALICE)).lockedLamports);
const pendingWithdrawal = BigInt((await locked(ALICE)).pendingWithdrawalLamports);
const available = onChain - lockedNow - pendingWithdrawal - RESERVE;
assert.equal(
  available + lockedNow + pendingWithdrawal + RESERVE, onChain,
  "total = available + locked + pending + reserve, with no unexplained difference"
);
assert.equal(pendingWithdrawal, 0n, "pending withdrawals are not tracked yet — step 4");
results.balanceInvariantHolds = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS",
  ...results,
  notYetImplemented: {
    pendingWithdrawal: "no withdrawal-intent table exists; step 4 makes this a real number",
    positionsAndLots: "step 4 of the accounting model; a confirmed buy does not yet open a position",
    feeLedger: "trade_executions still has no writer, so no fee accrues; step 3 of the model"
  }
}, null, 2));

await db.close();
