-- Authoritative withdrawable state for a user's own wallet.
-- Spec: docs/launch/FINAL_LAUNCH_SPEC.md §12.3, §12.4, §12.5.
--
-- DegenAration is non-custodial, so a withdrawal is a transfer the user signs from their
-- own wallet. The server never holds keys and never moves funds. What the server DOES
-- owe the user is an honest answer to "how much can I actually move right now" — that
-- answer must come from the database, never from the client (§12.5).
--
-- Locked capital is SOL committed to BUY intents that are in flight but have not yet
-- settled on-chain. Open positions are deliberately NOT counted: the SOL that bought
-- them has already left the wallet, so the on-chain balance already reflects it.
-- Counting positions again would double-count and wrongly block legitimate withdrawals.

create or replace function public.app_user_withdrawable_state(
  p_secret text,
  p_privy_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked numeric;
  v_intents integer;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.ensure_app_user(p_privy_user_id);

  select
    coalesce(sum(requested_input_base_units), 0),
    count(*)
  into v_locked, v_intents
  from app_private.trade_intents
  where owner_privy_user_id = p_privy_user_id
    and side = 'buy'
    and state in (
      'created', 'validating', 'ready', 'claimed', 'submitting', 'submitted'
    );

  -- Lamports are returned as text so a large value cannot lose precision when it is
  -- parsed as a JavaScript number.
  return jsonb_build_object(
    'lockedLamports', v_locked::bigint::text,
    'inFlightIntents', v_intents
  );
end;
$$;

revoke execute on function public.app_user_withdrawable_state(text, text)
  from public, anon, authenticated;
grant execute on function public.app_user_withdrawable_state(text, text)
  to service_role;

-- ---------------------------------------------------------------------------------------
-- Raw signal deduplication (applied as degenaration_raw_signal_hash_dedupe)
--
-- The pre-existing constraint UNIQUE (source_type, source_ref, external_event_id) is
-- defeatable by NULL: Postgres compares NULLs as distinct in a unique index, so two
-- identical deliveries with external_event_id NULL both insert. Verified against the live
-- database -- the same message body inserted twice was ACCEPTED.
--
-- content_hash is NOT NULL, so anchoring dedupe on it cannot be defeated the same way.
-- The original constraint is retained: when an external event id IS present it is the
-- stronger signal, because it survives an edited message body.
create unique index if not exists raw_signals_source_content_unique
  on app_private.raw_signals (source_type, source_ref, content_hash);
