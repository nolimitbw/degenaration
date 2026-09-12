-- The revenue-withdrawal ledger, so `Withdraw fees` can be a real control instead of a
-- disabled one.
--
-- WHAT MAKES THIS DIFFERENT FROM EVERY OTHER MOVEMENT OF MONEY HERE
--
-- Three ledgers already move value and NONE of them fits:
--
--   app_private.withdrawal_intents   a USER moving their own principal out of their own wallet
--   app_private.payout_requests      a CREATOR being paid their commission, 0.1 SOL minimum,
--                                    0.043 SOL processing fee
--   app_private.commission_ledger_entries   the immutable accrual, written by trigger only
--
-- Reusing any of them would be an accounting error that looks plausible on the page. The
-- payout ledger in particular: an earlier draft of `admin_revenue_summary` sourced "withdrawn
-- revenue" from it, which would have reported CREATOR payouts as company withdrawals and
-- double-counted the creator allocation that `creator_fee_lamports` already removes once.
--
-- So this is a fourth table, deliberately.
--
-- THE ONE INVARIANT THAT MATTERS
--
--     withdrawable = retained platform fee  -  everything already withdrawn or in flight
--
-- `retained_fee_lamports` is DegenAration's share and nobody else's: the creator and referral
-- allocations were already subtracted from the platform fee when the execution reconciled. The
-- amount a withdrawal may take is therefore bounded by the retained total, and every prior
-- unreversed withdrawal reduces it. `admin_open_revenue_withdrawal` computes that bound inside
-- the same statement that inserts, holding a lock, so two concurrent requests cannot each see
-- the full balance.
--
-- This CANNOT touch client principal. Not by policy — by construction. The only figure it can
-- draw against is `sum(retained_fee_lamports)` over reconciled executions, which is a fee
-- already deducted from a trade that confirmed. Client balances live in wallets this server
-- holds no key for, and no query here reads them.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
-- It does not sign. Signing platform revenue out of the fee account is an owner action with an
-- owner-held key, and a server that could do it unattended would be a larger risk than the
-- feature is worth. The flow is: open an intent (idempotent), the owner signs and submits,
-- record the signature, confirm, reconcile. Steps 1, 3, 4 and 5 are here; step 2 is the owner's.
--
-- Forward safety: one new table, three new functions, no existing object touched. No row is
-- read from or written to any client ledger.
-- Rollback: supabase/rollback/21-revenue-withdrawal.sql.

create table if not exists app_private.revenue_withdrawals (
  id uuid primary key default gen_random_uuid(),

  -- The owner who authorised it, snapshotted. Ownership can change; the record of who moved
  -- company money cannot.
  actor_privy_user_id text not null,

  -- Fees are collected in the swap's OUTPUT mint, so revenue is genuinely denominated in
  -- several tokens. The mint is recorded rather than assumed, and the balance check below is
  -- per mint — summing unlike tokens into one withdrawable figure would be a fiction.
  mint text not null,
  destination_address text not null,
  amount_base_units bigint not null check (amount_base_units > 0),

  -- Server-generated from actor + mint + destination + amount. Two requests that would move
  -- the same value to the same place collide by construction, so a double-clicked button
  -- cannot open two intents.
  idempotency_key text not null,

  state text not null default 'created' check (state in (
    'created', 'signing', 'submitted', 'confirmed', 'failed', 'reversed'
  )),
  tx_signature text,
  error text,
  correlation_id uuid not null default gen_random_uuid(),

  -- What the balance WAS when this was authorised. Not used in arithmetic — the live bound is
  -- recomputed on every open — but an operator asking "why was this allowed?" gets an answer
  -- rather than a reconstruction.
  available_at_open_base_units bigint not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  terminal_at timestamptz,

  -- Same rule as the user withdrawal ledger: a signature means value may already have moved,
  -- so it must exist by the time the row claims to be submitted, and not before.
  constraint revenue_withdrawals_signature_state check (
    (state in ('submitted', 'confirmed') and tx_signature is not null)
    or (state in ('created', 'signing', 'failed', 'reversed'))
  )
);

-- Only ONE UNSETTLED withdrawal per key. A settled one keeps its key without blocking a
-- genuine repeat next month.
create unique index if not exists revenue_withdrawals_active_key_unique
  on app_private.revenue_withdrawals (idempotency_key)
  where state in ('created', 'signing', 'submitted');

-- One withdrawal per signature, globally.
create unique index if not exists revenue_withdrawals_signature_unique
  on app_private.revenue_withdrawals (tx_signature) where tx_signature is not null;

create index if not exists revenue_withdrawals_mint_committed_idx
  on app_private.revenue_withdrawals (mint)
  where state in ('created', 'signing', 'submitted', 'confirmed');

alter table app_private.revenue_withdrawals enable row level security;

-- The agreed terms are immutable. Only lifecycle columns may move.
create or replace function app_private.protect_revenue_withdrawal_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actor_privy_user_id is distinct from old.actor_privy_user_id
    or new.mint is distinct from old.mint
    or new.destination_address is distinct from old.destination_address
    or new.amount_base_units is distinct from old.amount_base_units
    or new.idempotency_key is distinct from old.idempotency_key
    or new.available_at_open_base_units is distinct from old.available_at_open_base_units then
    raise exception 'revenue withdrawal terms are immutable' using errcode = '55000';
  end if;

  -- The signature is the only evidence value may have left. Overwriting it destroys the
  -- ability to reconcile the transfer that actually happened.
  if old.tx_signature is not null and new.tx_signature is distinct from old.tx_signature then
    raise exception 'revenue withdrawal signature is immutable' using errcode = '55000';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists revenue_withdrawals_protect_terms on app_private.revenue_withdrawals;
create trigger revenue_withdrawals_protect_terms
before update on app_private.revenue_withdrawals
for each row execute function app_private.protect_revenue_withdrawal_terms();

-- ---------------------------------------------------------------------------------------

/**
 * What is genuinely available to withdraw, for one mint.
 *
 * `reversed` and `failed` do NOT reduce it: no value left, so the balance is restored. Every
 * other state does, including `created` — an intent an owner has opened but not yet signed
 * still commits the amount, or opening two intents in a row would let both see the full
 * balance and the second would overdraw the moment the first lands.
 *
 * THE LEDGER IS SINGLE-DENOMINATION, AND THIS REFUSES TO PRETEND OTHERWISE
 *
 * Jupiter collects the platform fee in the swap's OUTPUT mint, so revenue genuinely arrives in
 * several tokens. `app_private.trade_executions` does NOT record which: its fee columns are
 * `platform_fee_lamports`, `creator_fee_lamports`, `referral_fee_lamports`,
 * `retained_fee_lamports` — lamports, with no mint anywhere on the row.
 *
 * So there is exactly one denomination this function can answer for, and asking it about USDC
 * would return the wSOL total wearing a USDC label. That is worse than returning nothing: an
 * operator would withdraw against it. Any mint other than wSOL therefore returns NULL — "not
 * answerable" — and `admin_open_revenue_withdrawal` refuses on NULL rather than treating it as
 * zero, because zero reads as "nothing earned yet" and this is "we cannot tell".
 *
 * Making it genuinely per-mint needs `fee_mint` on `trade_executions`, written by the
 * settlement writer at the same time as the fee. That is a real change to the money path and
 * is not made here as a side effect of building a withdrawal button. Recorded in
 * docs/ai/OPEN_BLOCKERS.md.
 */
create or replace function app_private.revenue_available(p_mint text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_mint is distinct from 'So11111111111111111111111111111111111111112' then null
    else greatest(
      0,
      coalesce((
        -- DegenAration's retained share, and nobody else's. The creator and referral
        -- allocations were already subtracted from the platform fee when the execution
        -- reconciled; taking them out again here would understate revenue by exactly that
        -- amount every time.
        select sum(e.retained_fee_lamports)
        from app_private.trade_executions e
        where e.status in ('confirmed', 'reconciled')
      ), 0)
      - coalesce((
        select sum(w.amount_base_units)
        from app_private.revenue_withdrawals w
        where w.mint = p_mint
          and w.state in ('created', 'signing', 'submitted', 'confirmed')
      ), 0)
    )
  end;
$$;

/**
 * Open, or return, the revenue withdrawal for this exact request.
 *
 * IDEMPOTENT. The same actor asking for the same amount of the same mint to the same
 * destination gets the SAME row back, not a second one — a double-clicked button, a retried
 * request and a network timeout that actually succeeded all collapse to one intent.
 *
 * The balance is recomputed here, under a lock on the ledger, rather than trusted from the
 * caller. A client-supplied "available" figure is the classic way a withdrawal overdraws.
 */
create or replace function public.admin_open_revenue_withdrawal(
  p_secret text,
  p_actor_privy_user_id text,
  p_mint text,
  p_destination_address text,
  p_amount_base_units bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_available bigint;
  v_existing app_private.revenue_withdrawals%rowtype;
  v_row app_private.revenue_withdrawals%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  if nullif(trim(coalesce(p_mint, '')), '') is null
    or nullif(trim(coalesce(p_destination_address, '')), '') is null then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'mint and destination are required');
  end if;
  if p_amount_base_units is null or p_amount_base_units <= 0 then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'amount must be positive');
  end if;

  -- pg_catalog.sha256, not pgcrypto's digest(). The sibling ledger learned this the same way:
  -- pgcrypto is an avoidable extension dependency for a hash the catalog already provides, and
  -- requiring it breaks every environment that does not have it installed.
  v_key := pg_catalog.encode(pg_catalog.sha256(
    (p_actor_privy_user_id || '|' || p_mint || '|' || p_destination_address || '|' || p_amount_base_units::text)::bytea
  ), 'hex');

  -- Return the existing unsettled intent BEFORE re-checking the balance. A retry of a request
  -- that already committed its amount must not be refused for insufficient funds against a
  -- balance its own predecessor is holding down.
  select * into v_existing
  from app_private.revenue_withdrawals
  where idempotency_key = v_key
    and state in ('created', 'signing', 'submitted');
  if found then
    return jsonb_build_object(
      'ok', true, 'reused', true, 'id', v_existing.id, 'state', v_existing.state,
      'amountBaseUnits', v_existing.amount_base_units::text,
      'correlationId', v_existing.correlation_id
    );
  end if;

  -- Serialise concurrent opens for this mint. Without it two requests each read the full
  -- balance, each pass, and together overdraw.
  perform pg_advisory_xact_lock(hashtext('degenaration.revenue_withdrawal:' || p_mint));

  v_available := app_private.revenue_available(p_mint);
  -- NULL is "not answerable", not zero. The ledger records no fee mint, so only the lamport
  -- denomination has a balance this function can stand behind; refusing is the only safe
  -- answer for any other mint.
  if v_available is null then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', 'revenue is not tracked per mint yet, so only SOL-denominated revenue can be withdrawn'
    );
  end if;
  if p_amount_base_units > v_available then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', 'amount exceeds available platform revenue',
      'availableBaseUnits', v_available::text
    );
  end if;

  insert into app_private.revenue_withdrawals (
    actor_privy_user_id, mint, destination_address, amount_base_units,
    idempotency_key, available_at_open_base_units
  ) values (
    p_actor_privy_user_id, p_mint, trim(p_destination_address), p_amount_base_units,
    v_key, v_available
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true, 'reused', false, 'id', v_row.id, 'state', v_row.state,
    'amountBaseUnits', v_row.amount_base_units::text,
    'availableBaseUnits', v_available::text,
    'correlationId', v_row.correlation_id
  );
end;
$$;

/**
 * Record the signature, then settle it.
 *
 * Two calls rather than one, for the same reason the user withdrawal path splits them: the
 * signature must be DURABLE before confirmation is polled. A process that submits and then
 * dies before writing the signature has moved value it can no longer find.
 */
create or replace function public.admin_record_revenue_withdrawal_signature(
  p_secret text,
  p_actor_privy_user_id text,
  p_id uuid,
  p_tx_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app_private.revenue_withdrawals%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  if nullif(trim(coalesce(p_tx_signature, '')), '') is null then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'signature is required');
  end if;

  select * into v_row from app_private.revenue_withdrawals where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'withdrawal not found');
  end if;

  -- Already recorded with the SAME signature: idempotent success. With a different one:
  -- refused, because the trigger holds the first signature immutable and silently accepting
  -- the second would report a transfer that is not the one on chain.
  if v_row.tx_signature is not null then
    return case
      when v_row.tx_signature = trim(p_tx_signature)
        then jsonb_build_object('ok', true, 'reused', true, 'id', v_row.id, 'state', v_row.state)
      else jsonb_build_object('ok', false, 'status', 409, 'error', 'a different signature is already recorded')
    end;
  end if;

  if v_row.state not in ('created', 'signing') then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'withdrawal is not awaiting a signature');
  end if;

  update app_private.revenue_withdrawals
  set state = 'submitted', tx_signature = trim(p_tx_signature), submitted_at = now()
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'reused', false, 'id', v_row.id, 'state', v_row.state);
end;
$$;

create or replace function public.admin_settle_revenue_withdrawal(
  p_secret text,
  p_actor_privy_user_id text,
  p_id uuid,
  p_outcome text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app_private.revenue_withdrawals%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  if p_outcome not in ('confirmed', 'failed', 'reversed') then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid outcome');
  end if;

  select * into v_row from app_private.revenue_withdrawals where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'withdrawal not found');
  end if;

  -- Settling to the state it is already in is a no-op success, so a retried confirmation poll
  -- does not become an error the operator has to interpret.
  if v_row.state = p_outcome then
    return jsonb_build_object('ok', true, 'reused', true, 'id', v_row.id, 'state', v_row.state);
  end if;

  if v_row.state in ('confirmed', 'failed', 'reversed') then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', 'withdrawal is already settled', 'state', v_row.state
    );
  end if;

  -- A confirmation needs a signature. Confirming without one would mark value as moved with no
  -- way to prove it did.
  if p_outcome = 'confirmed' and v_row.tx_signature is null then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'cannot confirm without a signature');
  end if;

  update app_private.revenue_withdrawals
  set state = p_outcome,
      error = case when p_outcome = 'confirmed' then null else left(coalesce(p_error, ''), 400) end,
      confirmed_at = case when p_outcome = 'confirmed' then now() else confirmed_at end,
      terminal_at = now()
  where id = p_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true, 'reused', false, 'id', v_row.id, 'state', v_row.state,
    'availableBaseUnits', app_private.revenue_available(v_row.mint)::text
  );
end;
$$;

/** The history the Admin Console renders, newest first. */
create or replace function public.admin_list_revenue_withdrawals(
  p_secret text,
  p_actor_privy_user_id text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.require_app_admin(p_actor_privy_user_id);

  select coalesce(jsonb_agg(row_to_json(w) order by w.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select id, mint, destination_address, amount_base_units::text as amount_base_units,
           state, tx_signature, error, correlation_id, created_at, submitted_at,
           confirmed_at, terminal_at
    from app_private.revenue_withdrawals
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 500))
  ) w;

  return jsonb_build_object('ok', true, 'withdrawals', v_rows);
end;
$$;

revoke execute on function public.admin_open_revenue_withdrawal(text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.admin_open_revenue_withdrawal(text, text, text, text, bigint) to service_role;
revoke execute on function public.admin_record_revenue_withdrawal_signature(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_record_revenue_withdrawal_signature(text, text, uuid, text) to service_role;
revoke execute on function public.admin_settle_revenue_withdrawal(text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_settle_revenue_withdrawal(text, text, uuid, text, text) to service_role;
revoke execute on function public.admin_list_revenue_withdrawals(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_revenue_withdrawals(text, text, integer) to service_role;
revoke execute on function app_private.revenue_available(text) from public, anon, authenticated;
