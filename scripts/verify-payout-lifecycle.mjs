/**
 * Affiliate payout state machine and reservation reversal.
 *
 * Guards the defect where `fail` matched no disjunct in the transition chain, so a payout
 * could be failed from any state, and the reversal entries were written only for
 * 'rejected' — leaving the creator's reservation debit in place permanently.
 *
 * Fixtures are generated from scripts/lib/production-schema.mjs. Do not hand-write them.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const adminSql = await readFile(`${repo}/supabase/degenaration-admin-product-rpcs.sql`, "utf8");

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `SQL section not found: ${startMarker}`);
  return source.slice(start, end);
}

const decidePayout = section(
  adminSql,
  "create or replace function public.admin_decide_payout(",
  "create or replace function public.admin_list_app_users("
);

const FIXTURE_TABLES = [
  "app_private.payout_requests",
  "app_private.commission_ledger_entries",
  "app_private.admin_audit_log"
];

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;

  create function app_private.admin_secret_ok(p_secret text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_secret = 'payout-test-secret' $$;

  -- Stubbed: this test is about the transition and reversal logic, not admin identity,
  -- which verify-bot-lifecycle already covers.
  create function app_private.require_app_admin(p_actor_privy_user_id text)
  returns void language plpgsql as $$
  begin
    if p_actor_privy_user_id <> 'admin-a' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end $$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);
await db.exec(decidePayout);

const PAYOUT = "90000000-0000-0000-0000-000000000001";
const GROSS = 500_000_000n;      // 0.5 SOL
const PROCESSING_FEE = 43_000_000n;

async function seedPayout(status) {
  await db.exec("delete from app_private.commission_ledger_entries");
  await db.exec("delete from app_private.payout_requests");
  await db.query(
    `insert into app_private.payout_requests (
       id, owner_privy_user_id, destination_wallet, gross_lamports, status
     ) values ($1, 'creator-a', '11111111111111111111111111111111', $2, $3)`,
    [PAYOUT, GROSS.toString(), status]
  );
  // What app_user_request_payout books when the payout is created: the creator's
  // available balance is debited by the gross, and the platform takes the processing fee.
  await db.query(
    `insert into app_private.commission_ledger_entries (
       account_owner_privy_user_id, account_type, source_type, source_id,
       payout_request_id, amount_lamports, idempotency_key
     ) values
       ('creator-a', 'creator', 'payout', $1::text, $1::uuid, $2::bigint,
        'payout:' || $1::text || ':reserve'),
       (null, 'platform', 'payout', $1::text, $1::uuid, $3::bigint,
        'payout:' || $1::text || ':fee')`,
    [PAYOUT, (-GROSS).toString(), PROCESSING_FEE.toString()]
  );
}

async function creatorBalance() {
  const { rows } = await db.query(
    `select coalesce(sum(amount_lamports), 0)::text as balance
       from app_private.commission_ledger_entries
      where account_owner_privy_user_id = 'creator-a'`
  );
  return BigInt(rows[0].balance);
}

const decide = (action, opts = {}) => db.query(
  "select public.admin_decide_payout($1, $2, $3, $4, $5, $6) as result",
  ["payout-test-secret", opts.actor || "admin-a", PAYOUT, action,
    opts.reason ?? "operator note", opts.signature ?? null]
);

// ---- a payout may not be failed before anyone tried to send it ----

await seedPayout("requested");
await assert.rejects(
  () => decide("fail"),
  /invalid payout transition/i,
  "fail from 'requested' must be refused: nothing was sent, so reject is the correct action"
);

// ---- failing a payout returns the reservation ----

await seedPayout("approved");
assert.equal(await creatorBalance(), -GROSS, "the reservation debit is in place");
await decide("fail", { reason: "signer unavailable" });
const failed = await db.query("select status, processed_at from app_private.payout_requests where id = $1", [PAYOUT]);
assert.equal(failed.rows[0].status, "failed");
assert.ok(failed.rows[0].processed_at, "a terminal payout records when it was processed");
assert.equal(
  await creatorBalance(), BigInt(0),
  "a failed payout must return the creator's reserved balance, not confiscate it"
);
const platformAfterFail = await db.query(
  `select coalesce(sum(amount_lamports), 0)::text as balance
     from app_private.commission_ledger_entries where account_type = 'platform'`
);
assert.equal(
  platformAfterFail.rows[0].balance, "0",
  "the processing fee is reversed too — an unsent payout earns no fee"
);

// ---- a payout that already has a signature needs reconciliation, not a state flip ----

await seedPayout("processing");
await db.query(
  "update app_private.payout_requests set tx_signature = 'already-sent-signature' where id = $1",
  [PAYOUT]
);
await assert.rejects(
  () => decide("fail", { reason: "provider timeout" }),
  /must be reconciled/i,
  "lamports may already have left the treasury; reversing would credit the creator twice"
);
assert.equal(await creatorBalance(), -GROSS, "the reservation is untouched by the refusal");

// ---- rejection keeps working, and stays idempotent ----

await seedPayout("requested");
await decide("reject", { reason: "destination not verified" });
assert.equal(await creatorBalance(), BigInt(0));
await assert.rejects(
  () => decide("reject", { reason: "again" }),
  /invalid payout transition/i,
  "a terminal payout cannot be decided a second time"
);

// ---- the reversal is written exactly once per payout ----

const reversals = await db.query(
  `select count(*)::integer as count from app_private.commission_ledger_entries
    where source_type = 'reversal'`
);
assert.equal(reversals.rows[0].count, 2, "one creator reversal and one platform fee reversal");

// ---- authorization still holds ----

await seedPayout("approved");
await assert.rejects(() => decide("fail", { actor: "not-an-admin" }), /forbidden/i);
await assert.rejects(
  () => db.query(
    "select public.admin_decide_payout($1, $2, $3, $4, $5, $6)",
    ["wrong-secret", "admin-a", PAYOUT, "fail", "r", null]
  ),
  /unauthorized/i
);

// ---- every terminal outcome leaves an audit row ----

const audit = await db.query(
  "select action from app_private.admin_audit_log order by created_at"
);
assert.ok(audit.rows.some((row) => row.action === "payout.fail"));
assert.ok(audit.rows.some((row) => row.action === "payout.reject"));

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: "generated from production shapes (3 tables)",
  schemaParity: "PASS",
  failBeforeSendRefused: "PASS",
  failReturnsReservation: "PASS",
  processingFeeReversed: "PASS",
  signedPayoutRequiresReconciliation: "PASS",
  rejectionUnchanged: "PASS",
  terminalPayoutNotRedecidable: "PASS",
  reversalWrittenOnce: "PASS",
  authorization: "PASS",
  auditTrail: "PASS"
}, null, 2));

await db.close();
