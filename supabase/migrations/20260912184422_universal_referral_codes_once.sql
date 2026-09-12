-- Every active user receives a profile referral link and may choose its public slug once.
-- Monetary rewards are 10% of the platform fee collected from qualifying confirmed trades.

create or replace function app_private.referral_custom_slug_eligible(p_privy_user_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.affiliate_profiles p
    join app_private.app_users u on u.privy_user_id = p.privy_user_id
    where p.privy_user_id = p_privy_user_id
      and p.status = 'active'
      and u.status = 'active'
      and p.slug_changed_at is null
  );
$$;

update app_private.referral_reward_policy
set enabled = true,
    rate_bps = 1000,
    updated_at = now(),
    reason = 'Ten percent of collected platform trading fees is allocated to the eligible referrer'
where singleton = true;

revoke execute on function app_private.referral_custom_slug_eligible(text)
from public, anon, authenticated;
