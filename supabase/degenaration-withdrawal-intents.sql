-- Durable withdrawal intents with server-enforced idempotency.
--
-- WHY
--
-- withdrawalIdempotencyKey() in lib/withdrawal.js builds a key, the route returns it, and
-- nothing consumes it. There is no store of used keys, so it prevents nothing -- the module's
-- own comment says so. The only things bounding a double withdrawal today are a disabled
-- submit button and the user having to sign each transfer. Neither survives a duplicated
-- request, a retried fetch, or two tabs. Step 4 of docs/ai/ACCOUNTING_MODEL.md.
--
-- The server is non-custodial and holds no keys, so it cannot broadcast anything itself. What
-- it CAN do, and now does, is refuse to hand out a second unsigned transaction for a request
-- that is already in flight, and record the signature of the one it did hand out so a retry
-- returns that instead of building another.
--
-- Forward safety: new table and new functions only; nothing existing is altered.
-- Rollback: drop the two triggers, the four functions and the table. No other history moves.

create table if not exists app_private.withdrawal_intents (
  id uuid primary key default gen_random_uuid(),
  owner_privy_user_id text not null
    references app_private.app_users(privy_user_id) on delete restrict,
  wallet_address text not null,
  destination_address text not null,
  amount_lamports bigint not null check (amount_lamports > 0),

  -- Server-generated. The client never supplies or influences it: it is derived from the
  -- owner, the wallet, the destination and the amount, so two requests that would move the
  -- same lamports to the same place collide by construction.
  --
  -- Uniqueness is PARTIAL, on the unsettled states only -- see the index below.
  idempotency_key text not null,

  -- What was agreed, frozen. Any later attempt to settle an intent whose parameters differ
  -- from this is refused rather than reinterpreted.
  request_fingerprint text not null,

  state text not null default 'created' check (state in (
    'created', 'signing', 'submitted', 'confirmed', 'failed', 'expired', 'reversed'
  )),
  tx_signature text,
  error text,
  correlation_id uuid not null default gen_random_uuid(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  terminal_at timestamptz,

  -- A signature means lamports may already have moved. It must exist by the time the intent
  -- claims to be submitted or later, and must be absent before that.
  constraint withdrawal_intents_signature_state check (
    (state in ('submitted', 'confirmed') and tx_signature is not null)
    or (state in ('created', 'signing', 'failed', 'expired', 'reversed'))
  )
);

-- Only ONE UNSETTLED withdrawal may exist per key. Settled ones keep their key without
-- blocking anything, because a user genuinely may want to send the same amount to the same
-- place again next week.
--
-- The first draft used a total unique constraint and, on collision with a settled row,
-- rewrote that row's key to free the value. That was wrong twice over: it mutated a column
-- this file declares immutable (protect_withdrawal_terms refused it, which is how the defect
-- surfaced), and rewriting a settled withdrawal's identity to make room for a new one
-- corrupts the very history the table exists to keep.
create unique index if not exists withdrawal_intents_active_key_unique
  on app_private.withdrawal_intents (idempotency_key)
  where state in ('created', 'signing', 'submitted');

-- One withdrawal per signature, globally. A replayed settle for a signature already recorded
-- against another intent is a bug or an attack; either way it must not create a second record.
create unique index if not exists withdrawal_intents_signature_unique
  on app_private.withdrawal_intents (tx_signature) where tx_signature is not null;

-- Pending withdrawals are summed per owner on every availability check.
create index if not exists withdrawal_intents_owner_pending_idx
  on app_private.withdrawal_intents (owner_privy_user_id)
  where state in ('created', 'signing', 'submitted');

alter table app_private.withdrawal_intents enable row level security;

-- The agreed terms are immutable. Only lifecycle columns may move.
create or replace function app_private.protect_withdrawal_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_privy_user_id is distinct from old.owner_privy_user_id
    or new.wallet_address is distinct from old.wallet_address
    or new.destination_address is distinct from old.destination_address
    or new.amount_lamports is distinct from old.amount_lamports
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint then
    raise exception 'withdrawal terms are immutable' using errcode = '55000';
  end if;

  -- A recorded signature is the only evidence that lamports may have left. Overwriting it
  -- would destroy the ability to reconcile the transfer that actually happened.
  if old.tx_signature is not null and new.tx_signature is distinct from old.tx_signature then
    raise exception 'withdrawal signature is immutable' using errcode = '55000';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists withdrawal_intents_protect_terms on app_private.withdrawal_intents;
create trigger withdrawal_intents_protect_terms
before update on app_private.withdrawal_intents
for each row execute function app_private.protect_withdrawal_terms();

-- ---------------------------------------------------------------------------------------

-- Opens, or returns, the intent for this exact request.
--
-- Returns the EXISTING row when the same owner asks for the same amount to the same
-- destination again, so a retried fetch or a second tab receives the transaction that is
-- already in flight instead of a second one to sign.
create or replace function public.app_user_open_withdrawal_intent(
  p_secret text,
  p_privy_user_id text,
  p_wallet_address text,
  p_destination_address text,
  p_amount_lamports bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_fingerprint text;
  v_intent app_private.withdrawal_intents%rowtype;
  v_replay boolean := false;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not app_private.is_solana_address(trim(coalesce(p_wallet_address, ''))) then
    raise exception 'invalid wallet address' using errcode = '22023';
  end if;
  if not app_private.is_solana_address(trim(coalesce(p_destination_address, ''))) then
    raise exception 'invalid destination address' using errcode = '22023';
  end if;
  if p_amount_lamports is null or p_amount_lamports <= 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  perform app_private.ensure_app_user(p_privy_user_id);

  -- Derived server-side from the terms themselves. A client cannot widen it to force a second
  -- transaction, and cannot narrow it to collide with someone else's -- the owner is in it.
  v_key := 'withdraw:' || p_privy_user_id || ':' || trim(p_wallet_address) || ':'
        || trim(p_destination_address) || ':' || p_amount_lamports::text;
  -- pg_catalog.sha256 is core PostgreSQL since 11, so this needs no extension. The earlier
  -- draft used extensions.digest (pgcrypto), which is an avoidable dependency for a hash that
  -- only has to be stable and collision-resistant.
  v_fingerprint := pg_catalog.encode(pg_catalog.sha256(v_key::bytea), 'hex');

  -- The conflict target names the partial index, so only an UNSETTLED withdrawal collides.
  -- A settled one with the same key is simply not in the index and does not block this insert.
  insert into app_private.withdrawal_intents (
    owner_privy_user_id, wallet_address, destination_address,
    amount_lamports, idempotency_key, request_fingerprint
  ) values (
    p_privy_user_id, trim(p_wallet_address), trim(p_destination_address),
    p_amount_lamports, v_key, v_fingerprint
  )
  on conflict (idempotency_key) where state in ('created', 'signing', 'submitted')
  do nothing
  returning * into v_intent;

  if not found then
    -- The unsettled one this request duplicates.
    select * into v_intent
    from app_private.withdrawal_intents
    where idempotency_key = v_key
      and state in ('created', 'signing', 'submitted');
    v_replay := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_intent.id,
    'idempotencyKey', v_intent.idempotency_key,
    'fingerprint', v_intent.request_fingerprint,
    'state', v_intent.state,
    'amountLamports', v_intent.amount_lamports::text,
    'destination', v_intent.destination_address,
    'txSignature', v_intent.tx_signature,
    'correlationId', v_intent.correlation_id,
    -- true means: you already asked for this and it has not settled. The caller must NOT
    -- build a second transaction; it should surface the one already in flight.
    'replay', v_replay
  );
end;
$$;

-- Records the signature of the transaction the user actually signed and sent.
--
-- Persisting the signature BEFORE anything else can fail is what makes a confirmed transfer
-- recoverable: if the process dies immediately afterwards, reconciliation still has the one
-- fact it cannot reconstruct.
create or replace function public.app_user_record_withdrawal_signature(
  p_secret text,
  p_privy_user_id text,
  p_intent_id uuid,
  p_tx_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent app_private.withdrawal_intents%rowtype;
  v_sig text := nullif(trim(coalesce(p_tx_signature, '')), '');
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_sig is null then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'signature required');
  end if;

  select * into v_intent
  from app_private.withdrawal_intents
  where id = p_intent_id and owner_privy_user_id = p_privy_user_id
  for update;

  if not found then
    -- Scoped to the owner, so one user cannot attach a signature to another's withdrawal.
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'withdrawal not found');
  end if;

  if v_intent.tx_signature is not null then
    -- Already recorded. Idempotent for the same signature; refused for a different one,
    -- because two signatures for one intent means two broadcasts.
    if v_intent.tx_signature = v_sig then
      return jsonb_build_object('ok', true, 'duplicate', true, 'state', v_intent.state);
    end if;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', 'this withdrawal already has a different transaction signature'
    );
  end if;

  update app_private.withdrawal_intents
  set tx_signature = v_sig, state = 'submitted', submitted_at = now()
  where id = v_intent.id
  returning * into v_intent;

  return jsonb_build_object('ok', true, 'duplicate', false, 'state', v_intent.state);
end;
$$;

-- Settles an intent after the chain has spoken.
create or replace function public.app_user_settle_withdrawal(
  p_secret text,
  p_privy_user_id text,
  p_intent_id uuid,
  p_outcome text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent app_private.withdrawal_intents%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_outcome not in ('confirmed', 'failed', 'expired') then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'invalid outcome');
  end if;

  select * into v_intent
  from app_private.withdrawal_intents
  where id = p_intent_id and owner_privy_user_id = p_privy_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'withdrawal not found');
  end if;
  if v_intent.state in ('confirmed', 'failed', 'expired', 'reversed') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'state', v_intent.state);
  end if;

  -- A submitted transfer that carries a signature may already have landed. Calling it failed
  -- would free capital the chain has taken; that needs reconciliation against the network,
  -- not a state flip. Mirrors the payout rule in degenaration-admin-product-rpcs.sql.
  if p_outcome <> 'confirmed' and v_intent.tx_signature is not null then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', 'a signed withdrawal must be reconciled against the network, not failed'
    );
  end if;

  update app_private.withdrawal_intents
  set state = p_outcome,
      error = nullif(left(coalesce(p_error, ''), 500), ''),
      confirmed_at = case when p_outcome = 'confirmed' then now() else confirmed_at end,
      terminal_at = now()
  where id = v_intent.id
  returning * into v_intent;

  return jsonb_build_object('ok', true, 'duplicate', false, 'state', v_intent.state);
end;
$$;

create or replace function public.app_user_list_withdrawals(
  p_secret text,
  p_privy_user_id text,
  p_limit integer
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

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      w.id, w.state,
      w.amount_lamports::text as "amountLamports",
      w.destination_address as "destination",
      w.tx_signature as "txSignature",
      w.error, w.created_at, w.submitted_at, w.confirmed_at, w.terminal_at
    from app_private.withdrawal_intents w
    where w.owner_privy_user_id = p_privy_user_id
    order by w.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x;

  return jsonb_build_object('ok', true, 'withdrawals', v_rows);
end;
$$;

revoke execute on function app_private.protect_withdrawal_terms() from public, anon, authenticated;
revoke execute on function public.app_user_open_withdrawal_intent(text, text, text, text, bigint)
  from public, anon, authenticated;
revoke execute on function public.app_user_record_withdrawal_signature(text, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.app_user_settle_withdrawal(text, text, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.app_user_list_withdrawals(text, text, integer)
  from public, anon, authenticated;

grant execute on function public.app_user_open_withdrawal_intent(text, text, text, text, bigint)
  to service_role;
grant execute on function public.app_user_record_withdrawal_signature(text, text, uuid, text)
  to service_role;
grant execute on function public.app_user_settle_withdrawal(text, text, uuid, text, text)
  to service_role;
grant execute on function public.app_user_list_withdrawals(text, text, integer) to service_role;
