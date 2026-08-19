#!/usr/bin/env node
/**
 * End-to-end proof that a position actually exits.
 *
 * WHY THIS EXISTS: the exit path is the part of this system that has never signed a real
 * transaction, and it is the part that decides whether a client gets out of a trade. The
 * unit tests cover monitor.js with fake claims; the SQL tests cover the functions with
 * fake ticks. Neither proves the two halves agree with each other.
 *
 * This runs the REAL server/engine/monitor.js against the REAL worker_* functions in a
 * local PostgreSQL, walking a position up through TP1 and TP2 and then down into the
 * stop-loss. Only the two things that need a network are stubbed:
 *
 *   sellToken    would quote Jupiter          -> returns a fake unsigned tx
 *   signAndSend  would sign via Privy         -> returns a fake signature
 *
 * Everything else is production code: the exit decision, the claim protocol, the amount
 * arithmetic, the position bookkeeping.
 *
 * USAGE
 *   Requires psql and a reachable PostgreSQL. Point PGURL at an EMPTY throwaway database
 *   -- this creates and drops tables. Never point it at production.
 *
 *     PGURL='postgresql://postgres@/postgres?host=/tmp&port=5433' node scripts/verify-exit-ladder.js
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { runExitTick } = require(path.join(__dirname, '..', 'server', 'engine', 'monitor'));

const PGURL = process.env.PGURL;
if (!PGURL) {
  console.error('PGURL is required. Point it at an EMPTY throwaway database, never production.');
  process.exit(2);
}

const sql = (text) =>
  execFileSync('psql', [PGURL, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', text], { encoding: 'utf8' }).trim();

const REPO = path.join(__dirname, '..');
const file = (p) =>
  execFileSync('psql', [PGURL, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(REPO, p)], { encoding: 'utf8' });

// ---- schema: just enough of the real tables for the real functions to run ----
function buildSchema() {
  sql(`
    drop table if exists app_private.position_exits;
    drop table if exists public.positions;
    drop table if exists public.subscriptions;
    create schema if not exists app_private;
    create extension if not exists pgcrypto;

    create table public.subscriptions (
      id uuid primary key default gen_random_uuid(), user_id uuid, privy_user_id text,
      user_pubkey text, wallet_id text, group_id uuid,
      tp1 numeric, tp1_sell numeric, tp2 numeric, tp2_sell numeric,
      stop_loss numeric, slippage_bps int);

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
  // The real functions, exactly as they ship.
  file('supabase/degenaration-position-exits.sql');
  file('supabase/degenaration-tp-sell-basis.sql');
}

// ---- deps: real SQL behind them, network calls stubbed ----
const j = (text) => JSON.parse(sql(text));
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

let price = 1;                       // driven by the script below
const sells = [];                    // every sell the engine actually issued

const deps = {
  loadOpenPositions: async () => {
    const rows = sql(`select coalesce(json_agg(p), '[]') from public.positions p where p.status = 'open'`);
    return JSON.parse(rows);
  },
  getPrice: async () => price,
  claimPositionExit: async (id, leg, multiple) =>
    j(`select public.worker_claim_position_exit(${q(id)}::uuid, ${q(leg)}, ${Number(multiple)})`),
  finishPositionExit: async (id, leg, token, status, sig, err) =>
    j(`select public.worker_finish_position_exit(${q(id)}::uuid, ${q(leg)}, ${q(token)}::uuid, ${q(status)}, ${sig ? q(sig) : 'null'}, ${err ? q(err) : 'null'})`),
  touchPosition: async (id, p) => { sql(`update public.positions set last_price_usd = ${Number(p)}, last_checked_at = now() where id = ${q(id)}::uuid`); },
  // --- the only stubs ---
  sellToken: async (mint, amountRaw) => { sells.push({ mint, amountRaw: String(amountRaw) }); return { tx: 'STUB_TX' }; },
  signAndSend: async () => `STUBSIG${sells.length}`,
  recordTrade: async () => {},
  onEvent: (e) => { if (String(e.type).includes('ERROR')) console.log('   event:', JSON.stringify(e)); }
};

// ---- the walk ----
let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures += 1;
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

async function main() {
  console.log('building schema and loading the real exit functions');
  buildSchema();

  // TP1 sells 50% at 2x, TP2 sells 25% at 5x, stop-loss at -40%. 1000 tokens, entry $1.
  sql(`insert into public.subscriptions (id, user_pubkey, wallet_id, tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps)
       values ('11111111-1111-1111-1111-111111111111','PUBKEY','WALLET',2,50,5,25,40,300)`);
  const opened = j(`select public.worker_open_position(
      '22222222-2222-2222-2222-222222222222'::uuid,
      '11111111-1111-1111-1111-111111111111'::uuid,
      'MINT', 1.0, 1000, 'entrysig')`);
  if (!opened.ok) throw new Error('could not open the position: ' + JSON.stringify(opened));

  console.log('\n1. price flat at entry — nothing should sell');
  price = 1.0;
  await runExitTick(deps);
  check('sells issued', sells.length, 0);

  console.log('\n2. price at 2x — TP1 only, 50% of the opening fill');
  price = 2.0;
  await runExitTick(deps);
  check('sells issued', sells.length, 1);
  check('TP1 amount', sells[0]?.amountRaw, '500');
  check('still held', sql(`select amount_raw from public.positions`), '500');

  console.log('\n3. price at 5x — TP2, 25% of the OPENING fill (not of what is left)');
  price = 5.0;
  await runExitTick(deps);
  check('sells issued', sells.length, 2);
  check('TP2 amount', sells[1]?.amountRaw, '250');
  check('still held', sql(`select amount_raw from public.positions`), '250');

  console.log('\n4. price back at 5x — legs already filled, nothing re-sells');
  await runExitTick(deps);
  check('sells issued', sells.length, 2);

  console.log('\n5. price collapses to -40% — stop-loss takes everything left');
  price = 0.6;
  await runExitTick(deps);
  check('sells issued', sells.length, 3);
  check('stop-loss amount', sells[2]?.amountRaw, '250');
  check('position status', sql(`select status from public.positions`), 'closed');
  check('nothing still held', sql(`select amount_raw from public.positions`), '0');

  console.log('\n6. a closed position is never touched again');
  await runExitTick(deps);
  check('sells issued', sells.length, 3);

  console.log('\n7. a missing price SKIPS rather than dumping the position');
  sql(`update public.positions set status='open', amount_raw=100, opened_amount_raw=100,
       filled_tp1=false, filled_tp2=false, closed_at=null`);
  sql(`delete from app_private.position_exits`);
  const savedGetPrice = deps.getPrice;
  deps.getPrice = async () => null;
  await runExitTick(deps);
  check('sells issued', sells.length, 3);
  check('position still open', sql(`select status from public.positions`), 'open');
  deps.getPrice = savedGetPrice;

  console.log('');
  if (failures) { console.log(`${failures} check(s) FAILED`); process.exit(1); }
  console.log('all checks passed — the real engine and the real SQL agree');
}

main().catch((e) => { console.error('\nharness error:', e.message); process.exit(1); });
