-- Migration 32 — withdrawal reconciliation against the network.
--
-- WHY THIS EXISTS
--
-- `app_user_record_withdrawal_signature` moves an intent to `submitted`.
-- `app_user_settle_withdrawal` moves it to `confirmed` and writes the cash movement.
-- Nothing in production ever called the second one. Only test scripts did.
--
-- `app_user_withdrawable_state` counts `submitted` toward pendingWithdrawalLamports, so a
-- withdrawal that succeeded on chain and was never settled subtracts its amount from the
-- owner's spendable balance FOREVER. The user is then told they have nothing to withdraw
-- while their money is sitting in their wallet. That is the live defect this fixes:
-- intent ffd39d05 (0.89 SOL, signature 4GGgr4he…) confirmed on chain 2026-08-15 and was
-- still `submitted` three days later, holding 0.89 SOL of that user's balance hostage.
--
-- WHY A NEW FUNCTION RATHER THAN WIDENING THE OLD ONE
--
-- `app_user_settle_withdrawal` refuses any non-confirmed outcome for an intent that carries
-- a signature:
--
--   "a signed withdrawal must be reconciled against the network, not failed"
--
-- That guard is correct and stays exactly as it is. It protects the CLIENT path, where the
-- caller is a browser that knows only that its own request failed — which is not evidence
-- the transfer failed. Weakening it would let a closed tab free capital the chain had taken.
--
-- This function is the reconciliation the guard asks for. It is called only after the server
-- has read the transaction from a Solana RPC, and the caller states what it saw. Freeing
-- capital is permitted here precisely because "did not move money" is an observed fact rather
-- than an inference from a failed request.
--
-- p_landed    the signature was found on chain
-- p_succeeded the transaction executed without error (meta.err is null)
--
--   landed + succeeded  -> confirmed, cash movement written
--   landed + reverted   -> failed, hold released; no money moved, so none is recorded
--   not landed          -> expired, hold released. A Solana blockhash expires in about a
--                          minute, so a signature absent from history well past that can
--                          never land later. The caller enforces the age; this asserts it
--                          again below so a mistaken call cannot free capital early.
--
-- Rerun-safe. Additive: one new function, no table or column changes, nothing replaced.
-- Rollback: supabase/rollback/32-withdrawal-reconciliation.sql

create or replace function public.app_user_reconcile_withdrawal(
  p_secret text,
  p_privy_user_id text,
  p_intent_id uuid,
  p_landed boolean,
  p_succeeded boolean,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent app_private.withdrawal_intents%rowtype;
  v_outcome text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_intent
  from app_private.withdrawal_intents
  where id = p_intent_id and owner_privy_user_id = p_privy_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'withdrawal not found');
  end if;

  -- Already terminal. Reconciliation is idempotent by design: the endpoint that calls this
  -- runs on every portfolio load, so it re-examines the same rows constantly.
  if v_intent.state in ('confirmed', 'failed', 'expired', 'reversed') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'state', v_intent.state);
  end if;

  if v_intent.state <> 'submitted' then
    return jsonb_build_object('ok', false, 'status', 409,
      'error', 'only a submitted withdrawal can be reconciled');
  end if;

  if v_intent.tx_signature is null then
    return jsonb_build_object('ok', false, 'status', 409,
      'error', 'a withdrawal cannot be reconciled before its transaction is recorded');
  end if;

  if p_landed is null or (p_landed and p_succeeded is null) then
    return jsonb_build_object('ok', false, 'status', 400,
      'error', 'reconciliation requires an observed network result');
  end if;

  -- Freeing capital on "not found" is only sound once the transaction can no longer land.
  -- A blockhash lives about 60-90 seconds; two minutes is past that with room to spare, and
  -- it is asserted HERE as well as in the caller so a bug in one cannot release early.
  if not p_landed and v_intent.submitted_at > now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'status', 409,
      'error', 'too early to declare an unlanded transfer expired');
  end if;

  v_outcome := case
    when p_landed and p_succeeded then 'confirmed'
    when p_landed then 'failed'
    else 'expired'
  end;

  update app_private.withdrawal_intents
  set state = v_outcome,
      error = nullif(left(coalesce(p_error, ''), 500), ''),
      confirmed_at = case when v_outcome = 'confirmed' then now() else confirmed_at end,
      terminal_at = now()
  where id = v_intent.id
  returning * into v_intent;

  -- Only a transfer that actually moved money becomes a cash movement. A reverted or dropped
  -- transaction releases the hold and records nothing, because nothing happened.
  --
  -- network_fee_lamports stays 0 for the reason given in app_user_settle_withdrawal: the
  -- user's own wallet paid it, and inventing a plausible number would be a fabricated
  -- financial figure. The signature is stored beside it.
  if v_intent.state = 'confirmed' then
    insert into app_private.cash_movements (
      owner_privy_user_id, movement_type, status, amount_lamports,
      network_fee_lamports, tx_signature, observed_at
    ) values (
      v_intent.owner_privy_user_id, 'withdrawal', 'confirmed', v_intent.amount_lamports,
      0, v_intent.tx_signature, coalesce(v_intent.confirmed_at, now())
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'state', v_intent.state);
end;
$$;

revoke all on function public.app_user_reconcile_withdrawal(text, text, uuid, boolean, boolean, text) from public;
revoke all on function public.app_user_reconcile_withdrawal(text, text, uuid, boolean, boolean, text) from anon;
revoke all on function public.app_user_reconcile_withdrawal(text, text, uuid, boolean, boolean, text) from authenticated;
grant execute on function public.app_user_reconcile_withdrawal(text, text, uuid, boolean, boolean, text) to service_role;
