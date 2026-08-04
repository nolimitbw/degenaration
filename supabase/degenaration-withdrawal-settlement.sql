-- Controller section 7 / master spec section 5.5: the withdrawal history that had no rows.
--
-- Apply after degenaration-withdrawal-intents.sql, whose app_user_settle_withdrawal this
-- replaces IN PLACE — same argument list, so `create or replace` genuinely replaces it
-- rather than adding an overload. (Adding a parameter here would create one, and a caller
-- omitting it then fails with "function ... is not unique", which is how the exit-plan
-- migration had to drop its predecessors.)
--
-- Rollback: reapply degenaration-withdrawal-intents.sql. The index and the new function
-- added here are additive; movements already written stay valid and correct.
--
-- WHAT WAS MISSING
--
-- app_user_settle_withdrawal already makes the state transition correctly, including the
-- rule that a signed transfer may not simply be declared failed because it might have
-- landed. What it does not do is write app_private.cash_movements.
--
-- That table has NO writer anywhere in the repository — verified by grep across supabase/,
-- app/, lib/ and server/. It is the last table of the authoritative accounting model still
-- in that state (docs/ai/ACCOUNTING_MODEL.md §1), and Portfolio's deposit-and-withdrawal
-- history reads it. So a user who withdrew saw no record of having done so, and the
-- history tab was structurally empty no matter how much they moved.
--
-- The movement is written in the SAME transaction as the state change. A confirmed
-- withdrawal without its ledger row, or a row without its confirmation, is precisely the
-- split this accounting model exists to prevent — and is the defect shape this codebase
-- has had to correct four times.

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

  -- A confirmation without a signature would be a claim that money moved with nothing to
  -- check it against. Refused rather than recorded.
  if p_outcome = 'confirmed' and v_intent.tx_signature is null then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', 'a withdrawal cannot be confirmed before its transaction is recorded'
    );
  end if;

  update app_private.withdrawal_intents
  set state = p_outcome,
      error = nullif(left(coalesce(p_error, ''), 500), ''),
      confirmed_at = case when p_outcome = 'confirmed' then now() else confirmed_at end,
      terminal_at = now()
  where id = v_intent.id
  returning * into v_intent;

  if v_intent.state = 'confirmed' then
    -- network_fee_lamports is recorded as 0 rather than guessed. This product is
    -- non-custodial: the user's own wallet paid the network fee, the server never saw the
    -- transaction meta, and inventing a plausible number here would be a fabricated
    -- financial figure. The signature is stored alongside, so the exact fee is one
    -- explorer click away, and a reconciliation pass that reads the transaction can raise
    -- it later without changing the amount.
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

-- One transfer, one movement, however many times a retry or a second tab settles it. The
-- index is what makes the insert above idempotent rather than trusting the caller to check.
create unique index if not exists cash_movements_signature_unique
  on app_private.cash_movements (tx_signature)
  where tx_signature is not null;

revoke execute on function public.app_user_settle_withdrawal(text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.app_user_settle_withdrawal(text, text, uuid, text, text)
  to service_role;

-- Withdrawals still awaiting an on-chain answer, for the owner who is looking at them.
--
-- Without this nothing ever calls the settlement above: the transfer is broadcast by the
-- user's wallet, so if the tab closes between broadcast and confirmation there is no actor
-- left that knows to look. Returning the owner's own in-flight transfers lets the next page
-- load finish them. Bounded and owner-scoped — it runs on an ordinary page load and must
-- not become a table scan or a way to enumerate anyone else's transfers.
create or replace function public.app_user_pending_withdrawals(
  p_secret text,
  p_privy_user_id text,
  p_older_than_seconds integer default 20
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id,
           'txSignature', w.tx_signature,
           'amountLamports', w.amount_lamports::text,
           'submittedAt', w.submitted_at
         ) order by w.submitted_at asc), '[]'::jsonb)
  into v_rows
  from app_private.withdrawal_intents w
  where w.owner_privy_user_id = p_privy_user_id
    and w.state = 'submitted'
    and w.tx_signature is not null
    -- A grace period, so a transfer broadcast a second ago is not immediately chased by a
    -- page load that raced it.
    and w.submitted_at < now() - make_interval(secs => greatest(0, coalesce(p_older_than_seconds, 20)))
  limit 20;

  return jsonb_build_object('ok', true, 'withdrawals', v_rows);
end;
$$;

revoke execute on function public.app_user_pending_withdrawals(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.app_user_pending_withdrawals(text, text, integer) to service_role;
