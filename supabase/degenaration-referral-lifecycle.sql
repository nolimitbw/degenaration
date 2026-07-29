-- Immutable referral attribution, custom aliases, reward lifecycle, and abuse review.
-- The monetary reward policy is intentionally disabled until the owner sets an
-- approved rate; attribution and qualifying activity still operate normally.

alter table app_private.affiliate_profiles
  add column if not exists custom_slug_approved boolean not null default false,
  add column if not exists slug_changed_at timestamptz;

alter table app_private.affiliate_profiles
  drop constraint if exists affiliate_profiles_referral_code_check;
alter table app_private.affiliate_profiles
  add constraint affiliate_profiles_referral_code_check
  check (referral_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{3,31}$');

alter table app_private.referral_links
  drop constraint if exists referral_links_code_check;
alter table app_private.referral_links
  add constraint referral_links_code_check
  check (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{3,47}$');

create table if not exists app_private.referral_aliases (
  id uuid primary key default gen_random_uuid(),
  referral_link_id uuid not null references app_private.referral_links(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{3,47}$'),
  status text not null default 'active' check (status in ('active', 'retired')),
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retained_until timestamptz,
  check (
    (status = 'active' and retired_at is null)
    or (status = 'retired' and retired_at is not null)
  )
);

create unique index if not exists referral_aliases_slug_lower_unique
  on app_private.referral_aliases (lower(slug));
create unique index if not exists referral_aliases_link_active_unique
  on app_private.referral_aliases (referral_link_id)
  where status = 'active';

insert into app_private.referral_aliases (
  referral_link_id, slug, status, is_custom
)
select l.id, lower(l.code), 'active', false
from app_private.referral_links l
where l.active = true
on conflict do nothing;

create or replace function app_private.sync_referral_alias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and lower(old.code) is distinct from lower(new.code) then
    update app_private.referral_aliases
    set status = 'retired',
        retired_at = now(),
        retained_until = now() + interval '365 days'
    where referral_link_id = new.id
      and status = 'active';
  end if;

  if new.active = true and new.disabled_at is null then
    insert into app_private.referral_aliases (
      referral_link_id, slug, status, is_custom
    ) values (
      new.id,
      lower(new.code),
      'active',
      lower(new.code) ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        and exists (
          select 1
          from app_private.affiliate_profiles p
          where p.privy_user_id = new.owner_privy_user_id
            and p.slug_changed_at is not null
        )
    )
    on conflict do nothing;
  else
    update app_private.referral_aliases
    set status = 'retired',
        retired_at = coalesce(retired_at, now()),
        retained_until = coalesce(retained_until, now() + interval '365 days')
    where referral_link_id = new.id
      and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists referral_links_sync_alias
  on app_private.referral_links;
create trigger referral_links_sync_alias
after insert or update of code, active, disabled_at
on app_private.referral_links
for each row execute function app_private.sync_referral_alias();

create table if not exists app_private.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referral_link_id uuid not null references app_private.referral_links(id) on delete restrict,
  referrer_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  referred_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
  capture_nonce text not null unique check (capture_nonce ~ '^[a-f0-9]{36}$'),
  captured_at timestamptz not null,
  attributed_at timestamptz not null default now(),
  attribution_expires_at timestamptz not null,
  status text not null default 'verified'
    check (status in ('verified', 'review', 'rejected', 'revoked')),
  status_reason text not null,
  first_qualifying_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (referred_privy_user_id),
  check (referrer_privy_user_id <> referred_privy_user_id),
  check (attribution_expires_at > captured_at)
);

create index if not exists referral_attributions_referrer_idx
  on app_private.referral_attributions (referrer_privy_user_id, attributed_at desc);
create index if not exists referral_attributions_visitor_idx
  on app_private.referral_attributions (visitor_hash, attributed_at desc);

create table if not exists app_private.referral_abuse_flags (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid references app_private.referral_attributions(id) on delete restrict,
  referrer_privy_user_id text references app_private.app_users(privy_user_id) on delete restrict,
  referred_privy_user_id text references app_private.app_users(privy_user_id) on delete restrict,
  flag_type text not null check (
    flag_type in ('self_referral', 'shared_visitor', 'linked_identity', 'duplicate_capture', 'manual_review')
  ),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'cleared', 'confirmed')),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_privy_user_id text
);

create index if not exists referral_abuse_flags_status_idx
  on app_private.referral_abuse_flags (status, created_at desc);

create table if not exists app_private.referral_slug_changes (
  id uuid primary key default gen_random_uuid(),
  referral_link_id uuid not null references app_private.referral_links(id) on delete restrict,
  owner_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  previous_slug text not null,
  next_slug text not null,
  reason text not null,
  changed_at timestamptz not null default now(),
  check (lower(previous_slug) <> lower(next_slug))
);

create table if not exists app_private.referral_reward_policy (
  singleton boolean primary key default true check (singleton = true),
  enabled boolean not null default false,
  rate_bps integer not null default 0 check (rate_bps between 0 and 1000),
  hold_seconds integer not null default 604800 check (hold_seconds between 0 and 7776000),
  minimum_notional_lamports bigint not null default 0 check (minimum_notional_lamports >= 0),
  updated_at timestamptz not null default now(),
  updated_by_privy_user_id text,
  reason text not null default 'Owner approval required before monetary referral rewards are enabled'
);

insert into app_private.referral_reward_policy (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists app_private.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null references app_private.referral_attributions(id) on delete restrict,
  referrer_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  referred_privy_user_id text not null references app_private.app_users(privy_user_id) on delete restrict,
  qualifying_type text not null check (qualifying_type in ('trade', 'admin_adjustment')),
  qualifying_id text not null,
  gross_notional_lamports bigint not null check (gross_notional_lamports >= 0),
  rate_bps integer not null check (rate_bps between 0 and 1000),
  amount_lamports bigint not null check (amount_lamports > 0),
  status text not null default 'pending'
    check (status in ('pending', 'available', 'paid', 'reversed', 'rejected')),
  status_reason text not null,
  available_at timestamptz not null,
  paid_at timestamptz,
  reversed_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referral_rewards_owner_status_idx
  on app_private.referral_rewards (referrer_privy_user_id, status, created_at desc);

create table if not exists app_private.referral_reward_status_history (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references app_private.referral_rewards(id) on delete restrict,
  previous_status text,
  next_status text not null,
  amount_lamports bigint not null,
  reason text not null,
  changed_at timestamptz not null default now(),
  unique (reward_id, next_status)
);

create or replace function app_private.protect_referral_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.referral_link_id is distinct from old.referral_link_id
    or new.referrer_privy_user_id is distinct from old.referrer_privy_user_id
    or new.referred_privy_user_id is distinct from old.referred_privy_user_id
    or new.visitor_hash is distinct from old.visitor_hash
    or new.capture_nonce is distinct from old.capture_nonce
    or new.captured_at is distinct from old.captured_at
    or new.attributed_at is distinct from old.attributed_at
    or new.attribution_expires_at is distinct from old.attribution_expires_at then
    raise exception 'referral attribution is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists referral_attributions_immutable
  on app_private.referral_attributions;
create trigger referral_attributions_immutable
before update on app_private.referral_attributions
for each row execute function app_private.protect_referral_attribution();

create or replace function app_private.protect_referral_reward_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.attribution_id is distinct from old.attribution_id
    or new.referrer_privy_user_id is distinct from old.referrer_privy_user_id
    or new.referred_privy_user_id is distinct from old.referred_privy_user_id
    or new.qualifying_type is distinct from old.qualifying_type
    or new.qualifying_id is distinct from old.qualifying_id
    or new.gross_notional_lamports is distinct from old.gross_notional_lamports
    or new.rate_bps is distinct from old.rate_bps
    or new.amount_lamports is distinct from old.amount_lamports
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_at is distinct from old.created_at then
    raise exception 'referral reward principal is immutable' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists referral_rewards_immutable_amount
  on app_private.referral_rewards;
create trigger referral_rewards_immutable_amount
before update on app_private.referral_rewards
for each row execute function app_private.protect_referral_reward_amount();

create or replace function app_private.record_referral_reward_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into app_private.referral_reward_status_history (
      reward_id, previous_status, next_status, amount_lamports, reason
    ) values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      new.amount_lamports,
      new.status_reason
    )
    on conflict (reward_id, next_status) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists referral_rewards_record_status
  on app_private.referral_rewards;
create trigger referral_rewards_record_status
after insert or update of status on app_private.referral_rewards
for each row execute function app_private.record_referral_reward_status();

create or replace function app_private.referral_slug_error(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or char_length(trim(p_value)) not between 4 and 32
      then 'Use 4 to 32 characters.'
    when trim(p_value) <> lower(trim(p_value))
      then 'Use lowercase letters only.'
    when trim(p_value) !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      then 'Use lowercase letters, numbers, and single hyphens only.'
    when trim(p_value) = any(array[
      'admin','affiliate','api','auth','bots','degenaration','discord',
      'help','kol','login','logout','mod','moderator','official','portfolio',
      'privacy','r','settings','signup','source','staff','support','team','terms'
    ])
      then 'This name is reserved.'
    else null
  end;
$$;

create or replace function app_private.referral_custom_slug_eligible(p_privy_user_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.custom_slug_approved
    from app_private.affiliate_profiles p
    where p.privy_user_id = p_privy_user_id
  ), false) or exists (
    select 1
    from public.approved_groups g
    where g.owner_privy_user_id = p_privy_user_id
      and g.active = true
      and g.verification_status = 'approved'
      and g.removed_at is null
      and g.suspended_at is null
  );
$$;

create or replace function public.app_public_resolve_referral(
  p_secret text,
  p_code text,
  p_visitor_hash text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link app_private.referral_links%rowtype;
  v_alias app_private.referral_aliases%rowtype;
  v_destination text;
  v_slug text;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_code is null
    or p_code !~* '^[a-z0-9][a-z0-9_-]{3,47}$'
    or p_visitor_hash !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_idempotency_key, '')) not between 20 and 200 then
    raise exception 'invalid referral request' using errcode = '22023';
  end if;

  select a.*
  into v_alias
  from app_private.referral_aliases a
  where lower(a.slug) = lower(p_code)
    and (
      a.status = 'active'
      or (a.status = 'retired' and a.retained_until > now())
    )
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'referral not found');
  end if;

  select l.*
  into v_link
  from app_private.referral_links l
  join app_private.app_users u on u.privy_user_id = l.owner_privy_user_id
  where l.id = v_alias.referral_link_id
    and l.active = true
    and l.disabled_at is null
    and u.status = 'active'
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'referral not found');
  end if;

  if v_link.subject_type = 'profile' then
    v_destination := '/bots';
  elsif v_link.subject_type = 'kol' then
    if not exists (
      select 1
      from app_private.kol_strategies ks
      join app_private.bot_profiles b on b.id = ks.bot_id
      where ks.id::text = v_link.subject_id
        and ks.moderation_status = 'approved'
        and b.visibility = 'public'
        and b.status in ('active', 'paused')
    ) then
      return jsonb_build_object('ok', false, 'status', 404, 'error', 'referral not found');
    end if;
    v_destination := '/bots/kol/' || v_link.subject_id;
  else
    select g.public_slug into v_slug
    from public.approved_groups g
    where g.id::text = v_link.subject_id
      and g.active = true
      and g.verification_status = 'approved'
      and g.removed_at is null;
    if v_slug is null then
      return jsonb_build_object('ok', false, 'status', 404, 'error', 'referral not found');
    end if;
    v_destination := '/source/' || v_slug;
  end if;

  insert into app_private.referral_events (
    referral_link_id, event_type, visitor_hash, idempotency_key, metadata
  ) values (
    v_link.id,
    'click',
    p_visitor_hash,
    p_idempotency_key,
    jsonb_build_object('alias', v_alias.slug, 'canonicalCode', v_link.code)
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'code', v_alias.slug,
    'canonicalCode', v_link.code,
    'subjectType', v_link.subject_type,
    'destination', v_destination
  );
end;
$$;

create or replace function public.app_user_complete_referral_attribution(
  p_secret text,
  p_privy_user_id text,
  p_code text,
  p_visitor_hash text,
  p_capture_nonce text,
  p_captured_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link app_private.referral_links%rowtype;
  v_existing app_private.referral_attributions%rowtype;
  v_attribution_id uuid;
  v_status text := 'verified';
  v_reason text := 'First-touch referral captured before authentication';
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.ensure_app_user(p_privy_user_id);

  if p_code !~ '^[a-z0-9][a-z0-9_-]{3,47}$'
    or p_visitor_hash !~ '^[a-f0-9]{64}$'
    or p_capture_nonce !~ '^[a-f0-9]{36}$'
    or p_captured_at < now() - interval '30 days'
    or p_captured_at > now() + interval '5 minutes' then
    raise exception 'invalid or expired referral capture' using errcode = '22023';
  end if;

  select l.*
  into v_link
  from app_private.referral_aliases a
  join app_private.referral_links l on l.id = a.referral_link_id
  join app_private.app_users u on u.privy_user_id = l.owner_privy_user_id
  where lower(a.slug) = lower(p_code)
    and (a.status = 'active' or (a.status = 'retired' and a.retained_until > now()))
    and l.active = true
    and l.disabled_at is null
    and u.status = 'active'
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'referral not found');
  end if;

  select a.*
  into v_existing
  from app_private.referral_attributions a
  where a.referred_privy_user_id = p_privy_user_id;
  if found then
    return jsonb_build_object(
      'ok', true,
      'attributed', true,
      'alreadyAttributed', true,
      'status', v_existing.status
    );
  end if;

  if v_link.owner_privy_user_id = p_privy_user_id then
    insert into app_private.referral_abuse_flags (
      referrer_privy_user_id, referred_privy_user_id, flag_type, severity, reason
    ) values (
      p_privy_user_id, p_privy_user_id, 'self_referral', 'high',
      'The authenticated user opened their own referral link'
    );
    return jsonb_build_object('ok', true, 'attributed', false, 'reason', 'self-referral');
  end if;

  if exists (
    select 1
    from app_private.referral_attributions a
    where a.visitor_hash = p_visitor_hash
      and a.referred_privy_user_id <> p_privy_user_id
      and a.attributed_at >= now() - interval '30 days'
  ) then
    v_status := 'review';
    v_reason := 'Shared visitor fingerprint requires review before rewards';
  end if;

  insert into app_private.referral_attributions (
    referral_link_id,
    referrer_privy_user_id,
    referred_privy_user_id,
    visitor_hash,
    capture_nonce,
    captured_at,
    attribution_expires_at,
    status,
    status_reason
  ) values (
    v_link.id,
    v_link.owner_privy_user_id,
    p_privy_user_id,
    p_visitor_hash,
    p_capture_nonce,
    p_captured_at,
    p_captured_at + interval '30 days',
    v_status,
    v_reason
  )
  on conflict (referred_privy_user_id) do nothing
  returning id into v_attribution_id;

  if v_attribution_id is null then
    return jsonb_build_object('ok', true, 'attributed', true, 'alreadyAttributed', true);
  end if;

  insert into app_private.referral_events (
    referral_link_id,
    event_type,
    visitor_hash,
    referred_privy_user_id,
    idempotency_key,
    metadata
  ) values (
    v_link.id,
    'signup',
    p_visitor_hash,
    p_privy_user_id,
    'referral-signup:' || p_capture_nonce,
    jsonb_build_object('attributionId', v_attribution_id, 'status', v_status)
  )
  on conflict (idempotency_key) do nothing;

  if v_status = 'review' then
    insert into app_private.referral_abuse_flags (
      attribution_id,
      referrer_privy_user_id,
      referred_privy_user_id,
      flag_type,
      severity,
      reason,
      evidence
    ) values (
      v_attribution_id,
      v_link.owner_privy_user_id,
      p_privy_user_id,
      'shared_visitor',
      'medium',
      v_reason,
      jsonb_build_object('visitorHashPrefix', left(p_visitor_hash, 12))
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'attributed', true,
    'alreadyAttributed', false,
    'status', v_status
  );
end;
$$;

create or replace function public.app_user_check_referral_slug(
  p_secret text,
  p_privy_user_id text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_error text;
  v_profile app_private.affiliate_profiles%rowtype;
  v_link_id uuid;
  v_conflict_link_id uuid;
  v_eligible boolean;
  v_cooldown_until timestamptz;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.ensure_app_user(p_privy_user_id);

  insert into app_private.affiliate_profiles (privy_user_id, referral_code)
  values (
    p_privy_user_id,
    upper(substr(encode(extensions.digest(p_privy_user_id, 'sha256'), 'hex'), 1, 12))
  )
  on conflict (privy_user_id) do nothing;

  select * into v_profile
  from app_private.affiliate_profiles
  where privy_user_id = p_privy_user_id;

  select id into v_link_id
  from app_private.referral_links
  where owner_privy_user_id = p_privy_user_id
    and subject_type = 'profile';

  v_error := app_private.referral_slug_error(v_slug);
  v_eligible := app_private.referral_custom_slug_eligible(p_privy_user_id);
  v_cooldown_until := case
    when v_profile.slug_changed_at is not null
      then v_profile.slug_changed_at + interval '30 days'
  end;

  select a.referral_link_id
  into v_conflict_link_id
  from app_private.referral_aliases a
  where lower(a.slug) = v_slug
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'slug', v_slug,
    'eligible', v_eligible,
    'valid', v_error is null,
    'available', v_error is null
      and (v_conflict_link_id is null or v_conflict_link_id = v_link_id),
    'current', lower(v_profile.referral_code) = v_slug,
    'cooldownUntil', v_cooldown_until,
    'reason', case
      when not v_eligible then 'An approved Discord source or explicit affiliate approval is required.'
      when v_error is not null then v_error
      when v_conflict_link_id is not null and v_conflict_link_id <> v_link_id then 'This referral slug is unavailable.'
      when v_cooldown_until > now() and lower(v_profile.referral_code) <> v_slug
        then 'Referral slugs can be changed once every 30 days.'
      else null
    end
  );
end;
$$;

create or replace function public.app_user_change_referral_slug(
  p_secret text,
  p_privy_user_id text,
  p_slug text,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_error text;
  v_profile app_private.affiliate_profiles%rowtype;
  v_link app_private.referral_links%rowtype;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.ensure_app_user(p_privy_user_id);
  if p_confirmed is not true then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'confirmation required');
  end if;

  insert into app_private.affiliate_profiles (privy_user_id, referral_code)
  values (
    p_privy_user_id,
    upper(substr(encode(extensions.digest(p_privy_user_id, 'sha256'), 'hex'), 1, 12))
  )
  on conflict (privy_user_id) do nothing;

  select * into v_profile
  from app_private.affiliate_profiles
  where privy_user_id = p_privy_user_id
  for update;

  if not app_private.referral_custom_slug_eligible(p_privy_user_id) then
    return jsonb_build_object('ok', false, 'status', 403, 'error', 'custom referral slug is not approved');
  end if;

  v_error := app_private.referral_slug_error(v_slug);
  if v_error is not null then
    return jsonb_build_object('ok', false, 'status', 400, 'error', v_error);
  end if;
  if lower(v_profile.referral_code) = v_slug then
    return jsonb_build_object('ok', true, 'slug', v_slug, 'unchanged', true);
  end if;
  if v_profile.slug_changed_at is not null
    and v_profile.slug_changed_at > now() - interval '30 days' then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'referral slug cooldown is active');
  end if;
  if exists (
    select 1
    from app_private.referral_aliases a
    where lower(a.slug) = v_slug
  ) then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'referral slug is unavailable');
  end if;

  select * into v_link
  from app_private.referral_links
  where owner_privy_user_id = p_privy_user_id
    and subject_type = 'profile'
  for update;
  if not found then
    raise exception 'profile referral link missing' using errcode = 'P0002';
  end if;

  update app_private.affiliate_profiles
  set referral_code = v_slug,
      slug_changed_at = now()
  where privy_user_id = p_privy_user_id;

  insert into app_private.referral_slug_changes (
    referral_link_id,
    owner_privy_user_id,
    previous_slug,
    next_slug,
    reason
  ) values (
    v_link.id,
    p_privy_user_id,
    lower(v_link.code),
    v_slug,
    'Owner-confirmed custom referral slug change'
  );

  return jsonb_build_object(
    'ok', true,
    'slug', v_slug,
    'previousSlug', lower(v_link.code),
    'cooldownUntil', now() + interval '30 days'
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'referral slug is unavailable');
end;
$$;

create or replace function app_private.accrue_referral_reward_for_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attribution app_private.referral_attributions%rowtype;
  v_policy app_private.referral_reward_policy%rowtype;
  v_amount bigint;
begin
  if new.status = 'reconciled'
    and old.status is distinct from 'reconciled'
    and new.execution_mode = 'solana-mainnet'
    and new.gross_notional_lamports > 0 then
    select * into v_attribution
    from app_private.referral_attributions a
    where a.referred_privy_user_id = new.owner_privy_user_id
      and a.status = 'verified'
    limit 1;

    if found then
      update app_private.referral_attributions
      set first_qualifying_at = coalesce(first_qualifying_at, new.reconciled_at, now())
      where id = v_attribution.id;

      insert into app_private.referral_events (
        referral_link_id,
        event_type,
        referred_privy_user_id,
        notional_lamports,
        idempotency_key,
        metadata
      ) values (
        v_attribution.referral_link_id,
        'trade',
        new.owner_privy_user_id,
        new.gross_notional_lamports,
        'referral-trade:' || new.id::text,
        jsonb_build_object('executionId', new.id)
      )
      on conflict (idempotency_key) do nothing;

      select * into v_policy
      from app_private.referral_reward_policy
      where singleton = true;

      if v_policy.enabled
        and v_policy.rate_bps > 0
        and new.gross_notional_lamports >= v_policy.minimum_notional_lamports then
        v_amount := (new.gross_notional_lamports * v_policy.rate_bps) / 10000;
        if v_amount > 0 then
          insert into app_private.referral_rewards (
            attribution_id,
            referrer_privy_user_id,
            referred_privy_user_id,
            qualifying_type,
            qualifying_id,
            gross_notional_lamports,
            rate_bps,
            amount_lamports,
            status,
            status_reason,
            available_at,
            idempotency_key
          ) values (
            v_attribution.id,
            v_attribution.referrer_privy_user_id,
            v_attribution.referred_privy_user_id,
            'trade',
            new.id::text,
            new.gross_notional_lamports,
            v_policy.rate_bps,
            v_amount,
            'pending',
            'Confirmed and reconciled trade; hold period active',
            coalesce(new.reconciled_at, now()) + make_interval(secs => v_policy.hold_seconds),
            'referral-reward:trade:' || new.id::text
          )
          on conflict (idempotency_key) do nothing;
        end if;
      end if;
    end if;
  elsif old.status = 'reconciled'
    and new.status in ('failed', 'dropped', 'expired') then
    update app_private.referral_rewards
    set status = 'reversed',
        status_reason = 'Authoritative execution was reversed or invalidated',
        reversed_at = now()
    where qualifying_type = 'trade'
      and qualifying_id = new.id::text
      and status in ('pending', 'available');
  end if;
  return new;
end;
$$;

drop trigger if exists trade_executions_referral_reward
  on app_private.trade_executions;
create trigger trade_executions_referral_reward
after update of status on app_private.trade_executions
for each row execute function app_private.accrue_referral_reward_for_execution();

create or replace function public.app_user_affiliate_summary(
  p_secret text,
  p_privy_user_id text,
  p_scope text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_available bigint;
  v_pending bigint;
  v_lifetime bigint;
  v_30d bigint;
  v_followers integer;
  v_volume bigint;
  v_chart jsonb;
  v_events jsonb;
  v_payouts jsonb;
  v_links jsonb;
  v_total_invites integer;
  v_verified_invites integer;
  v_active_referrals integer;
  v_referral_pending bigint;
  v_referral_available bigint;
  v_referral_lifetime bigint;
  v_referral_activity jsonb;
  v_slug_changed_at timestamptz;
  v_custom_slug_eligible boolean;
  v_reward_policy_enabled boolean;
begin
  if not app_private.admin_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform app_private.ensure_app_user(p_privy_user_id);

  insert into app_private.affiliate_profiles (privy_user_id, referral_code)
  values (
    p_privy_user_id,
    upper(substr(encode(extensions.digest(p_privy_user_id, 'sha256'), 'hex'), 1, 12))
  )
  on conflict (privy_user_id) do nothing;

  update app_private.referral_rewards
  set status = 'available',
      status_reason = 'Hold period completed and reward remains eligible'
  where referrer_privy_user_id = p_privy_user_id
    and status = 'pending'
    and available_at <= now();

  select p.referral_code, p.slug_changed_at
  into v_code, v_slug_changed_at
  from app_private.affiliate_profiles p
  where p.privy_user_id = p_privy_user_id;
  v_custom_slug_eligible := app_private.referral_custom_slug_eligible(p_privy_user_id);

  select enabled into v_reward_policy_enabled
  from app_private.referral_reward_policy
  where singleton = true;

  select
    coalesce(sum(l.amount_lamports) filter (where l.available_at <= now()), 0)::bigint,
    coalesce(sum(l.amount_lamports) filter (where l.available_at > now()), 0)::bigint,
    coalesce(sum(greatest(l.amount_lamports, 0)), 0)::bigint,
    coalesce(sum(greatest(l.amount_lamports, 0))
      filter (where l.created_at >= now() - interval '30 days'), 0)::bigint
  into v_available, v_pending, v_lifetime, v_30d
  from app_private.commission_ledger_entries l
  where l.account_owner_privy_user_id = p_privy_user_id
    and l.account_type = 'creator'
    and (
      lower(coalesce(p_scope, 'all')) = 'all'
      or l.source_type = lower(p_scope)
    );

  select
    count(distinct e.referred_privy_user_id)
      filter (where e.event_type = 'follow' and e.referred_privy_user_id is not null)::integer,
    coalesce(sum(e.notional_lamports)
      filter (where e.event_type = 'trade'), 0)::bigint
  into v_followers, v_volume
  from app_private.referral_events e
  join app_private.referral_links l on l.id = e.referral_link_id
  where l.owner_privy_user_id = p_privy_user_id
    and (
      lower(coalesce(p_scope, 'all')) = 'all'
      or l.subject_type = lower(p_scope)
    );

  select
    count(*)::integer,
    count(*) filter (where a.status = 'verified')::integer,
    count(*) filter (where a.status = 'verified' and a.first_qualifying_at is not null)::integer
  into v_total_invites, v_verified_invites, v_active_referrals
  from app_private.referral_attributions a
  where a.referrer_privy_user_id = p_privy_user_id;

  select
    coalesce(sum(r.amount_lamports) filter (where r.status = 'pending'), 0)::bigint,
    coalesce(sum(r.amount_lamports) filter (where r.status = 'available'), 0)::bigint,
    coalesce(sum(r.amount_lamports) filter (where r.status in ('pending', 'available', 'paid')), 0)::bigint
  into v_referral_pending, v_referral_available, v_referral_lifetime
  from app_private.referral_rewards r
  where r.referrer_privy_user_id = p_privy_user_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
  into v_chart
  from (
    select
      date_trunc('day', l.created_at)::date as day,
      sum(l.amount_lamports)::bigint as "amountLamports"
    from app_private.commission_ledger_entries l
    where l.account_owner_privy_user_id = p_privy_user_id
      and l.created_at >= now() - interval '30 days'
      and (
        lower(coalesce(p_scope, 'all')) = 'all'
        or l.source_type = lower(p_scope)
      )
    group by date_trunc('day', l.created_at)::date
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select
      l.id,
      l.source_type as "sourceType",
      l.source_id as "sourceId",
      l.amount_lamports as "amountLamports",
      l.rate_bps as "rateBps",
      l.gross_notional_lamports as "grossNotionalLamports",
      l.available_at as "availableAt",
      l.created_at
    from app_private.commission_ledger_entries l
    where l.account_owner_privy_user_id = p_privy_user_id
      and (
        lower(coalesce(p_scope, 'all')) = 'all'
        or l.source_type = lower(p_scope)
      )
    order by l.created_at desc
    limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.attributed_at desc), '[]'::jsonb)
  into v_referral_activity
  from (
    select
      a.id,
      'Invite ' || upper(substr(encode(extensions.digest(a.referred_privy_user_id, 'sha256'), 'hex'), 1, 8)) as "inviteLabel",
      a.status,
      a.status_reason as "statusReason",
      a.first_qualifying_at as "firstQualifyingAt",
      a.attributed_at,
      coalesce((
        select sum(r.amount_lamports)
        from app_private.referral_rewards r
        where r.attribution_id = a.id
          and r.status in ('pending', 'available', 'paid')
      ), 0)::bigint as "rewardLamports"
    from app_private.referral_attributions a
    where a.referrer_privy_user_id = p_privy_user_id
    order by a.attributed_at desc
    limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc), '[]'::jsonb)
  into v_payouts
  from (
    select
      p.id,
      p.asset,
      p.chain,
      p.destination_wallet as "destinationWallet",
      p.gross_lamports as "grossLamports",
      p.processing_fee_lamports as "processingFeeLamports",
      p.net_lamports as "netLamports",
      p.status,
      p.requested_at,
      p.processed_at,
      p.tx_signature as "txSignature",
      p.decision_reason as "decisionReason"
    from app_private.payout_requests p
    where p.owner_privy_user_id = p_privy_user_id
    order by p.requested_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_links
  from (
    select
      l.id,
      l.code,
      l.subject_type as "subjectType",
      l.subject_id as "subjectId",
      l.active,
      l.created_at
    from app_private.referral_links l
    where l.owner_privy_user_id = p_privy_user_id
    order by l.created_at desc
  ) x;

  return jsonb_build_object(
    'ok', true,
    'scope', lower(coalesce(p_scope, 'all')),
    'referralCode', v_code,
    'availableLamports', greatest(v_available, 0),
    'pendingLamports', greatest(v_pending, 0),
    'lifetimeLamports', greatest(v_lifetime, 0),
    'earnings30dLamports', greatest(v_30d, 0),
    'followers', coalesce(v_followers, 0),
    'volumeLamports', coalesce(v_volume, 0),
    'defaultRateBps', case when lower(p_scope) = 'kol' then 20 else 70 end,
    'minimumPayoutLamports', 100000000,
    'processingFeeLamports', 43000000,
    'chart', v_chart,
    'events', v_events,
    'payouts', v_payouts,
    'links', v_links,
    'totalInvites', coalesce(v_total_invites, 0),
    'verifiedInvites', coalesce(v_verified_invites, 0),
    'activeReferredUsers', coalesce(v_active_referrals, 0),
    'referralPendingLamports', coalesce(v_referral_pending, 0),
    'referralAvailableLamports', coalesce(v_referral_available, 0),
    'referralLifetimeLamports', coalesce(v_referral_lifetime, 0),
    'referralActivity', v_referral_activity,
    'customSlugEligible', v_custom_slug_eligible,
    'slugChangedAt', v_slug_changed_at,
    'slugCooldownUntil', case
      when v_slug_changed_at is not null then v_slug_changed_at + interval '30 days'
    end,
    'referralRewardPolicyEnabled', coalesce(v_reward_policy_enabled, false)
  );
end;
$$;

create or replace function public.admin_list_referrals_v2(
  p_secret text,
  p_actor_privy_user_id text,
  p_query text default null,
  p_limit integer default 100
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

  select coalesce(jsonb_agg(to_jsonb(x) order by x.attributed_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      a.id,
      a.referrer_privy_user_id as "referrerPrivyUserId",
      a.referred_privy_user_id as "referredPrivyUserId",
      a.status,
      a.status_reason as "statusReason",
      a.first_qualifying_at as "firstQualifyingAt",
      a.attributed_at,
      l.code,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id,
          'type', f.flag_type,
          'severity', f.severity,
          'status', f.status,
          'reason', f.reason,
          'createdAt', f.created_at
        ) order by f.created_at desc)
        from app_private.referral_abuse_flags f
        where f.attribution_id = a.id
      ), '[]'::jsonb) as flags,
      coalesce((
        select sum(r.amount_lamports)
        from app_private.referral_rewards r
        where r.attribution_id = a.id
          and r.status in ('pending', 'available', 'paid')
      ), 0)::bigint as "rewardLamports"
    from app_private.referral_attributions a
    join app_private.referral_links l on l.id = a.referral_link_id
    where nullif(trim(coalesce(p_query, '')), '') is null
      or a.referrer_privy_user_id ilike '%' || trim(p_query) || '%'
      or a.referred_privy_user_id ilike '%' || trim(p_query) || '%'
      or l.code ilike '%' || trim(p_query) || '%'
    order by a.attributed_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 250))
  ) x;

  return jsonb_build_object('ok', true, 'attributions', v_rows);
end;
$$;

alter table app_private.referral_aliases enable row level security;
alter table app_private.referral_attributions enable row level security;
alter table app_private.referral_abuse_flags enable row level security;
alter table app_private.referral_slug_changes enable row level security;
alter table app_private.referral_reward_policy enable row level security;
alter table app_private.referral_rewards enable row level security;
alter table app_private.referral_reward_status_history enable row level security;

revoke all on table app_private.referral_aliases from public, anon, authenticated;
revoke all on table app_private.referral_attributions from public, anon, authenticated;
revoke all on table app_private.referral_abuse_flags from public, anon, authenticated;
revoke all on table app_private.referral_slug_changes from public, anon, authenticated;
revoke all on table app_private.referral_reward_policy from public, anon, authenticated;
revoke all on table app_private.referral_rewards from public, anon, authenticated;
revoke all on table app_private.referral_reward_status_history from public, anon, authenticated;

revoke execute on function app_private.sync_referral_alias() from public, anon, authenticated;
revoke execute on function app_private.protect_referral_attribution() from public, anon, authenticated;
revoke execute on function app_private.protect_referral_reward_amount() from public, anon, authenticated;
revoke execute on function app_private.record_referral_reward_status() from public, anon, authenticated;
revoke execute on function app_private.referral_slug_error(text) from public, anon, authenticated;
revoke execute on function app_private.referral_custom_slug_eligible(text) from public, anon, authenticated;
revoke execute on function app_private.accrue_referral_reward_for_execution() from public, anon, authenticated;

revoke execute on function public.app_public_resolve_referral(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.app_public_resolve_referral(text, text, text, text)
  to service_role;

revoke execute on function public.app_user_complete_referral_attribution(
  text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.app_user_complete_referral_attribution(
  text, text, text, text, text, timestamptz
) to service_role;

revoke execute on function public.app_user_check_referral_slug(text, text, text)
  from public, anon, authenticated;
grant execute on function public.app_user_check_referral_slug(text, text, text)
  to service_role;

revoke execute on function public.app_user_change_referral_slug(text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.app_user_change_referral_slug(text, text, text, boolean)
  to service_role;

revoke execute on function public.app_user_affiliate_summary(text, text, text)
  from public, anon, authenticated;
grant execute on function public.app_user_affiliate_summary(text, text, text)
  to service_role;

revoke execute on function public.admin_list_referrals_v2(text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_referrals_v2(text, text, text, integer)
  to service_role;
