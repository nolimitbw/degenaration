-- Cover referral foreign keys used by admin review, attribution lookup, and
-- reward reconciliation.

create index if not exists referral_abuse_flags_attribution_idx
  on app_private.referral_abuse_flags (attribution_id);
create index if not exists referral_abuse_flags_referrer_idx
  on app_private.referral_abuse_flags (referrer_privy_user_id);
create index if not exists referral_abuse_flags_referred_idx
  on app_private.referral_abuse_flags (referred_privy_user_id);

create index if not exists referral_attributions_link_idx
  on app_private.referral_attributions (referral_link_id);

create index if not exists referral_rewards_attribution_idx
  on app_private.referral_rewards (attribution_id);
create index if not exists referral_rewards_referred_idx
  on app_private.referral_rewards (referred_privy_user_id);

create index if not exists referral_slug_changes_owner_idx
  on app_private.referral_slug_changes (owner_privy_user_id);
create index if not exists referral_slug_changes_link_idx
  on app_private.referral_slug_changes (referral_link_id);
