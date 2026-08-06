-- Nothing recorded WHY a position closed, so nothing could act on it.
--
-- THE DEFECT
--
-- `worker_settle_position_exit` carries the exit kind on the row as `pending_exit_kind` —
-- 'SL', 'TP1', 'TP2', 'TP3' — and clears it on settlement:
--
--     pending_exit_kind = null,
--
-- before anything reads it. So the moment a position closes, the fact that it stopped out
-- rather than took profit is gone. Three things depend on that fact and none could have it:
--
--   1. `stopLoss.freezeAfterStop`, a builder switch that has been persisted, validated,
--      versioned and reloaded since the builder shipped. Its whole meaning is "do not re-enter
--      this token after it stopped me out", and there was no way to know that it had.
--   2. Trade history and the losing PnL card cannot say how a trade ended.
--   3. A source's record cannot separate calls that were stopped out from calls closed in
--      profit, which is the difference between a risky source and a bad one.
--
-- THE FIX
--
-- Capture the kind from the row being settled, before the same statement nulls it. No new
-- argument and no arity change: the value is already there, it was simply thrown away.
--
-- `exit_reason` is only written when the position actually CLOSES. A partial take-profit
-- leaves the position open and must not stamp it as closed-by-TP1 — the reason belongs to the
-- exit that ended the position, not to every leg along the way.
--
-- Forward safety: one nullable column added, `worker_settle_position_exit` replaced at its
-- EXISTING arity (9) — no overload. No constraint narrowed, no grant changed, no row rewritten.
-- Existing closed positions keep `exit_reason` NULL, which reads as "closed before this was
-- recorded" rather than as a claim about how they ended.
-- Rollback: supabase/rollback/15-exit-reason.sql.

alter table public.positions
  add column if not exists exit_reason text;

alter table public.positions
  drop constraint if exists positions_exit_reason_check;
alter table public.positions
  add constraint positions_exit_reason_check
  check (exit_reason is null or exit_reason = 'SL' or exit_reason ~ '^TP[1-9][0-9]?$');

-- The claim enforcing freezeAfterStop asks "did this subscription stop out of this mint
-- recently", which is a lookup by owner and mint over stopped-out positions.
create index if not exists positions_stopped_out_idx
  on public.positions (user_pubkey, mint, closed_at desc)
  where exit_reason = 'SL';

create or replace function public.worker_settle_position_exit(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_amount_raw numeric,
  p_filled_tp1 boolean,
  p_filled_tp2 boolean,
  p_attempts integer,
  p_error text default null,
  p_filled_levels jsonb default null
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
  if p_filled_levels is not null and jsonb_typeof(p_filled_levels) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'filled levels must be an array', 'status', 400);
  end if;

  -- Matching on the claim token is what stops a stale worker settling an exit that a
  -- different instance now owns.
  update public.positions
  set status = p_status,
      amount_raw = p_amount_raw,
      filled_tp1 = coalesce(p_filled_tp1, filled_tp1),
      filled_tp2 = coalesce(p_filled_tp2, filled_tp2),
      filled_levels = coalesce(p_filled_levels, filled_levels),
      exit_attempts = coalesce(p_attempts, exit_attempts),
      last_exit_error = left(nullif(trim(coalesce(p_error, '')), ''), 300),
      closed_at = case when p_status = 'closed' then now() else closed_at end,
      -- Captured from the row being settled, in the same statement that clears it below. Only
      -- on a CLOSE: a partial take-profit leaves the position open, and stamping it as
      -- closed-by-TP1 would attribute the end of the position to a leg that did not end it.
      exit_reason = case when p_status = 'closed' then pending_exit_kind else exit_reason end,
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

revoke execute on function public.worker_settle_position_exit(
  uuid, uuid, text, numeric, boolean, boolean, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function public.worker_settle_position_exit(
  uuid, uuid, text, numeric, boolean, boolean, integer, text, jsonb
) to service_role;
