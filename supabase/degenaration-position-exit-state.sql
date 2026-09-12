-- Position lifecycle: capture on fill, durable pending-exit state, atomic exit claims.
--
-- WHY THIS EXISTS. `public.positions` was created for "the 24/7 monitor reads these open
-- rows to fire per-subscription TP/SL sells" and was never read or written. The monitor
-- took its positions as an in-memory parameter with no producer, so take-profit and
-- stop-loss could never fire on anything the worker bought, and a restart would abandon
-- every open position.
--
-- Restoring automated exits needs three things this migration supplies:
--   1. the data captured at fill time (entry price and the amount ACTUALLY received);
--   2. a pending-exit state that survives a restart, so a submitted-but-unconfirmed sell
--      blocks a second sell instead of being re-fired or believed complete;
--   3. an atomic claim, so a second worker instance loses the race rather than
--      double-selling a user's position.
--
-- Idempotent: safe to re-run. Forward-safe: every column is added with a default that
-- leaves existing rows valid.

-- ---------------------------------------------------------------------------
-- 0. Base table
-- ---------------------------------------------------------------------------
--
-- `supabase/add-positions-table.sql` was written but NEVER APPLIED — verified against the
-- live catalog, where `public.positions` does not exist. This migration is therefore
-- self-contained rather than assuming that file ran: it creates the table when absent and
-- upgrades it when present, so either starting state converges.

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_pubkey text not null,
  wallet_id text,
  mint text not null,
  entry_price_usd numeric not null,
  amount_raw numeric not null,           -- raw token units held (not human amount)
  tp1 numeric, tp1_sell int default 50,
  tp2 numeric, tp2_sell int default 25,
  stop_loss int,
  slippage_bps int not null default 300,
  filled_tp1 boolean not null default false,
  filled_tp2 boolean not null default false,
  status text not null default 'open',
  entry_sig text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table public.positions enable row level security;

-- A position is the user's own record of what they hold. Readable and writable only by its
-- owner; the worker reaches it through service_role, which bypasses RLS.
drop policy if exists "own positions" on public.positions;
create policy "own positions" on public.positions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.positions
  -- Attribution, so a realised sell can be written to the trade ledger with the same
  -- identity the opening buy carried.
  add column if not exists privy_user_id text,
  add column if not exists group_id uuid,
  -- Take-profit shares are fractions of the ORIGINAL position, never of what an earlier
  -- level left behind. Without this the second level silently under-sells.
  add column if not exists original_amount_raw numeric,
  -- Pending exit: set at claim time, cleared on settlement. While pending_exit_claim_token
  -- is non-null the position is BLOCKED from firing another exit.
  add column if not exists pending_exit_kind text,
  add column if not exists pending_exit_sig text,
  add column if not exists pending_exit_amount_raw numeric,
  add column if not exists pending_exit_claim_token uuid,
  add column if not exists pending_exit_at timestamptz,
  add column if not exists exit_attempts integer not null default 0,
  add column if not exists last_exit_error text;

-- Backfill the original amount for any row created before the column existed. A position
-- that has not yet taken profit still holds its whole original size, so the current amount
-- is the correct value rather than a guess.
update public.positions
set original_amount_raw = amount_raw
where original_amount_raw is null;

alter table public.positions
  drop constraint if exists positions_status_check;

alter table public.positions
  add constraint positions_status_check
  check (status in ('open', 'exiting', 'closed', 'error'));

alter table public.positions
  drop constraint if exists positions_pending_exit_kind_check;

alter table public.positions
  add constraint positions_pending_exit_kind_check
  check (pending_exit_kind is null or pending_exit_kind in ('SL', 'TP1', 'TP2'));

-- Amounts are token counts and can never be negative.
alter table public.positions
  drop constraint if exists positions_amount_nonnegative_check;

alter table public.positions
  add constraint positions_amount_nonnegative_check
  check (amount_raw >= 0 and coalesce(original_amount_raw, 0) >= 0
         and coalesce(pending_exit_amount_raw, 0) >= 0);

-- A claimed exit must carry its claim token, and a status of 'exiting' must mean exactly
-- that a claim is outstanding. This is the blocking invariant, enforced by the database
-- rather than only by the worker that happens to be running.
alter table public.positions
  drop constraint if exists positions_exiting_requires_claim_check;

alter table public.positions
  add constraint positions_exiting_requires_claim_check
  check ((status = 'exiting') = (pending_exit_claim_token is not null));

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- The monitor's loader: open positions to evaluate, plus exiting ones to reconcile.
create index if not exists positions_worker_queue_idx
  on public.positions (status, created_at)
  where status in ('open', 'exiting');

-- DUPLICATE-TRADE PREVENTION. One confirmed buy signature opens at most one position, so a
-- retried or replayed fill capture cannot create a second position for the same trade.
create unique index if not exists positions_entry_sig_unique
  on public.positions (entry_sig)
  where entry_sig is not null;

-- ---------------------------------------------------------------------------
-- 3. Open a position on a confirmed fill
-- ---------------------------------------------------------------------------

create or replace function public.worker_open_position(
  p_user_pubkey text,
  p_wallet_id text,
  p_mint text,
  p_entry_price_usd numeric,
  p_amount_raw numeric,
  p_entry_sig text,
  p_slippage_bps integer default 300,
  p_tp1 numeric default null,
  p_tp1_sell integer default 0,
  p_tp2 numeric default null,
  p_tp2_sell integer default 0,
  p_stop_loss integer default null,
  p_privy_user_id text default null,
  p_group_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.positions%rowtype;
begin
  if nullif(trim(p_entry_sig), '') is null then
    return jsonb_build_object('ok', false, 'error', 'entry signature required', 'status', 400);
  end if;
  if p_amount_raw is null or p_amount_raw <= 0 then
    return jsonb_build_object('ok', false, 'error', 'amount must be positive', 'status', 400);
  end if;
  if p_entry_price_usd is null or p_entry_price_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'entry price required', 'status', 400);
  end if;

  insert into public.positions (
    user_id, privy_user_id, user_pubkey, wallet_id, group_id, mint,
    entry_price_usd, amount_raw, original_amount_raw,
    tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps, entry_sig, status
  ) values (
    p_user_id, p_privy_user_id, p_user_pubkey, p_wallet_id, p_group_id, p_mint,
    p_entry_price_usd, p_amount_raw, p_amount_raw,
    p_tp1, coalesce(p_tp1_sell, 0), p_tp2, coalesce(p_tp2_sell, 0),
    p_stop_loss, coalesce(p_slippage_bps, 300), trim(p_entry_sig), 'open'
  )
  on conflict (entry_sig) where entry_sig is not null do nothing
  returning * into v_row;

  if not found then
    -- Already captured. Idempotent by design: the caller retried, which must not open a
    -- second position for one buy.
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'position', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Claim an exit (atomic — exactly one winner)
-- ---------------------------------------------------------------------------

create or replace function public.worker_claim_position_exit(
  p_id uuid,
  p_kind text,
  p_amount_raw numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim uuid := gen_random_uuid();
  v_row public.positions%rowtype;
begin
  if p_kind not in ('SL', 'TP1', 'TP2') then
    return jsonb_build_object('ok', false, 'error', 'invalid exit kind', 'status', 400);
  end if;

  -- `status = 'open'` is the gate. A position already 'exiting' has an unresolved
  -- signature, so this UPDATE matches no row and the caller is told to stand down. That is
  -- what makes a second worker instance — or a tick that overlaps a slow in-flight sell —
  -- lose rather than submit a duplicate.
  update public.positions
  set status = 'exiting',
      pending_exit_kind = p_kind,
      pending_exit_amount_raw = p_amount_raw,
      pending_exit_claim_token = v_claim,
      pending_exit_at = now(),
      pending_exit_sig = null
  where id = p_id
    and status = 'open'
    and pending_exit_claim_token is null
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'exit unavailable', 'status', 409);
  end if;

  return jsonb_build_object('ok', true, 'claim_token', v_claim, 'position', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Record the submitted signature
-- ---------------------------------------------------------------------------

-- Written immediately after submission and before confirmation. If the process dies in
-- that gap the position stays claimed with no signature, which is recoverable; without
-- this write the sell would be invisible to the restarted worker.
create or replace function public.worker_record_position_exit_sig(
  p_id uuid,
  p_claim_token uuid,
  p_sig text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_sig), '') is null then
    return jsonb_build_object('ok', false, 'error', 'signature required', 'status', 400);
  end if;

  update public.positions
  set pending_exit_sig = trim(p_sig)
  where id = p_id
    and status = 'exiting'
    and pending_exit_claim_token = p_claim_token;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Settle a resolved exit
-- ---------------------------------------------------------------------------

create or replace function public.worker_settle_position_exit(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_amount_raw numeric,
  p_filled_tp1 boolean,
  p_filled_tp2 boolean,
  p_attempts integer,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('open', 'closed', 'error') then
    return jsonb_build_object('ok', false, 'error', 'invalid settlement status', 'status', 400);
  end if;
  if p_amount_raw is null or p_amount_raw < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid amount', 'status', 400);
  end if;

  -- Matching on the claim token is what stops a stale worker settling an exit that a
  -- different instance now owns.
  update public.positions
  set status = p_status,
      amount_raw = p_amount_raw,
      filled_tp1 = coalesce(p_filled_tp1, filled_tp1),
      filled_tp2 = coalesce(p_filled_tp2, filled_tp2),
      exit_attempts = coalesce(p_attempts, exit_attempts),
      last_exit_error = left(nullif(trim(coalesce(p_error, '')), ''), 300),
      closed_at = case when p_status = 'closed' then now() else closed_at end,
      pending_exit_kind = null,
      pending_exit_sig = null,
      pending_exit_amount_raw = null,
      pending_exit_claim_token = null,
      pending_exit_at = null
  where id = p_id
    and status = 'exiting'
    and pending_exit_claim_token = p_claim_token;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim mismatch', 'status', 409);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Privileges — worker only
-- ---------------------------------------------------------------------------

revoke execute on function public.worker_open_position(text, text, text, numeric, numeric, text, integer, numeric, integer, numeric, integer, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_open_position(text, text, text, numeric, numeric, text, integer, numeric, integer, numeric, integer, integer, text, uuid, uuid) to service_role;

revoke execute on function public.worker_claim_position_exit(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.worker_claim_position_exit(uuid, text, numeric) to service_role;

revoke execute on function public.worker_record_position_exit_sig(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.worker_record_position_exit_sig(uuid, uuid, text) to service_role;

revoke execute on function public.worker_settle_position_exit(uuid, uuid, text, numeric, boolean, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.worker_settle_position_exit(uuid, uuid, text, numeric, boolean, boolean, integer, text) to service_role;
