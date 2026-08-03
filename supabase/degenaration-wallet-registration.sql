-- Canonical server-side wallet registration.
--
-- WHY
--
-- app_private.trading_wallets is empty in production and app_user_upsert_wallet -- although
-- defined, bridge-allowlisted and deployed -- has no call site anywhere in the application.
-- The server therefore cannot name any user's wallet, so no server-side balance
-- reconciliation is possible for anyone. This is step 1 of docs/ai/ACCOUNTING_MODEL.md and a
-- prerequisite for every step after it.
--
-- THREE DEFECTS IN THE EXISTING TABLE AND RPC, FIXED HERE
--
-- 1. Nothing stopped two different Privy users from claiming the SAME address. The only
--    uniqueness was (privy_user_id, address), which is per user. A Solana address has one
--    owner, so a second claim is either a mistake or an attempt to attribute someone else's
--    balance. Now refused, with the address never echoed back to the caller.
-- 2. Address validation was `length between 32 and 64`, which accepts '0OIl...' and any
--    other non-base58 string. Now a real base58 check.
-- 3. There was no notion of WHICH wallet is current, and no record when it changed. A user
--    may legitimately hold several wallets (an embedded one and a connected extension), so
--    revoking the others would be wrong. Instead exactly one is `is_primary`, enforced by a
--    partial unique index, and every promotion is recorded immutably.
--
-- Forward safety: the new column is nullable-with-default and the new indexes are created
-- against an empty table, so there is nothing to conflict. Existing rows, if any appeared,
-- would keep working -- is_primary defaults false and the partial index tolerates that.
-- Rollback: drop the trigger, the audit table, the two indexes and the column, then restore
-- the previous app_user_upsert_wallet body. No wallet history is rewritten.

alter table app_private.trading_wallets
  add column if not exists is_primary boolean not null default false;

-- One owner per address. Partial on 'active' so a revoked claim does not block a legitimate
-- re-registration later, and so an address can move between users through an explicit
-- revoke rather than a silent overwrite.
create unique index if not exists trading_wallets_active_address_unique
  on app_private.trading_wallets (address)
  where status = 'active';

-- Exactly one current wallet per user.
create unique index if not exists trading_wallets_one_primary_per_user
  on app_private.trading_wallets (privy_user_id)
  where is_primary;

create table if not exists app_private.wallet_audit_log (
  id uuid primary key default gen_random_uuid(),
  privy_user_id text not null references app_private.app_users(privy_user_id) on delete cascade,
  action text not null check (action in ('registered', 'promoted', 'demoted', 'revoked')),
  wallet_address text not null,
  previous_address text,
  privy_wallet_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wallet_audit_log_user_idx
  on app_private.wallet_audit_log (privy_user_id, created_at desc);

alter table app_private.wallet_audit_log enable row level security;

-- Append-only. app_private.reject_immutable_mutation already exists and is used by the other
-- financial history tables; reusing it keeps one definition of "immutable" in the schema.
drop trigger if exists wallet_audit_log_immutable on app_private.wallet_audit_log;
create trigger wallet_audit_log_immutable
before update or delete on app_private.wallet_audit_log
for each row execute function app_private.reject_immutable_mutation();

-- Base58: Bitcoin/Solana alphabet, which excludes 0, O, I and l precisely because they are
-- confusable. Length 32..44 is the real range for a 32-byte key; the old 32..64 was wide
-- enough to admit strings that cannot be addresses.
create or replace function app_private.is_solana_address(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
     and p_value ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
$$;

create or replace function public.app_user_upsert_wallet(
  p_secret text,
  p_privy_user_id text,
  p_wallet_address text,
  p_privy_wallet_id text,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address text := trim(coalesce(p_wallet_address, ''));
  v_wallet_id text := nullif(trim(coalesce(p_privy_wallet_id, '')), '');
  v_wallet app_private.trading_wallets%rowtype;
  v_previous app_private.trading_wallets%rowtype;
  v_owner text;
  v_created boolean := false;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not app_private.is_solana_address(v_address) then
    raise exception 'invalid wallet address' using errcode = '22023';
  end if;

  perform app_private.ensure_app_user(p_privy_user_id);

  -- Refuse a cross-user claim explicitly rather than letting the unique index raise, so the
  -- caller gets a stable, actionable error. The other owner's identity is deliberately NOT
  -- returned: the caller has already proven they are not that user.
  select privy_user_id into v_owner
  from app_private.trading_wallets
  where address = v_address and status = 'active'
  limit 1;

  if found and v_owner is distinct from p_privy_user_id then
    raise exception 'wallet already registered to another account' using errcode = '42501';
  end if;

  -- The wallet currently marked primary, captured before the change so the audit row can
  -- name what it replaced.
  select * into v_previous
  from app_private.trading_wallets
  where privy_user_id = p_privy_user_id and is_primary
  limit 1;

  insert into app_private.trading_wallets (
    privy_user_id, privy_wallet_id, address, label, verified_at, status, is_primary
  ) values (
    p_privy_user_id, v_wallet_id, v_address,
    nullif(left(trim(coalesce(p_label, '')), 80), ''), now(), 'active', false
  )
  on conflict (privy_user_id, address) do update
  set privy_wallet_id = coalesce(excluded.privy_wallet_id, app_private.trading_wallets.privy_wallet_id),
      label = coalesce(excluded.label, app_private.trading_wallets.label),
      verified_at = now(),
      status = 'active',
      updated_at = now()
  returning * into v_wallet;

  v_created := v_wallet.created_at = v_wallet.updated_at;

  -- Demote first: the partial unique index permits only one primary per user, so promoting
  -- before demoting would violate it inside the same statement.
  if v_previous.id is not null and v_previous.id is distinct from v_wallet.id then
    update app_private.trading_wallets
    set is_primary = false, updated_at = now()
    where id = v_previous.id;

    insert into app_private.wallet_audit_log (
      privy_user_id, action, wallet_address, previous_address, privy_wallet_id, detail
    ) values (
      p_privy_user_id, 'demoted', v_previous.address, null, v_previous.privy_wallet_id,
      jsonb_build_object('replacedBy', v_wallet.address)
    );
  end if;

  if not v_wallet.is_primary then
    update app_private.trading_wallets
    set is_primary = true, updated_at = now()
    where id = v_wallet.id
    returning * into v_wallet;

    insert into app_private.wallet_audit_log (
      privy_user_id, action, wallet_address, previous_address, privy_wallet_id, detail
    ) values (
      p_privy_user_id,
      case when v_created then 'registered' else 'promoted' end,
      v_wallet.address,
      v_previous.address,
      v_wallet.privy_wallet_id,
      jsonb_build_object('chain', v_wallet.chain)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_wallet.id,
    'address', v_wallet.address,
    'chain', v_wallet.chain,
    'label', v_wallet.label,
    'status', v_wallet.status,
    'isPrimary', v_wallet.is_primary,
    'verifiedAt', v_wallet.verified_at,
    'created', v_created,
    'replacedAddress', v_previous.address
  );
end;
$$;

revoke execute on function app_private.is_solana_address(text) from public, anon, authenticated;
revoke execute on function public.app_user_upsert_wallet(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.app_user_upsert_wallet(text, text, text, text, text)
  to service_role;

-- Resolves the ONE wallet every surface must agree on. Portfolio, the withdrawal screen and
-- the trading path previously each derived the address independently from the Privy object
-- in the browser; this is the server's answer, and it is the same answer for all of them.
create or replace function public.app_user_primary_wallet(
  p_secret text,
  p_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet app_private.trading_wallets%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_wallet
  from app_private.trading_wallets
  where privy_user_id = p_privy_user_id and is_primary and status = 'active'
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'wallet', null);
  end if;

  return jsonb_build_object('ok', true, 'wallet', jsonb_build_object(
    'address', v_wallet.address,
    'chain', v_wallet.chain,
    'label', v_wallet.label,
    'status', v_wallet.status,
    'verifiedAt', v_wallet.verified_at
  ));
end;
$$;

revoke execute on function public.app_user_primary_wallet(text, text)
  from public, anon, authenticated;
grant execute on function public.app_user_primary_wallet(text, text) to service_role;
