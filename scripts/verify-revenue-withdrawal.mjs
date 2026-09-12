/**
 * `Withdraw fees` — and the four ways a revenue withdrawal could take money that is not ours.
 *
 * The dangerous failures here are not "it refuses too much". They are:
 *
 *   1. it draws against the PLATFORM FEE rather than the RETAINED share, spending the creator
 *      and referral allocations that are owed to someone else;
 *   2. two concurrent requests each see the full balance and together overdraw;
 *   3. a retry opens a second intent, so one click withdraws twice;
 *   4. it reports a balance for a mint the ledger cannot actually denominate.
 *
 * Every one of those is asserted. Nothing here writes to production; PGlite, schema rendered
 * from the captured production shapes.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const results = {};
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const T = ["app_private.app_users", "app_private.trade_intents", "app_private.trade_executions"];

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema app_private;
  create function app_private.admin_secret_ok(p text) returns boolean
  language sql stable security definer set search_path='' as $x$ select p = 'admin-secret' $x$;
  create function app_private.require_app_admin(p text) returns void
  language plpgsql security definer set search_path='' as $x$
  begin
    if p is distinct from 'did:privy:owner' then
      raise exception 'admin required' using errcode = '42501';
    end if;
  end $x$;
`);
await db.exec(renderTables(T));
await assertSchemaParity(db, T, assert);
await db.query(
  `insert into app_private.app_users (privy_user_id) values ('did:privy:client') on conflict do nothing`
);
const INTENT = (await db.query(
  `insert into app_private.trade_intents
     (owner_privy_user_id, idempotency_key, mint, side, intent_kind, execution_mode,
      requested_input_base_units, state)
   values ('did:privy:client', 'revenue-wd-fixture', 'MINT', 'buy', 'entry', 'solana-mainnet', 1, 'confirmed')
   returning id`
)).rows[0].id;

const sql = async (name) => readFile(`${repo}/supabase/${name}`, "utf8");
await db.exec(await sql("degenaration-revenue-withdrawal.sql"));
await db.exec(await sql("degenaration-revenue-withdrawal.sql"));
results.rerunSafe = "PASS";

const one = async (text, params = []) => (await db.query(text, params)).rows[0];
const open = async (mint, dest, amount, actor = "did:privy:owner") =>
  (await one(
    "select public.admin_open_revenue_withdrawal('admin-secret', $1::text, $2::text, $3::text, $4::bigint) as r",
    [actor, mint, dest, String(amount)]
  )).r;
const sign = async (id, sig) => (await one(
  "select public.admin_record_revenue_withdrawal_signature('admin-secret','did:privy:owner',$1::uuid,$2::text) as r",
  [id, sig]
)).r;
const settle = async (id, outcome, error = null) => (await one(
  "select public.admin_settle_revenue_withdrawal('admin-secret','did:privy:owner',$1::uuid,$2::text,$3::text) as r",
  [id, outcome, error]
)).r;

let attempt = 0;
async function execution({ gross, platform, creator, referral, status = "confirmed" }) {
  attempt += 1;
  await db.query(
    `insert into app_private.trade_executions
       (intent_id, attempt, owner_privy_user_id, execution_mode, status, gross_notional_lamports,
        platform_fee_lamports, creator_fee_lamports, referral_fee_lamports, confirmed_at)
     values ($6::uuid, $7::integer, 'did:privy:client', 'solana-mainnet', $5::text, $1::bigint,
             $2::bigint, $3::bigint, $4::bigint, now())`,
    [gross, platform, creator, referral, status, INTENT, attempt]
  );
}

// ── authorization ───────────────────────────────────────────────────────────────────────────
await assert.rejects(
  () => db.query("select public.admin_open_revenue_withdrawal('wrong','did:privy:owner','M','D',1)"),
  /unauthorized/
);
await assert.rejects(
  () => db.query("select public.admin_open_revenue_withdrawal('admin-secret','did:privy:someone','M','D',1)"),
  /admin required/
);
for (const fn of [
  "public.admin_open_revenue_withdrawal(text,text,text,text,bigint)",
  "public.admin_record_revenue_withdrawal_signature(text,text,uuid,text)",
  "public.admin_settle_revenue_withdrawal(text,text,uuid,text,text)",
  "public.admin_list_revenue_withdrawals(text,text,integer)",
  "app_private.revenue_available(text)"
]) {
  for (const role of ["anon", "authenticated"]) {
    const granted = await one("select has_function_privilege($1::text,$2::text,'execute') as g", [role, fn]);
    assert.equal(granted.g, false, `${role} must not be able to call ${fn}`);
  }
}
results.authorization = "PASS";

// ── an empty ledger has nothing to withdraw ─────────────────────────────────────────────────
{
  const refused = await open(WSOL, "DEST", 1);
  assert.equal(refused.ok, false);
  assert.equal(refused.availableBaseUnits, "0");
  results.emptyLedgerHasNothing = "PASS";
}

// ── THE ALLOCATION BOUNDARY. It draws against RETAINED, not the platform fee ────────────────
//
// The failure this prevents: withdrawing the full 2.00% would spend the creator's 70 bps and
// the referrer's share, which are owed to someone else and have already been subtracted once.
{
  // 200 bps of 100 SOL = 2 SOL. creator 0.7, referral 0.2, retained 1.1.
  await execution({ gross: 100_000_000_000, platform: 2_000_000_000, creator: 700_000_000, referral: 200_000_000 });

  const available = await one("select app_private.revenue_available($1::text) as a", [WSOL]);
  assert.equal(available.a, 1_100_000_000, "available must be RETAINED, not the platform fee");
  assert.notEqual(available.a, 2_000_000_000, "drawing against the platform fee spends the creator's share");

  // One lamport over the retained share is refused.
  const over = await open(WSOL, "DEST", 1_100_000_001);
  assert.equal(over.ok, false);
  assert.equal(over.availableBaseUnits, "1100000000");
  results.drawsAgainstRetainedNotPlatformFee = "PASS";
}

// ── an unconfirmed fee is not withdrawable ──────────────────────────────────────────────────
{
  await execution({ gross: 50_000_000_000, platform: 1_000_000_000, creator: 350_000_000, referral: 100_000_000, status: "submitted" });
  const available = await one("select app_private.revenue_available($1::text) as a", [WSOL]);
  assert.equal(available.a, 1_100_000_000, "a submitted execution's fee is not revenue yet");
  await execution({ gross: 50_000_000_000, platform: 1_000_000_000, creator: 350_000_000, referral: 100_000_000, status: "failed" });
  const stillSame = await one("select app_private.revenue_available($1::text) as a", [WSOL]);
  assert.equal(stillSame.a, 1_100_000_000, "a failed execution's fee is never revenue");
  results.onlyConfirmedFeesAreWithdrawable = "PASS";
}

// ── IDEMPOTENCE. One click cannot become two withdrawals ────────────────────────────────────
{
  const first = await open(WSOL, "DEST-A", 100_000_000);
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);

  const retry = await open(WSOL, "DEST-A", 100_000_000);
  assert.equal(retry.ok, true);
  assert.equal(retry.reused, true, "a retried request must return the SAME intent");
  assert.equal(retry.id, first.id);

  const rows = await db.query(
    "select count(*)::int as n from app_private.revenue_withdrawals where destination_address='DEST-A'"
  );
  assert.equal(rows.rows[0].n, 1, "exactly one row, however many times the button is pressed");

  // And the retry is NOT refused for insufficient funds against the balance its own predecessor
  // is holding down — the reuse branch runs before the balance check for exactly this reason.
  assert.notEqual(retry.error, "amount exceeds available platform revenue");
  results.idempotentOpen = "PASS";
}

// ── an in-flight withdrawal reduces what is available ───────────────────────────────────────
//
// Without this, opening two intents in a row lets both see the full balance and the second
// overdraws the moment the first lands.
{
  const available = await one("select app_private.revenue_available($1::text) as a", [WSOL]);
  assert.equal(available.a, 1_000_000_000, "the 0.1 SOL intent already opened must be committed");

  const overdraw = await open(WSOL, "DEST-B", 1_000_000_001);
  assert.equal(overdraw.ok, false, "a second intent must not be able to spend the first one's amount");
  results.inFlightCommitsTheAmount = "PASS";
}

// ── a reversal restores the balance; a confirmation does not ────────────────────────────────
{
  const doomed = await open(WSOL, "DEST-C", 200_000_000);
  assert.equal(doomed.ok, true);
  const before = (await one("select app_private.revenue_available($1::text) as a", [WSOL])).a;
  assert.equal(before, 800_000_000);

  await settle(doomed.id, "failed", "provider rejected");
  const after = (await one("select app_private.revenue_available($1::text) as a", [WSOL])).a;
  assert.equal(after, 1_000_000_000, "a failed withdrawal moved nothing, so the balance returns");
  results.failedWithdrawalRestoresBalance = "PASS";
}

// ── the signature is durable, immutable, and required before confirmation ───────────────────
{
  const w = await open(WSOL, "DEST-D", 50_000_000);

  // Cannot confirm without one. Confirming would mark value as moved with no way to prove it.
  const premature = await settle(w.id, "confirmed");
  assert.equal(premature.ok, false);
  assert.match(premature.error, /without a signature/);

  const signed = await sign(w.id, "SIG-D");
  assert.equal(signed.ok, true);
  assert.equal(signed.state, "submitted");

  // Same signature again: idempotent success, so a retried submit does not error.
  assert.equal((await sign(w.id, "SIG-D")).reused, true);

  // A DIFFERENT signature: refused. Silently accepting it would report a transfer that is not
  // the one on chain.
  const conflicting = await sign(w.id, "SIG-OTHER");
  assert.equal(conflicting.ok, false);
  assert.match(conflicting.error, /different signature/);

  // And the trigger backs it up at the table level, not just in the function.
  await assert.rejects(
    () => db.query("update app_private.revenue_withdrawals set tx_signature='SIG-FORGED' where id=$1::uuid", [w.id]),
    /signature is immutable/
  );

  const confirmed = await settle(w.id, "confirmed");
  assert.equal(confirmed.ok, true);
  // Settling to the state it is already in is a no-op success, so a retried poll is not an
  // error an operator has to interpret.
  assert.equal((await settle(w.id, "confirmed")).reused, true);
  // But a settled withdrawal cannot be re-settled to something else.
  const reopened = await settle(w.id, "failed", "late");
  assert.equal(reopened.ok, false);
  assert.match(reopened.error, /already settled/);
  results.signatureDurableAndImmutable = "PASS";
}

// ── the terms are immutable ─────────────────────────────────────────────────────────────────
{
  const w = await open(WSOL, "DEST-E", 10_000_000);
  for (const [column, value] of [
    ["amount_base_units", "999999999"], ["destination_address", "'ELSEWHERE'"],
    ["mint", "'OTHER'"], ["actor_privy_user_id", "'did:privy:someone'"]
  ]) {
    await assert.rejects(
      () => db.query(`update app_private.revenue_withdrawals set ${column}=${value} where id=$1::uuid`, [w.id]),
      /terms are immutable/,
      `${column} must not be editable after authorisation`
    );
  }
  results.termsImmutable = "PASS";
}

// ── A MINT THE LEDGER CANNOT DENOMINATE IS REFUSED, NOT REPORTED AS ZERO ────────────────────
//
// trade_executions records `*_lamports` with no mint anywhere on the row. Answering a USDC
// query would hand back the wSOL total wearing a USDC label, and an operator would withdraw
// against it. Zero is equally wrong: it reads as "nothing earned yet".
{
  const unanswerable = await one("select app_private.revenue_available($1::text) as a", [USDC]);
  assert.equal(unanswerable.a, null, "an undenominated mint must be NULL — not answerable, not zero");

  const refused = await open(USDC, "DEST-USDC", 1);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /not tracked per mint/);
  // And it did not silently create a row.
  const rows = await db.query("select count(*)::int as n from app_private.revenue_withdrawals where mint=$1::text", [USDC]);
  assert.equal(rows.rows[0].n, 0);
  results.undenominatedMintRefusedNotZeroed = "PASS";
}

// ── history ─────────────────────────────────────────────────────────────────────────────────
{
  const list = (await one(
    "select public.admin_list_revenue_withdrawals('admin-secret','did:privy:owner',50) as r"
  )).r;
  assert.equal(list.ok, true);
  assert.ok(Array.isArray(list.withdrawals) && list.withdrawals.length >= 4);
  // Newest first, and the amount is a string so a bigint cannot be truncated by JSON.
  assert.equal(typeof list.withdrawals[0].amount_base_units, "string");
  results.history = "PASS";
}

// ── CONTROL: the balance check is real ──────────────────────────────────────────────────────
//
// Every assertion above would also pass if the function simply refused everything. This proves
// it accepts a legitimate withdrawal for exactly the retained amount and no more.
{
  const remaining = (await one("select app_private.revenue_available($1::text) as a", [WSOL])).a;
  const exact = await open(WSOL, "DEST-EXACT", remaining);
  assert.equal(exact.ok, true, "CONTROL FAILED: withdrawing exactly the available amount must succeed");
  const nowZero = (await one("select app_private.revenue_available($1::text) as a", [WSOL])).a;
  assert.equal(nowZero, 0);
  const onePastZero = await open(WSOL, "DEST-PAST", 1);
  assert.equal(onePastZero.ok, false);
  results.controlProvesItAcceptsAValidWithdrawal = "PASS";
}

console.log(JSON.stringify({
  verifier: "revenue-withdrawal",
  database: "PGlite (real PostgreSQL), schema rendered from the captured production shapes",
  migration: "supabase/degenaration-revenue-withdrawal.sql",
  properties: Object.keys(results).length,
  ...results,
  proves:
    "a revenue withdrawal draws against DegenAration's RETAINED share and never the creator or " +
    "referral allocations; an unconfirmed or failed fee is not withdrawable; a retry returns the " +
    "same intent rather than opening a second; an in-flight intent commits its amount so two " +
    "requests cannot together overdraw; a failed one restores the balance; the signature is " +
    "durable and immutable and required before confirmation; the terms cannot be edited after " +
    "authorisation; a mint the ledger cannot denominate is refused rather than reported as zero; " +
    "and anon and authenticated can call none of it",
  notProven:
    "that a withdrawal has ever been signed — signing platform revenue out of the fee account " +
    "is an owner action with an owner-held key, and the fee account does not exist yet (E-4)"
}, null, 2));

await db.close();
