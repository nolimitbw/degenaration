-- What closed a position, and at what price.
--
-- WHY
--
-- The losing-trade PnL card (§18) refuses to render for a closed position, and the reason
-- recorded in the route is exact:
--
--     "a closed trade's average exit price cannot be derived, because no ledger links a
--      position to the executions that closed it"
--
-- That was true. degenaration-exit-settlement.sql makes it false: app_private.position_exits
-- records, per exit execution, the quantity taken from that position, the cost basis
-- released, the proceeds received and the realized PnL. Average entry and average exit both
-- follow from it by division, with no price feed and nothing inferred.
--
-- WHAT IT DOES NOT DO
--
-- It does not fill in an exit price for an exit whose proceeds the worker never reported.
-- `unpricedExits` is returned so the caller can say precisely that, instead of showing a
-- number nobody measured or blaming a price provider for a ledger gap.
--
-- Ownership is enforced inside the function, not by the caller: the position must belong to
-- the requesting user or the call raises. A share card is a public artifact and this is the
-- query that decides what goes on it.
--
-- Forward safety: one new function. Nothing existing is altered.
-- Rollback: drop the function.

create or replace function public.app_user_position_exits(
  p_secret text,
  p_privy_user_id text,
  p_position_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position app_private.positions%rowtype;
  v_exits jsonb;
  v_quantity numeric := 0;
  v_basis bigint := 0;
  v_proceeds bigint := 0;
  v_realized bigint := 0;
  v_measured integer := 0;
  v_unpriced integer := 0;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_position
    from app_private.positions
   where id = p_position_id
     and owner_privy_user_id = p_privy_user_id;

  if not found then
    -- Deliberately the same answer whether the position does not exist or belongs to someone
    -- else. A share-card endpoint must not confirm the existence of another user's position.
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
    into v_exits
  from (
    select
      e.id,
      e.quantity_base_units::text as "quantityBaseUnits",
      e.cost_basis_lamports::text as "costBasisLamports",
      e.proceeds_lamports::text as "proceedsLamports",
      e.realized_pnl_lamports::text as "realizedPnlLamports",
      e.basis_incomplete as "basisIncomplete",
      t.tx_signature as "txSignature",
      e.created_at
    from app_private.position_exits e
    join app_private.trade_executions t on t.id = e.exit_execution_id
    where e.position_id = p_position_id
  ) x;

  select
    coalesce(sum(e.quantity_base_units), 0),
    coalesce(sum(e.cost_basis_lamports), 0),
    -- Only measured exits contribute to proceeds and realized PnL. Summing over a null would
    -- report the priced part of a sale as if it were the whole of it.
    coalesce(sum(e.proceeds_lamports) filter (where e.proceeds_lamports is not null), 0),
    coalesce(sum(e.realized_pnl_lamports) filter (where e.realized_pnl_lamports is not null), 0),
    count(*) filter (where e.proceeds_lamports is not null),
    count(*) filter (where e.proceeds_lamports is null)
  into v_quantity, v_basis, v_proceeds, v_realized, v_measured, v_unpriced
  from app_private.position_exits e
  where e.position_id = p_position_id;

  return jsonb_build_object(
    'ok', true,
    'position', jsonb_build_object(
      'id', v_position.id,
      'mint', v_position.mint,
      'status', v_position.status,
      'quantityBaseUnits', v_position.quantity_base_units::text,
      'costLamports', v_position.cost_lamports::text,
      'realizedPnlLamports', v_position.realized_pnl_lamports::text,
      'feesLamports', v_position.fees_lamports::text,
      'openedAt', v_position.opened_at,
      'closedAt', v_position.closed_at
    ),
    'exits', v_exits,
    'aggregate', jsonb_build_object(
      'exitCount', v_measured + v_unpriced,
      'measuredExits', v_measured,
      'unpricedExits', v_unpriced,
      'exitedQuantityBaseUnits', v_quantity::text,
      'releasedBasisLamports', v_basis::text,
      'proceedsLamports', v_proceeds::text,
      'realizedPnlLamports', v_realized::text,
      -- The one flag the card needs: every exit measured, so an average exit price is a
      -- statement about the whole position rather than the part that happened to be priced.
      'fullyMeasured', v_unpriced = 0 and v_measured > 0
    )
  );
end;
$$;

revoke execute on function public.app_user_position_exits(text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_user_position_exits(text, text, uuid) to service_role;
