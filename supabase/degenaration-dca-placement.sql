-- Dollar-cost averaging: the durable state that makes it placeable rather than merely stored.
--
-- THE FOUR CONTROLS
--
-- `dca.enabled`, `dca.levels`, `dca.expirationMinutes` and `dca.maximumEntries` have been
-- persisted, validated, versioned, reloaded and COUNTED TOWARD REQUIRED CAPITAL since the
-- builder shipped. `lib/planned-capital.js` adds every enabled level into the minimum the user
-- is told to fund. And nothing has ever placed one.
--
-- That is the worst shape this defect class takes. The other unenforced controls cost the user
-- nothing; this one reserves their money. A bot configured with 0.05 entry and two 0.25 DCA
-- levels tells its owner to fund 0.55 SOL per position and then only ever spends 0.05.
--
-- WHY A COLUMN AND NOT A DERIVED COUNT
--
-- A DCA decision is "price is N% below entry and level K has not been placed". Without a
-- durable record of K, the monitor re-fires the same level on every tick — a 5-second poll
-- would buy the level twelve times a minute until the capital limit refused it, and the refusal
-- would name the wrong control.
--
-- It cannot be derived from `position_lots` either: a lot records that SOL was spent, not which
-- configured level authorised it, and two levels with the same allocation would be
-- indistinguishable. The level index is the fact; it has to be stored as the fact.
--
-- `filled_dca_levels` mirrors `filled_levels` exactly — same jsonb array of integers, same
-- append-only discipline, same reason. Take profit learned this first.
--
-- WHY THE EXPIRY IS ANCHORED TO THE POSITION, NOT THE TICK
--
-- `dca.expirationMinutes` means "stop adding after N minutes". Anchored to the position's
-- opening, that is a fixed window a user can reason about. Anchored to the last fill it would
-- extend itself every time it fired, and a bot in a long slow decline would keep averaging down
-- for ever — the opposite of what an expiry is for. `opened_at` already exists, so the decision
-- layer reads it and this migration adds nothing for it.
--
-- Forward safety: one nullable-defaulted column and one new function. `worker_open_position`
-- and `worker_settle_position_exit` are NOT touched, so no arity changes and no overload risk.
-- Rollback: supabase/rollback/22-dca-placement.sql.

alter table public.positions
  add column if not exists filled_dca_levels jsonb not null default '[]'::jsonb;

/**
 * Record that a DCA level has been placed, and add its purchase to the position.
 *
 * ONE STATEMENT, deliberately. Marking the level and growing the position are the same fact:
 * doing them in two calls leaves a window where the level is marked and the tokens are not
 * counted (the position under-reports what it holds, and the exit undersells) or the tokens are
 * counted and the level is not marked (the next tick buys the level again).
 *
 * IDEMPOTENT ON THE LEVEL. A replay for a level already recorded returns `duplicate: true` and
 * changes nothing — the same guarantee `worker_open_position` gives on `entry_sig`, and for the
 * same reason: a worker that dies between submitting and recording must be able to retry
 * without buying twice.
 */
create or replace function public.worker_record_dca_fill(
  p_id uuid,
  p_level integer,
  p_amount_raw numeric,
  p_fill_price_usd numeric,
  p_sig text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.positions%rowtype;
  v_before numeric;
  v_new_entry numeric;
begin
  if p_level is null or p_level < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid level', 'status', 400);
  end if;
  if p_amount_raw is null or p_amount_raw <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid amount', 'status', 400);
  end if;
  -- The price the fill happened at, per unit, in the same denomination entry_price_usd already
  -- uses. Taken as a parameter rather than derived from SOL spent: sol/amount is a rate in SOL,
  -- and multiplying it back out to weight a USD price is arithmetic that happens to typecheck
  -- and means nothing. The monitor already holds the USD price it made the decision on.
  if p_fill_price_usd is null or p_fill_price_usd <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid fill price', 'status', 400);
  end if;

  select * into v_row from public.positions where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'position not found', 'status', 404);
  end if;

  -- Replay. Returns success so a retrying worker does not treat it as a fault, but changes
  -- nothing — the tokens from the first call are already in amount_raw.
  if v_row.filled_dca_levels @> to_jsonb(array[p_level]) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'level', p_level);
  end if;

  -- A closed or exiting position must not be added to. Buying into a position that is already
  -- selling is how an exit undersells: the sell amount was computed from a balance that grew
  -- underneath it.
  if v_row.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'position is not open', 'status', 409);
  end if;

  v_before := coalesce(v_row.amount_raw, 0);

  -- Volume-weighted average entry. Every exit decision — take profit, stop loss, trailing — is
  -- measured against entry_price_usd, so a DCA that did not move it would leave the whole exit
  -- plan anchored to a price the position no longer averages: the stop would sit far below
  -- where the user's money actually is, which is the opposite of averaging down.
  v_new_entry := case
    when v_row.entry_price_usd is null or v_row.entry_price_usd <= 0 then p_fill_price_usd
    when v_before + p_amount_raw > 0
      then ((v_row.entry_price_usd * v_before) + (p_fill_price_usd * p_amount_raw))
           / (v_before + p_amount_raw)
    else v_row.entry_price_usd
  end;

  update public.positions
  set amount_raw = v_before + p_amount_raw,
      -- The ORIGINAL grows too. Take-profit allocations are percentages of the original, so
      -- leaving it behind would make every TP level sell a smaller share of a larger position
      -- and strand tokens the user asked to be sold.
      original_amount_raw = coalesce(original_amount_raw, v_before) + p_amount_raw,
      entry_price_usd = v_new_entry,
      -- The peak is a MULTIPLE of entry once normalized, so raising the average entry without
      -- rebasing the recorded peak price would make a trailing stop believe the position had
      -- fallen further from its high than it has, and fire early. Floored at the new entry,
      -- which is exactly where a fresh position starts.
      peak_price_usd = greatest(coalesce(peak_price_usd, v_new_entry), v_new_entry),
      filled_dca_levels = coalesce(filled_dca_levels, '[]'::jsonb) || to_jsonb(array[p_level]),
      -- A DCA fill is new evidence about the price, so any stop breach observed before it is
      -- stale: the threshold it was measured against has just moved.
      --
      -- No `updated_at` here: public.positions does not have one. An earlier draft set it and
      -- would have failed to apply with "column does not exist" — caught by the fixture, which
      -- is generated from the captured production shape rather than written by hand.
      stop_breached_at = null
  where id = p_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'level', p_level,
    'amountRaw', v_row.amount_raw::text,
    'entryPriceUsd', v_row.entry_price_usd,
    'filledDcaLevels', v_row.filled_dca_levels,
    'signature', p_sig
  );
end;
$$;

revoke execute on function public.worker_record_dca_fill(uuid, integer, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.worker_record_dca_fill(uuid, integer, numeric, numeric, text)
  to service_role;
