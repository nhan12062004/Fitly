-- Add purchase tracking flags to profiles table for first-time 30% discount logic
alter table public.profiles
  add column if not exists has_purchased_plus boolean not null default false,
  add column if not exists has_purchased_pro boolean not null default false;

-- For any users currently on 'plus', mark has_purchased_plus as true
update public.profiles
set has_purchased_plus = true
where lower(coalesce(membership_tier, '')) = 'plus';

-- For any users currently on 'pro', mark both has_purchased_plus and has_purchased_pro as true
update public.profiles
set has_purchased_plus = true,
    has_purchased_pro = true
where lower(coalesce(membership_tier, '')) = 'pro';
