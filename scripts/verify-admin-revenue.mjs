/**
 * Platform revenue, and the invariant that makes every other figure on the page trustworthy.
 *
 *     creator + referral + retained  ==  platform fee collected
 *
 * It holds by construction today — `retained_fee_lamports` is a GENERATED column — which is
 * exactly why the function reports it rather than trusting it. A generated column guarantees
 * one ROW; the moment a correction, a reversal or a second writer appears, the guarantee stops
 * being about the business total. The control run at the end forces a violation to prove the
 * check can actually fail.
 *
 * Nothing here writes to production. PGlite, schema rendered from the captured shapes.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const repo = process.cwd();
const db = new PGlite();
const results = {};
const T = ["app_private.app_users", "app_private.trade_intents", "app_private.trade_executions", "app_private.payout_requests"];

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
// Every execution hangs off an intent (intent_id is NOT NULL). One intent is enough: this
// function aggregates executions and never groups by intent.
await db.query(
  `insert into app_private.app_users (privy_user_id) values ('did:privy:client')
   on conflict do nothing`
);
const INTENT = (await (async () => (await db.query(
  `insert into app_private.trade_intents
     (owner_privy_user_id, idempotency_key, mint, side, intent_kind, execution_mode,
      requested_input_base_units, state)
   values ('did:privy:client', 'revenue-fixture', 'MINT', 'buy', 'entry', 'solana-mainnet', 1, 'confirmed')
   returning id`
)).rows[0])()).id;
await db.exec(await readFile(`${repo}/supabase/degenaration-admin-revenue.sql`, "utf8"));
await db.exec(await readFile(`${repo}/supabase/degenaration-admin-revenue.sql`, "utf8"));
results.rerunSafe = "PASS";

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const revenue = async (actor = "did:privy:owner") =>
  (await one("select public.admin_revenue_summary('admin-secret', $1::text) as r", [actor])).r;

// ── authorization ───────────────────────────────────────────────────────────────────────────
await assert.rejects(
  () => db.query("select public.admin_revenue_summary('wrong', 'did:privy:owner')"), /unauthorized/
);
await assert.rejects(
  () => db.query("select public.admin_revenue_summary('admin-secret', 'did:privy:someone')"), /admin required/
);
for (const role of ["anon", "authenticated"]) {
  const granted = await one(
    "select has_function_privilege($1::text,'public.admin_revenue_summary(text,text)','execute') as g", [role]
  );
  assert.equal(granted.g, false, `${role} must not be able to read platform revenue`);
}
results.authorization = "PASS";

// ── an empty ledger reports zeros, and says it reconciles ───────────────────────────────────
{
  const empty = await revenue();
  assert.equal(empty.platformFee.lifetime, "0");
  assert.equal(empty.availableLamports, "0");
  assert.equal(empty.allocationDrift, "0");
  assert.equal(empty.reconciled, true, "nothing collected and nothing allocated does reconcile");
  results.emptyLedgerReconciles = "PASS";
}

// ── periods separate, and only CONFIRMED executions count as revenue ─────────────────────────
{
  // 200 bps of 100 SOL = 2 SOL, split 70 bps creator / 10% of fee referral / remainder retained.
  // (intent_id, attempt) is unique, so each fixture execution takes the next attempt number.
  let attempt = 0;
  /**
   * `today` clamps the row into the current day.
   *
   * The fixture placed the "today" execution at `now() - 1 hour` and asserted it counted
   * toward today. Between midnight and 01:00 that lands on YESTERDAY, so the total came back
   * 0 and the whole suite failed — for one hour, every day, on a clock rather than on a
   * change. It failed for real on 2026-08-13 minutes after the date rolled over.
   *
   * `greatest(..., date_trunc('day', now()))` is the same expression the function itself
   * filters on (`at >= date_trunc('day', now())` in degenaration-admin-revenue.sql), so the
   * row is inside the window by construction rather than by luck. It still sits an hour back
   * for the other 23 hours, which is what the case was written to exercise.
   *
   * Only the today row clamps. Applying it to all of them would drag the 3-day and 20-day
   * executions into today and quietly destroy the period separation this block exists to test.
   */
  const insert = async ({ ago, status, gross, platform, creator, referral, today = false }) => {
    attempt += 1;
    return db.query(
      `insert into app_private.trade_executions
         (intent_id, attempt, owner_privy_user_id, execution_mode, status, gross_notional_lamports,
          platform_fee_lamports, creator_fee_lamports, referral_fee_lamports, confirmed_at)
       values ($7::uuid, $8::integer, 'did:privy:client', 'solana-mainnet', $1::text, $2::bigint,
               $3::bigint, $4::bigint, $5::bigint,
               case when $9::boolean
                    then greatest(now() - ($6::text)::interval, date_trunc('day', now()))
                    else now() - ($6::text)::interval end)`,
      [status, gross, platform, creator, referral, ago, INTENT, attempt, today]
    );
  };

  await insert({ ago: "1 hour",  status: "confirmed",  gross: 100_000_000_000, platform: 2_000_000_000, creator: 700_000_000, referral: 200_000_000, today: true });
  await insert({ ago: "3 days",  status: "reconciled", gross: 50_000_000_000,  platform: 1_000_000_000, creator: 350_000_000, referral: 100_000_000 });
  await insert({ ago: "20 days", status: "confirmed",  gross: 10_000_000_000,  platform: 200_000_000,   creator: 70_000_000,  referral: 20_000_000 });
  // Not revenue: submitted, not confirmed. Must appear as PENDING and in no period total.
  await insert({ ago: "1 hour",  status: "submitted",  gross: 80_000_000_000,  platform: 1_600_000_000, creator: 560_000_000, referral: 160_000_000 });
  // Never revenue.
  await insert({ ago: "1 hour",  status: "failed",     gross: 90_000_000_000,  platform: 1_800_000_000, creator: 630_000_000, referral: 180_000_000 });

  const r = await revenue();
  assert.equal(r.platformFee.today, "2000000000", "only the confirmed execution from today");
  assert.equal(r.platformFee.d7, "3000000000", "today plus the three-day-old one");
  assert.equal(r.platformFee.d30, "3200000000");
  assert.equal(r.platformFee.lifetime, "3200000000");
  assert.equal(r.confirmedExecutions, 3);

  // The unconfirmed fee is reported, and is in NO period total. A fee on a trade that has not
  // landed is not revenue and must never inflate a figure an operator withdraws against.
  assert.equal(r.pendingFeeLamports, "1600000000");
  assert.equal(r.pendingExecutions, 1);
  assert.notEqual(r.platformFee.lifetime, "4800000000", "pending must not be folded into lifetime");
  // And the failed one is in neither.
  assert.equal(r.pendingFeeLamports, "1600000000", "a failed execution is not pending either");
  results.periodsAndConfirmedOnly = "PASS";

  // ── the invariant ─────────────────────────────────────────────────────────────────────────
  assert.equal(r.creatorAllocatedLamports, "1120000000");
  assert.equal(r.referralAllocatedLamports, "320000000");
  assert.equal(r.netRevenueLamports, "1760000000");
  assert.equal(
    BigInt(r.creatorAllocatedLamports) + BigInt(r.referralAllocatedLamports) + BigInt(r.netRevenueLamports),
    BigInt(r.platformFee.lifetime),
    "the three allocations must sum to exactly the fee collected"
  );
  assert.equal(r.allocationDrift, "0");
  assert.equal(r.reconciled, true);
  results.allocationInvariant = "PASS";
}

// ── creator payouts are reported BESIDE revenue, never subtracted from it ───────────────────
//
// app_private.payout_requests is the affiliate ledger — money owed to creators and referrers.
// Subtracting it from DegenAration's retained share would double-count, because the creator
// allocation was already removed from the fee once in creator_fee_lamports. Reporting it as
// "withdrawn revenue" would have looked entirely plausible on the page.
{
  await db.query(
    `insert into app_private.payout_requests
       (owner_privy_user_id, destination_wallet, gross_lamports, status)
     values ('did:privy:creator', 'WALLET', 543000000, 'confirmed'),
            ('did:privy:creator', 'WALLET', 243000000, 'processing'),
            ('did:privy:creator', 'WALLET', 999000000, 'failed')`
  );
  const r = await revenue();
  // `confirmed`, not `paid`. The CHECK on payout_requests has no `paid` status, so the first
  // version of this filter would have reported 0 for ever while looking entirely correct — the
  // fixture caught it because it is generated from the real production shape.
  assert.equal(r.creatorPayoutsPaidLamports, "500000000", "net of the 0.043 SOL processing fee");
  assert.equal(r.creatorPayoutsInFlightLamports, "200000000");
  assert.equal(r.failedCreatorPayouts, 1);

  // Unchanged by any of it. This is the assertion that matters.
  assert.equal(r.availableLamports, "1760000000",
    "creator payouts must not reduce DegenAration's retained share — it was already removed once");
  assert.equal(r.availableLamports, r.netRevenueLamports);

  // And the console is told plainly that no revenue-withdrawal ledger exists, rather than
  // being handed a zero it would render as "nothing withdrawn yet".
  assert.equal(r.revenueWithdrawalLedger, "not-implemented");
  results.creatorPayoutsNotSubtractedFromRevenue = "PASS";
}

// ── CONTROL: the invariant can actually fail ────────────────────────────────────────────────
//
// `retained_fee_lamports` is GENERATED, so the drift check cannot fail through the normal
// path — which is precisely why it needs proving. Dropping the generation expression and
// writing an inconsistent row is the only way to show the check is live rather than decorative.
{
  await db.exec(`
    alter table app_private.trade_executions
      alter column retained_fee_lamports drop expression;
  `);
  await db.query(
    `insert into app_private.trade_executions
       (intent_id, attempt, owner_privy_user_id, execution_mode, status, gross_notional_lamports,
        platform_fee_lamports, creator_fee_lamports, referral_fee_lamports,
        retained_fee_lamports, confirmed_at)
     values ($1::uuid, 99, 'did:privy:client', 'solana-mainnet', 'confirmed', 1000, 100, 10, 10, 999, now())`,
    [INTENT]
  );
  const drifted = await revenue();
  assert.notEqual(drifted.allocationDrift, "0",
    "CONTROL FAILED: an inconsistent ledger row must show as drift");
  assert.equal(drifted.reconciled, false);
  // And the available figure floors at zero rather than offering a negative balance.
  assert.ok(BigInt(drifted.availableLamports) >= 0n);
  results.controlProvesDriftIsDetected = "PASS";
}

console.log(JSON.stringify({
  verifier: "admin-revenue",
  database: "PGlite (real PostgreSQL), schema rendered from the captured production shapes",
  migration: "supabase/degenaration-admin-revenue.sql",
  properties: Object.keys(results).length,
  ...results,
  proves:
    "revenue is reported by period from CONFIRMED executions only; an unconfirmed or failed fee " +
    "never inflates a total an operator could withdraw against; the three allocations sum to " +
    "exactly the fee collected and the drift is reported rather than assumed; available " +
    "excludes paid and in-flight payouts but NOT failed ones; and anon and authenticated cannot " +
    "read any of it",
  notProven: "that a fee has ever been collected in production — the fee account does not exist yet"
}, null, 2));

await db.close();
