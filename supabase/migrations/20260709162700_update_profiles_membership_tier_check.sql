alter table public.profiles
  drop constraint if exists profiles_membership_tier_check;

update public.profiles
set membership_tier = 'pro',
    updated_at = timezone('utc'::text, now())
where lower(coalesce(membership_tier, '')) = 'premium';

alter table public.profiles
  add constraint profiles_membership_tier_check
  check (membership_tier in ('free', 'plus', 'pro'));
