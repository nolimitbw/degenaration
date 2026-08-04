-- Spec section 8: admin client table with balances, trading volume and business insight.
--
-- WHY IT COULD NOT EXIST BEFORE
--
-- Every figure this returns is an aggregate over app_private.trade_executions,
-- app_private.positions and app_private.withdrawal_intents. Until
-- degenaration-settlement-writer.sql none of those had a writer, so a client table would have
-- shown zeros for everyone and been indistinguishable from a broken query. It is built now
-- because the aggregation sources finally exist.
--
-- WHAT IT DELIBERATELY DOES NOT CLAIM
--
-- There is no "client balance" in the custodial sense and this does not invent one.
-- DegenAration is non-custodial: a user's SOL sits in a wallet they control, and the server
-- cannot read a chain balance from SQL. What it CAN report is the registered wallet address,
-- so the operator can look it up, plus everything the ledger genuinely knows -- committed
-- capital, executed volume, fees, open positions, withdrawals. A column called "balance"
-- holding a number the database cannot verify would be worse than no column.
--
-- Forward safety: read-only RPCs; no table is altered and no row is written.
-- Rollback: drop the two functions.

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

-- Business totals for the dashboard header.
create or replace function public.admin_business_summary(
  p_secret text,
  p_actor_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  return jsonb_build_object(
    'ok', true,
    'clients', (select count(*) from app_private.app_users),
    'clientsWithWallet', (select count(distinct privy_user_id) from app_private.trading_wallets
                           where is_primary and status = 'active'),
    'executedVolumeLamports', (select coalesce(sum(gross_notional_lamports), 0)::text
                                 from app_private.trade_executions
                                where status in ('confirmed', 'reconciled')),
    'platformFeeLamports', (select coalesce(sum(platform_fee_lamports), 0)::text
                              from app_private.trade_executions
                             where status in ('confirmed', 'reconciled')),
    'creatorFeeLamports', (select coalesce(sum(creator_fee_lamports), 0)::text
                             from app_private.trade_executions
                            where status in ('confirmed', 'reconciled')),
    'referralFeeLamports', (select coalesce(sum(referral_fee_lamports), 0)::text
                              from app_private.trade_executions
                             where status in ('confirmed', 'reconciled')),
    'retainedFeeLamports', (select coalesce(sum(retained_fee_lamports), 0)::text
                              from app_private.trade_executions
                             where status in ('confirmed', 'reconciled')),
    'openPositions', (select count(*) from app_private.positions where status = 'open'),
    'committedLamports', (select coalesce(sum(reserved_lamports), 0)::text
                            from app_private.trade_intents where reserved_lamports > 0),
    'pendingWithdrawalLamports', (select coalesce(sum(amount_lamports), 0)::text
                                    from app_private.withdrawal_intents
                                   where state in ('created', 'signing', 'submitted')),
    'withdrawnLamports', (select coalesce(sum(amount_lamports), 0)::text
                            from app_private.withdrawal_intents where state = 'confirmed'),
    'outstandingCommissionLamports', (select coalesce(sum(amount_lamports), 0)::text
                                        from app_private.commission_ledger_entries
                                       where account_type = 'creator')
  );
end;
$$;

revoke execute on function public.admin_client_ledger(text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_business_summary(text, text)
  from public, anon, authenticated;
grant execute on function public.admin_client_ledger(text, text, integer) to service_role;
grant execute on function public.admin_business_summary(text, text) to service_role;
