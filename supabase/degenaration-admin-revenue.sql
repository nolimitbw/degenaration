-- Platform revenue, by period, with the allocation invariant checked rather than assumed.
--
-- WHAT EXISTS AND WHY IT IS NOT ENOUGH
--
-- `admin_business_summary` reports lifetime `platformFeeLamports`, `creatorFeeLamports`,
-- `referralFeeLamports` and `retainedFeeLamports`. Four running totals, no periods, and no
-- statement about whether they are consistent with each other.
--
-- The release directive asks for today / 7D / 30D / lifetime, the split between confirmed and
-- pending, what is actually available to withdraw, and — the part that matters most —
-- "reconciliation proves total allocations equal the confirmed fee".
--
-- THE INVARIANT
--
--     creator + referral + retained  ==  platform fee collected
--
-- It holds by construction today: `retained_fee_lamports` is a GENERATED column on
-- `trade_executions`, so it cannot drift from the other three. That is exactly why this
-- function still checks it. A generated column is a guarantee about ONE table; the moment a
-- correction, a reversal or a second writer appears, the guarantee is about the row and not
-- about the business total. An invariant worth relying on is worth reporting, and reporting it
-- costs one subtraction.
--
-- `allocationDrift` is that subtraction. Zero means the ledger agrees with itself. Anything
-- else is a number an operator must see before trusting any other figure on the page, so it is
-- returned at the top level rather than buried per period.
--
-- WHY PER MINT IS NOT FAKED
--
-- Fees are collected in the swap's OUTPUT mint, so revenue is genuinely denominated in several
-- tokens and summing them into one number would be a fiction. `gross_notional_lamports` and the
-- fee columns are lamport-denominated because that is what the ledger records; where a fee was
-- taken in another mint the ledger's own unit is what this reports, and the Admin Console shows
-- the fee ACCOUNT state beside it so an operator can see which mints can even be collected.
-- No USD conversion is invented here.
--
-- Forward safety: one new read-only function. No table, column, constraint, grant or row is
-- touched. Nothing writes.
-- Rollback: supabase/rollback/18-admin-revenue.sql.

create or replace function public.admin_revenue_summary(
  p_secret text,
  p_actor_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  with confirmed as (
    select
      e.platform_fee_lamports,
      e.creator_fee_lamports,
      e.referral_fee_lamports,
      e.retained_fee_lamports,
      e.gross_notional_lamports,
      coalesce(e.confirmed_at, e.created_at) as at
    from app_private.trade_executions e
    where e.status in ('confirmed', 'reconciled')
  ),
  -- Deliberately separate. A fee on an unconfirmed execution is not revenue and must never be
  -- added to a total an operator might withdraw against; it is reported so the difference
  -- between "earned" and "not yet earned" is visible rather than silently excluded.
  pending as (
    select coalesce(sum(e.platform_fee_lamports), 0) as fees, count(*) as executions
    from app_private.trade_executions e
    where e.status not in ('confirmed', 'reconciled', 'failed', 'reversed')
  ),
  periods as (
    select
      coalesce(sum(platform_fee_lamports) filter (where at >= date_trunc('day', now())), 0) as today,
      coalesce(sum(platform_fee_lamports) filter (where at >= now() - interval '7 days'), 0) as d7,
      coalesce(sum(platform_fee_lamports) filter (where at >= now() - interval '30 days'), 0) as d30,
      coalesce(sum(platform_fee_lamports), 0) as lifetime,
      coalesce(sum(creator_fee_lamports), 0) as creator,
      coalesce(sum(referral_fee_lamports), 0) as referral,
      coalesce(sum(retained_fee_lamports), 0) as retained,
      coalesce(sum(gross_notional_lamports), 0) as volume,
      count(*) as executions
    from confirmed
  ),
  -- CREATOR payouts, which are NOT platform revenue and are reported only so the two are
  -- visibly separate. `app_private.payout_requests` is the affiliate ledger — 0.1 SOL minimum,
  -- 0.043 SOL processing fee, owed to creators and referrers. Subtracting it from DegenAration's
  -- retained share would double-count: the creator allocation has already been removed from the
  -- fee once, in `creator_fee_lamports`.
  --
  -- There is deliberately no `withdrawnRevenue` figure here. No revenue-withdrawal ledger
  -- exists yet, and borrowing this table to populate one would report creator payouts as
  -- company withdrawals — an accounting error that would look plausible on the page.
  creator_payouts as (
    select
      -- `confirmed` is the terminal success state, not `paid`. The CHECK on this table allows
      -- requested / reviewing / approved / processing / confirmed / failed / rejected /
      -- reversed, and filtering on a status the vocabulary does not contain would have
      -- reported 0 for ever while looking entirely correct.
      coalesce(sum(net_lamports) filter (where status = 'confirmed'), 0) as paid,
      coalesce(sum(net_lamports) filter (where status in ('requested', 'reviewing', 'approved', 'processing')), 0) as in_flight,
      count(*) filter (where status in ('failed', 'rejected', 'reversed')) as failed
    from app_private.payout_requests
  )
  select jsonb_build_object(
    'ok', true,
    'unit', 'lamports',
    'platformFee', jsonb_build_object(
      'today', p.today::text,
      'd7', p.d7::text,
      'd30', p.d30::text,
      'lifetime', p.lifetime::text
    ),
    'confirmedExecutions', p.executions,
    'confirmedVolumeLamports', p.volume::text,
    'pendingFeeLamports', pend.fees::text,
    'pendingExecutions', pend.executions,
    'creatorAllocatedLamports', p.creator::text,
    'referralAllocatedLamports', p.referral::text,
    'netRevenueLamports', p.retained::text,
    'creatorPayoutsPaidLamports', pay.paid::text,
    'creatorPayoutsInFlightLamports', pay.in_flight::text,
    'failedCreatorPayouts', pay.failed,
    -- DegenAration's retained share, all of it. Nothing is subtracted for creator payouts:
    -- the creator allocation was already removed from the fee once, in creator_fee_lamports,
    -- and removing it twice would understate revenue by the same amount every time.
    --
    -- Floored at zero because a negative available balance is a reconciliation problem, not a
    -- number to offer as withdrawable; `allocationDrift` is where that problem is reported.
    'availableLamports', greatest(0, p.retained)::text,
    -- Stated rather than implied. No revenue-withdrawal ledger exists, so the Admin Console
    -- must not present a withdrawn total it cannot source.
    'revenueWithdrawalLedger', 'not-implemented',
    -- THE INVARIANT. Zero means the ledger agrees with itself.
    'allocationDrift', (p.lifetime - (p.creator + p.referral + p.retained))::text,
    'reconciled', (p.lifetime - (p.creator + p.referral + p.retained)) = 0
  )
  into v_result
  from periods p
  cross join pending pend
  cross join creator_payouts pay;

  return v_result;
end;
$$;

revoke execute on function public.admin_revenue_summary(text, text) from public, anon, authenticated;
grant execute on function public.admin_revenue_summary(text, text) to service_role;
