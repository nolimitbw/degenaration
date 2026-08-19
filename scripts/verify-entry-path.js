#!/usr/bin/env node
/**
 * End-to-end proof that a Discord call actually reaches a client's wallet -- and that when
 * it does NOT, the reason is recorded rather than lost.
 *
 * WHY THIS EXISTS: the commonest failure report on a copy-trading desk is "the source
 * called it and my wallet shows nothing". That has many causes and they look identical
 * from the outside: a filter the client set, a daily cap, a cooldown, a duplicate mint, a
 * subscription with no delegated wallet. worker_claim_call_execution decides all of them,
 * atomically, and writes a skip row saying which one fired. If that bookkeeping is wrong,
 * a client is left with silence and nobody can explain it.
 *
 * This runs the REAL server/engine/calls.js against the REAL worker_* functions in a local
 * PostgreSQL. Only the two calls that need a network are stubbed:
 *
 *   buyToken     would quote Jupiter   -> returns a fake unsigned tx
 *   signAndSend  would sign via Privy  -> returns a fake signature
 *
 * The claim protocol, every filter, the daily-cap arithmetic and the position opening are
 * all production code.
 *
 * USAGE
 *   Requires psql and a reachable PostgreSQL. Point PGURL at an EMPTY throwaway database
 *   -- this creates and drops tables. Never point it at production.
 *
 *     PGURL='postgresql://postgres@/entry?host=/tmp&port=5433' node scripts/verify-entry-path.js
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { executeCall } = require(path.join(__dirname, '..', 'server', 'engine', 'calls'));

const PGURL = process.env.PGURL;
if (!PGURL) {
  console.error('PGURL is required. Point it at an EMPTY throwaway database, never production.');
  process.exit(2);
}

const REPO = path.join(__dirname, '..');
const sql = (text) =>
  execFileSync('psql', [PGURL, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', text], { encoding: 'utf8' }).trim();
const file = (p) =>
  execFileSync('psql', [PGURL, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(REPO, p)], { encoding: 'utf8' });
const j = (text) => JSON.parse(sql(text));
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

const GROUP = '33333333-3333-3333-3333-333333333333';

function buildSchema() {
  sql(`
    drop table if exists app_private.position_exits;
    drop table if exists app_private.call_executions;
    drop table if exists public.positions;
    drop table if exists public.calls;
    drop table if exists public.subscriptions;
    create schema if not exists app_private;
    create extension if not exists pgcrypto;

    create table public.calls (
      id uuid primary key default gen_random_uuid(), group_id uuid, mint text,
      called_price_usd numeric, called_liquidity_usd numeric, called_mcap numeric,
      executed_at timestamptz, deleted_at timestamptz, parse_status text);

    create table public.subscriptions (
      id uuid primary key default gen_random_uuid(), user_id uuid, privy_user_id text,
      user_pubkey text, wallet_id text, group_id uuid, enabled boolean default true,
      size_sol numeric, daily_cap_sol numeric, daily_spent numeric, daily_spent_on date,
      slippage_bps int, tp1 numeric, tp1_sell numeric, tp2 numeric, tp2_sell numeric,
      stop_loss numeric,
      min_liquidity_usd numeric, max_mcap_usd numeric,
      cooldown_seconds int not null default 0,
      skip_duplicate_mints boolean not null default true,
      max_open_positions int, max_calls_per_day int);

    create table public.positions (
      id uuid primary key default gen_random_uuid(), user_id uuid, privy_user_id text,
      user_pubkey text, wallet_id text, mint text, entry_price_usd numeric,
      amount_raw numeric not null, opened_amount_raw numeric,
      tp1 numeric, tp1_sell numeric, tp2 numeric, tp2_sell numeric,
      stop_loss numeric, slippage_bps int, status text, entry_sig text, group_id uuid,
      call_id uuid, subscription_id uuid, opened_by text,
      last_price_usd numeric, last_checked_at timestamptz,
      filled_tp1 boolean default false, filled_tp2 boolean default false, closed_at timestamptz);
    create unique index positions_call_subscription_unique on public.positions (call_id, subscription_id)
      where call_id is not null and subscription_id is not null;

    create table app_private.call_executions (
      id uuid primary key default gen_random_uuid(),
      call_id uuid not null references public.calls(id) on delete cascade,
      subscription_id uuid not null references public.subscriptions(id) on delete cascade,
      claim_token uuid not null default gen_random_uuid(),
      status text not null check (status in ('claimed','succeeded','failed','skipped')),
      amount_sol numeric not null check (amount_sol >= 0),
      tx_signature text, error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      finished_at timestamptz,
      unique (call_id, subscription_id));

    create table app_private.position_exits (
      id uuid primary key default gen_random_uuid(), position_id uuid not null, leg text not null,
      claim_token uuid not null, status text not null, amount_raw numeric not null check (amount_raw > 0),
      trigger_multiple numeric, tx_signature text, error text,
      created_at timestamptz default now(), updated_at timestamptz, finished_at timestamptz,
      unique (position_id, leg));
  `);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    try { sql(`create role ${role}`); } catch { /* already exists */ }
  }
  // worker_finish_call_execution and worker_complete_call ship in the integrity
  // migration; the filters migration only replaces the claim. Extract just those two
  // rather than loading a file with unrelated dependencies.
  const integrity = require('fs').readFileSync(path.join(REPO, 'supabase/automation-execution-integrity.sql'), 'utf8');
  for (const fn of ['worker_finish_call_execution', 'worker_complete_call']) {
    const start = integrity.indexOf(`create or replace function public.${fn}`);
    if (start < 0) throw new Error(`could not find ${fn} in automation-execution-integrity.sql`);
    const end = integrity.indexOf('\n$$;', start);
    if (end < 0) throw new Error(`could not find the end of ${fn}`);
    execFileSync('psql', [PGURL, '-q', '-v', 'ON_ERROR_STOP=1', '-c', integrity.slice(start, end + 4)], { encoding: 'utf8' });
  }
  file('supabase/degenaration-subscription-filters.sql');
  file('supabase/degenaration-position-exits.sql');
  file('supabase/degenaration-tp-sell-basis.sql');
}

// ---- deps: real SQL behind them, only the chain calls stubbed ----
const buys = [];
let fillTokens = 1000;

const deps = {
  loadGroupSubscribers: async (groupId) =>
    JSON.parse(sql(`select coalesce(json_agg(s), '[]') from public.subscriptions s
                    where s.group_id = ${q(groupId)}::uuid and s.enabled = true`)),
  claimCallExecution: async (callId, subId) =>
    j(`select public.worker_claim_call_execution(${q(callId)}::uuid, ${q(subId)}::uuid)`),
  finishCallExecution: async (callId, subId, token, status, sig, err) =>
    j(`select public.worker_finish_call_execution(${q(callId)}::uuid, ${q(subId)}::uuid, ${q(token)}::uuid, ${q(status)}, ${sig ? q(sig) : 'null'}, ${err ? q(err) : 'null'})`),
  completeCall: async (callId) => j(`select public.worker_complete_call(${q(callId)}::uuid)`),
  openPosition: async (callId, subId, mint, entry, amountRaw, sig) =>
    j(`select public.worker_open_position(${q(callId)}::uuid, ${q(subId)}::uuid, ${q(mint)}, ${Number(entry)}, ${Number(amountRaw)}, ${q(sig)})`),
  getPrice: async () => 200,               // SOL price, for the cost basis
  verifyFill: async () => ({ ok: true, tokenAmount: fillTokens, tokenAmountRaw: String(fillTokens) }),
  // --- the only stubs ---
  buyToken: async (mint, sizeSol, pubkey) => { buys.push({ mint, sizeSol, pubkey }); return { tx: 'STUB_TX' }; },
  signAndSend: async () => `ENTRYSIG${buys.length}`,
  recordCopy: async () => {},
  onEvent: (e) => { if (String(e.type).includes('ERROR')) console.log('   event:', JSON.stringify(e)); }
};

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures += 1;
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

const newCall = (mint, opts = {}) => sql(
  `insert into public.calls (group_id, mint, called_price_usd, called_liquidity_usd, called_mcap)
   values (${q(GROUP)}::uuid, ${q(mint)}, 1.0, ${opts.liq ?? 50000}, ${opts.mcap ?? 100000}) returning id`);

const SUB_DEFAULTS = {
  group_id: `${q(GROUP)}::uuid`, enabled: 'true', user_pubkey: q('PUBKEY'),
  wallet_id: q('WALLET'), privy_user_id: q('privy1'),
  size_sol: '0.5', daily_cap_sol: '2', slippage_bps: '300',
  tp1: '2', tp1_sell: '50', tp2: '5', tp2_sell: '25', stop_loss: '40'
};
const lit = (v) => (v === null ? 'null' : typeof v === 'string' ? q(v) : String(v));
const newSub = (overrides = {}) => {
  const cols = { ...SUB_DEFAULTS };
  for (const [k, v] of Object.entries(overrides)) cols[k] = lit(v);
  return sql(`insert into public.subscriptions (${Object.keys(cols).join(',')})
              values (${Object.values(cols).join(',')}) returning id`);
};

const skipReason = (callId) => sql(`select coalesce(error,'') from app_private.call_executions where call_id = ${q(callId)}::uuid`);

async function main() {
  console.log('building schema and loading the real claim/filter functions');
  buildSchema();

  console.log('\n1. a clean call reaches the wallet and opens a position');
  let sub = newSub();
  let call = newCall('MINTA');
  await executeCall({ id: call, group_id: GROUP, mint: 'MINTA', called_price_usd: 1.0 }, deps);
  check('buys issued', buys.length, 1);
  check('size bought', buys[0]?.sizeSol, '0.5');
  check('execution status', sql(`select status from app_private.call_executions where call_id=${q(call)}::uuid`), 'succeeded');
  check('position opened', sql(`select count(*) from public.positions where call_id=${q(call)}::uuid`), '1');
  check('call marked executed', sql(`select (executed_at is not null)::text from public.calls where id=${q(call)}::uuid`), 'true');

  console.log('\n2. the same call replayed does NOT buy twice');
  await executeCall({ id: call, group_id: GROUP, mint: 'MINTA', called_price_usd: 1.0 }, deps);
  check('buys issued', buys.length, 1);

  console.log('\n3. a subscription with no delegated wallet is skipped WITH A REASON');
  sql(`delete from app_private.call_executions; delete from public.positions; delete from public.subscriptions;`);
  sub = newSub({ wallet_id: null });
  call = newCall('MINTB');
  const before = buys.length;
  await executeCall({ id: call, group_id: GROUP, mint: 'MINTB', called_price_usd: 1.0 }, deps);
  check('buys issued', buys.length, before);
  check('skip recorded', skipReason(call), 'delegated wallet unavailable');

  console.log('\n4. a call under the client\'s minimum liquidity is skipped with its reason');
  sql(`delete from app_private.call_executions; delete from public.subscriptions;`);
  sub = newSub({ min_liquidity_usd: 25000 });
  call = newCall('MINTC', { liq: 900 });
  await executeCall({ id: call, group_id: GROUP, mint: 'MINTC', called_price_usd: 1.0 }, deps);
  check('skip recorded', skipReason(call), 'below your minimum liquidity');

  console.log('\n5. the daily SOL cap stops the buy before it is sent');
  sql(`delete from app_private.call_executions; delete from public.subscriptions;`);
  sub = newSub({ daily_cap_sol: 0.4 });   // one 0.5 SOL buy already exceeds it
  call = newCall('MINTD');
  await executeCall({ id: call, group_id: GROUP, mint: 'MINTD', called_price_usd: 1.0 }, deps);
  check('skip recorded', skipReason(call), 'daily cap reached');

  console.log('\n6. the same mint called twice is skipped the second time');
  sql(`delete from app_private.call_executions; delete from public.positions; delete from public.subscriptions;`);
  sub = newSub();
  const first = newCall('MINTE');
  await executeCall({ id: first, group_id: GROUP, mint: 'MINTE', called_price_usd: 1.0 }, deps);
  const second = newCall('MINTE');
  await executeCall({ id: second, group_id: GROUP, mint: 'MINTE', called_price_usd: 1.0 }, deps);
  check('skip recorded', skipReason(second), 'you already bought this token from this source');

  console.log('\n7. the daily cap accrues across calls, it does not reset per call');
  sql(`delete from app_private.call_executions; delete from public.positions; delete from public.subscriptions;`);
  sub = newSub({ daily_cap_sol: 1.2, skip_duplicate_mints: false });  // 0.5 fits twice, not three times
  for (const mint of ['M1', 'M2', 'M3']) {
    const c = newCall(mint);
    await executeCall({ id: c, group_id: GROUP, mint, called_price_usd: 1.0 }, deps);
  }
  check('claims that succeeded', sql(`select count(*) from app_private.call_executions where status='succeeded'`), '2');
  check('third skipped for cap', sql(`select count(*) from app_private.call_executions where error='daily cap reached'`), '1');
  check('daily_spent', sql(`select daily_spent from public.subscriptions`), '1.0');

  console.log('\n8. an unconfirmed fill never opens a position (no bag with no way out)');
  sql(`delete from app_private.call_executions; delete from public.positions; delete from public.subscriptions;`);
  sub = newSub();
  call = newCall('MINTF');
  const savedVerify = deps.verifyFill;
  deps.verifyFill = async () => ({ ok: false, error: 'not confirmed' });
  await executeCall({ id: call, group_id: GROUP, mint: 'MINTF', called_price_usd: 1.0 }, deps);
  check('positions opened', sql(`select count(*) from public.positions`), '0');
  check('execution still recorded', sql(`select status from app_private.call_executions where call_id=${q(call)}::uuid`), 'succeeded');
  deps.verifyFill = savedVerify;

  console.log('');
  if (failures) { console.log(`${failures} check(s) FAILED`); process.exit(1); }
  console.log('all checks passed — every skip is recorded with the reason a client can be told');
}

main().catch((e) => { console.error('\nharness error:', e.message); process.exit(1); });
