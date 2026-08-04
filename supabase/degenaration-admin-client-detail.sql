-- Spec section 8: the per-client drill-down.
--
-- WHY
--
-- admin_client_ledger answers "who are the clients and what are their totals". Section 8 also
-- requires, for a single client: balance breakdown, wallet history, deposits, withdrawals and
-- their intents, trade intents, executions, positions and lots, fees, commissions, referrals,
-- subscriptions, bot lifecycle, failed operations, reconciliation and audit events. None of
-- that was reachable — the console could show a row but not open it.
--
-- VOLUME HAS ONE DEFINITION AND IT IS ENFORCED HERE
--
-- Confirmed executed notional: status in ('confirmed', 'reconciled'). Never a quote, a
-- simulation, a failed or cancelled transaction, or a duplicate. Today / 7D / 30D / lifetime
-- all use the same predicate, so the four figures cannot disagree with each other.
--
-- STILL NO BALANCE COLUMN
--
-- Same reason as the client table: non-custodial, the SOL is in a wallet the user controls,
-- and SQL cannot read a chain balance. The breakdown reports what the ledger genuinely knows —
-- committed capital, open cost, realized PnL, settled and pending withdrawals — and names the
-- wallet so the operator can look the rest up on chain.
--
-- Forward safety: one read-only function. No table is altered and no row is written.
-- Rollback: drop the function.

create or replace function public.admin_client_detail(
  p_secret text,
  p_actor_privy_user_id text,
  p_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user app_private.app_users%rowtype;
  v_wallets jsonb;
  v_wallet_history jsonb;
  v_positions jsonb;
  v_executions jsonb;
  v_intents jsonb;
  v_withdrawals jsonb;
  v_movements jsonb;
  v_commissions jsonb;
  v_referral jsonb;
  v_bots jsonb;
  v_audit jsonb;
  v_failures jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  -- The secret authenticates the caller; this authorizes the person. Both, always.
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select * into v_user from app_private.app_users where privy_user_id = p_privy_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.is_primary desc, x.created_at), '[]'::jsonb)
    into v_wallets
  from (
    select w.address, w.status, w.is_primary, w.label, w.created_at
      from app_private.trading_wallets w
     where w.privy_user_id = p_privy_user_id
  ) x;

  -- Wallet history is an audit trail, not a list of current wallets: it is how an operator
  -- answers "did this address change, when, and was it authorised".
  if to_regclass('app_private.wallet_audit_log') is not null then
    execute $q$
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select a.action, a.address, a.previous_address as "previousAddress",
               a.detail, a.created_at
          from app_private.wallet_audit_log a
         where a.privy_user_id = $1
         order by a.created_at desc
         limit 100
      ) x
    $q$ into v_wallet_history using p_privy_user_id;
  else
    v_wallet_history := '[]'::jsonb;
  end if;

  -- Positions with what closed them. remaining/exited come from the lots and exits, so a
  -- partially closed position reads correctly rather than as either open or closed.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc), '[]'::jsonb)
    into v_positions
  from (
    select
      p.id, p.mint, p.status,
      p.quantity_base_units::text as "quantityBaseUnits",
      p.cost_lamports::text as "costLamports",
      p.realized_pnl_lamports::text as "realizedPnlLamports",
      p.fees_lamports::text as "feesLamports",
      p.opened_at, p.closed_at,
      (select count(*) from app_private.position_lots l where l.position_id = p.id) as "lotCount",
      (select coalesce(sum(l.remaining_base_units), 0)::text
         from app_private.position_lots l where l.position_id = p.id) as "remainingBaseUnits",
      (select count(*) from app_private.position_exits e where e.position_id = p.id) as "exitCount",
      (select count(*) from app_private.position_exits e
        where e.position_id = p.id and e.proceeds_lamports is null) as "unpricedExits",
      (select coalesce(sum(e.proceeds_lamports), 0)::text
         from app_private.position_exits e where e.position_id = p.id) as "exitProceedsLamports"
    from app_private.positions p
   where p.owner_privy_user_id = p_privy_user_id
   order by p.opened_at desc
   limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_executions
  from (
    select
      e.id, e.status, e.execution_mode as "executionMode", e.tx_signature as "txSignature",
      e.slot, i.mint, i.side,
      e.gross_notional_lamports::text as "grossNotionalLamports",
      e.platform_fee_lamports::text as "platformFeeLamports",
      e.creator_fee_lamports::text as "creatorFeeLamports",
      e.referral_fee_lamports::text as "referralFeeLamports",
      e.retained_fee_lamports::text as "retainedFeeLamports",
      e.network_fee_lamports::text as "networkFeeLamports",
      e.error_code as "errorCode",
      e.submitted_at, e.confirmed_at, e.reconciled_at, e.created_at
    from app_private.trade_executions e
    join app_private.trade_intents i on i.id = e.intent_id
   where e.owner_privy_user_id = p_privy_user_id
   order by e.created_at desc
   limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_intents
  from (
    select
      i.id, i.state, i.side, i.mint, i.intent_kind as "kind",
      i.requested_input_base_units::text as "requestedInputBaseUnits",
      i.reserved_lamports::text as "reservedLamports",
      i.correlation_id as "correlationId",
      i.created_at, i.terminal_at as "terminalAt"
    from app_private.trade_intents i
   where i.owner_privy_user_id = p_privy_user_id
   order by i.created_at desc
   limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_withdrawals
  from (
    select
      w.id, w.state, w.amount_lamports::text as "amountLamports",
      w.destination_address as "destinationAddress",
      w.tx_signature as "txSignature", w.error,
      w.created_at, w.updated_at
    from app_private.withdrawal_intents w
   where w.owner_privy_user_id = p_privy_user_id
   order by w.created_at desc
   limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.observed_at desc), '[]'::jsonb)
    into v_movements
  from (
    select m.id, m.movement_type as "type", m.status,
           m.amount_lamports::text as "amountLamports",
           m.tx_signature as "txSignature", m.observed_at
      from app_private.cash_movements m
     where m.owner_privy_user_id = p_privy_user_id
     order by m.observed_at desc
     limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_commissions
  from (
    select l.id, l.account_type as "accountType", l.source_type as "sourceType",
           l.amount_lamports::text as "amountLamports", l.rate_bps as "rateBps",
           l.available_at as "availableAt", l.created_at
      from app_private.commission_ledger_entries l
     where l.account_owner_privy_user_id = p_privy_user_id
     order by l.created_at desc
     limit 100
  ) x;

  select jsonb_build_object(
    'referredBy', (select a.referrer_privy_user_id
                     from app_private.referral_attributions a
                    where a.referred_privy_user_id = p_privy_user_id
                      and a.status = 'verified' limit 1),
    'referredCount', (select count(*) from app_private.referral_attributions a
                       where a.referrer_privy_user_id = p_privy_user_id),
    'verifiedReferrals', (select count(*) from app_private.referral_attributions a
                           where a.referrer_privy_user_id = p_privy_user_id
                             and a.status = 'verified')
  ) into v_referral;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
    into v_bots
  from (
    select b.id, b.name, b.kind, b.status, b.visibility,
           b.created_at, b.updated_at, b.last_activity_at as "lastActivityAt"
      from app_private.bot_profiles b
     where b.owner_privy_user_id = p_privy_user_id
     order by b.updated_at desc
     limit 100
  ) x;

  -- Anything that went wrong for this client, in one list. An operator opening a client
  -- record is usually answering "what failed", and making them read three tables to find out
  -- is how a failure gets missed.
  select coalesce(jsonb_agg(to_jsonb(x) order by x."at" desc), '[]'::jsonb)
    into v_failures
  from (
    select 'execution' as kind, e.id::text as id, e.status as state,
           e.error_message as detail, e.created_at as "at"
      from app_private.trade_executions e
     where e.owner_privy_user_id = p_privy_user_id
       and e.status in ('failed', 'dropped', 'expired')
    union all
    select 'withdrawal', w.id::text, w.state, w.error, w.created_at
      from app_private.withdrawal_intents w
     where w.owner_privy_user_id = p_privy_user_id
       and w.state in ('failed', 'reversed')
    union all
    select 'intent', i.id::text, i.state, null, i.created_at
      from app_private.trade_intents i
     where i.owner_privy_user_id = p_privy_user_id
       and i.state in ('rejected', 'failed', 'expired', 'cancelled', 'reversed', 'quarantined')
    limit 100
  ) x;

  if to_regclass('app_private.admin_audit_log') is not null then
    execute $q$
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select a.action, a.actor_privy_user_id as "actor", a.reason, a.created_at
          from app_private.admin_audit_log a
         where a.subject_id = $1
         order by a.created_at desc
         limit 50
      ) x
    $q$ into v_audit using p_privy_user_id;
  else
    v_audit := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'ok', true,
    'client', jsonb_build_object(
      'privyUserId', v_user.privy_user_id,
      'status', v_user.status,
      'createdAt', v_user.created_at
    ),
    'balances', jsonb_build_object(
      -- Everything here is ledger-derived. See balanceNote.
      'committedLamports', (select coalesce(sum(i.reserved_lamports), 0)::text
                              from app_private.trade_intents i
                             where i.owner_privy_user_id = p_privy_user_id
                               and i.reserved_lamports > 0),
      'openCostLamports', (select coalesce(sum(p.cost_lamports), 0)::text
                             from app_private.positions p
                            where p.owner_privy_user_id = p_privy_user_id
                              and p.status in ('opening', 'open', 'closing')),
      'realizedPnlLamports', (select coalesce(sum(p.realized_pnl_lamports), 0)::text
                                from app_private.positions p
                               where p.owner_privy_user_id = p_privy_user_id),
      'pendingWithdrawalLamports', (select coalesce(sum(w.amount_lamports), 0)::text
                                      from app_private.withdrawal_intents w
                                     where w.owner_privy_user_id = p_privy_user_id
                                       and w.state in ('created', 'signing', 'submitted')),
      'withdrawnLamports', (select coalesce(sum(w.amount_lamports), 0)::text
                              from app_private.withdrawal_intents w
                             where w.owner_privy_user_id = p_privy_user_id
                               and w.state = 'confirmed'),
      'commissionBalanceLamports', (select coalesce(sum(l.amount_lamports), 0)::text
                                      from app_private.commission_ledger_entries l
                                     where l.account_owner_privy_user_id = p_privy_user_id)
    ),
    -- One predicate, four windows. They cannot disagree.
    'volume', jsonb_build_object(
      'definition', 'confirmed executed notional (status confirmed or reconciled)',
      'todayLamports', (select coalesce(sum(e.gross_notional_lamports), 0)::text
                          from app_private.trade_executions e
                         where e.owner_privy_user_id = p_privy_user_id
                           and e.status in ('confirmed', 'reconciled')
                           and coalesce(e.confirmed_at, e.created_at) >= date_trunc('day', now())),
      'sevenDayLamports', (select coalesce(sum(e.gross_notional_lamports), 0)::text
                             from app_private.trade_executions e
                            where e.owner_privy_user_id = p_privy_user_id
                              and e.status in ('confirmed', 'reconciled')
                              and coalesce(e.confirmed_at, e.created_at) >= now() - interval '7 days'),
      'thirtyDayLamports', (select coalesce(sum(e.gross_notional_lamports), 0)::text
                              from app_private.trade_executions e
                             where e.owner_privy_user_id = p_privy_user_id
                               and e.status in ('confirmed', 'reconciled')
                               and coalesce(e.confirmed_at, e.created_at) >= now() - interval '30 days'),
      'lifetimeLamports', (select coalesce(sum(e.gross_notional_lamports), 0)::text
                             from app_private.trade_executions e
                            where e.owner_privy_user_id = p_privy_user_id
                              and e.status in ('confirmed', 'reconciled')),
      'platformFeeLamports', (select coalesce(sum(e.platform_fee_lamports), 0)::text
                                from app_private.trade_executions e
                               where e.owner_privy_user_id = p_privy_user_id
                                 and e.status in ('confirmed', 'reconciled'))
    ),
    'wallets', v_wallets,
    'walletHistory', v_wallet_history,
    'positions', v_positions,
    'executions', v_executions,
    'intents', v_intents,
    'withdrawals', v_withdrawals,
    'cashMovements', v_movements,
    'commissions', v_commissions,
    'referral', v_referral,
    'bots', v_bots,
    'failures', v_failures,
    'auditEvents', v_audit,
    'custodyModel', 'non-custodial',
    'balanceNote', 'On-chain balances are not readable from the database. Every figure here '
                || 'is ledger-derived; use the wallet address for chain lookup.'
  );
end;
$$;

revoke execute on function public.admin_client_detail(text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_client_detail(text, text, text) to service_role;
