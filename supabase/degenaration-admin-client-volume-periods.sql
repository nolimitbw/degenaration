-- Controller section 5 / master spec section 8: per-client volume BY PERIOD, plus the
-- operational health columns the client table is specified to carry.
--
-- Apply after degenaration-admin-client-ledger.sql, which this extends.
-- Rollback: reapply that file. Read-only RPC, no DDL, no DML — rollback loses only the
-- added response fields.
--
-- WHAT WAS MISSING
--
-- Both the controller and master spec section 8 list, for every client:
--
--     volume today; 7D / 30D / lifetime volume
--     failed withdrawals / executions
--     reconciliation warnings
--
-- admin_client_ledger returned one lifetime `executedVolumeLamports` and none of the rest.
-- An operator could see that a client had traded 40 SOL in total and had no way to tell
-- whether that was this morning or three weeks ago — which is the question the column
-- exists to answer, and the one that matters when deciding whether a client is active.
--
-- Definitions, kept identical to every other volume figure in the product so the console,
-- the marketplace and the business summary cannot disagree:
--
--   volume  = sum(gross_notional_lamports) over executions in ('confirmed','reconciled')
--   the clock is confirmed_at, falling back to created_at for a row confirmed before that
--   column was written, so an execution is never counted in a window it did not occur in
--   "today" is UTC, matching every other timestamp in this schema
--
-- A reconciliation warning is an execution that confirmed on chain and never reconciled
-- into the ledger. That is the exact shape of the defect class this project has hit four
-- times — a row that exists on one side and not the other — and it is silent by nature, so
-- it is surfaced as a count per client rather than left to be noticed.

create or replace function public.admin_client_ledger(
  p_secret text,
  p_actor_privy_user_id text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  -- Role check as well as the shared secret: the secret authenticates the CALLER (the edge
  -- function), the role check authorizes the ACTOR. Both are required, exactly as every other
  -- admin RPC in this schema does it.
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x."executedVolumeLamports" desc), '[]'::jsonb)
  into v_rows
  from (
    select
      u.privy_user_id as "privyUserId",
      u.status,
      u.created_at as "createdAt",

      -- The wallet the operator can look up on chain. Null until the user signs in on a build
      -- carrying the registration call site.
      (select w.address from app_private.trading_wallets w
        where w.privy_user_id = u.privy_user_id and w.is_primary and w.status = 'active'
        limit 1) as "walletAddress",

      -- Executed notional across confirmed and reconciled executions. This is trading volume.
      (select coalesce(sum(e.gross_notional_lamports), 0)::text
         from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status in ('confirmed', 'reconciled')) as "executedVolumeLamports",
      (select count(*) from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status in ('confirmed', 'reconciled')) as "executionCount",

      -- The same figure, windowed. Same status set and same clock as the lifetime total, so
      -- lifetime is always >= 30D >= 7D >= today by construction rather than by coincidence.
      (select coalesce(sum(e.gross_notional_lamports), 0)::text
         from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status in ('confirmed', 'reconciled')
          and coalesce(e.confirmed_at, e.created_at) >= date_trunc('day', now() at time zone 'utc'))
        as "volumeTodayLamports",
      (select coalesce(sum(e.gross_notional_lamports), 0)::text
         from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status in ('confirmed', 'reconciled')
          and coalesce(e.confirmed_at, e.created_at) >= now() - interval '7 days')
        as "volume7dLamports",
      (select coalesce(sum(e.gross_notional_lamports), 0)::text
         from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status in ('confirmed', 'reconciled')
          and coalesce(e.confirmed_at, e.created_at) >= now() - interval '30 days')
        as "volume30dLamports",

      -- Operational health. Zero is the expected reading; anything else is a client whose
      -- money moved in a way that needs a human.
      (select count(*) from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status in ('failed', 'dropped', 'expired')) as "failedExecutions",
      (select count(*) from app_private.withdrawal_intents w
        where w.owner_privy_user_id = u.privy_user_id
          and w.state in ('failed', 'reversed')) as "failedWithdrawals",
      -- Confirmed on chain, never reconciled into the ledger. The grace period keeps a
      -- normally in-flight settlement from being reported as an incident.
      (select count(*) from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status = 'confirmed'
          and e.reconciled_at is null
          and coalesce(e.confirmed_at, e.created_at) < now() - interval '15 minutes')
        as "reconciliationWarnings",

      -- Platform revenue attributable to this client.
      (select coalesce(sum(e.platform_fee_lamports), 0)::text
         from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status in ('confirmed', 'reconciled')) as "platformFeeLamports",
      (select coalesce(sum(e.creator_fee_lamports), 0)::text
         from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id
          and e.status in ('confirmed', 'reconciled')) as "creatorFeeLamports",

      -- Capital the user has committed but not yet spent. Real, and readable from SQL.
      (select coalesce(sum(i.reserved_lamports), 0)::text
         from app_private.trade_intents i
        where i.owner_privy_user_id = u.privy_user_id
          and i.reserved_lamports > 0) as "committedLamports",

      (select count(*) from app_private.positions p
        where p.owner_privy_user_id = u.privy_user_id and p.status = 'open') as "openPositions",
      (select coalesce(sum(p.cost_lamports), 0)::text from app_private.positions p
        where p.owner_privy_user_id = u.privy_user_id and p.status = 'open') as "openCostLamports",
      (select coalesce(sum(p.realized_pnl_lamports), 0)::text from app_private.positions p
        where p.owner_privy_user_id = u.privy_user_id) as "realizedPnlLamports",

      -- Withdrawals, split by whether they have actually settled.
      (select coalesce(sum(w.amount_lamports), 0)::text
         from app_private.withdrawal_intents w
        where w.owner_privy_user_id = u.privy_user_id and w.state = 'confirmed')
        as "withdrawnLamports",
      (select coalesce(sum(w.amount_lamports), 0)::text
         from app_private.withdrawal_intents w
        where w.owner_privy_user_id = u.privy_user_id
          and w.state in ('created', 'signing', 'submitted')) as "pendingWithdrawalLamports",

      -- Bot usage, split by kind so the operator can see which product a client uses.
      (select count(*) from app_private.bot_profiles b
        where b.owner_privy_user_id = u.privy_user_id
          and b.kind = 'discord' and b.status <> 'archived') as "discordBots",
      (select count(*) from app_private.bot_profiles b
        where b.owner_privy_user_id = u.privy_user_id
          and b.kind = 'kol' and b.status <> 'archived') as "kolBots",

      -- Affiliate position: what this client is owed as a creator or referrer.
      (select coalesce(sum(l.amount_lamports), 0)::text
         from app_private.commission_ledger_entries l
        where l.account_owner_privy_user_id = u.privy_user_id) as "commissionBalanceLamports",

      (select max(e.confirmed_at) from app_private.trade_executions e
        where e.owner_privy_user_id = u.privy_user_id) as "lastTradeAt"
    from app_private.app_users u
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'clients', v_rows,
    -- Stated so the console can label it honestly rather than implying the server holds funds.
    'custodyModel', 'non-custodial',
    'balanceNote', 'On-chain balances are not readable from the database. walletAddress is '
                || 'provided for chain lookup; every other figure is ledger-derived.'
  );
end;
$$;

revoke execute on function public.admin_client_ledger(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_client_ledger(text, text, integer) to service_role;
