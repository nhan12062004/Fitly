-- Create the profile synchronously when Supabase Auth creates a user.
-- Keep this trigger minimal and schema-qualified: an error here aborts signup.
create or replace function public.trg_set_ref_code()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  candidate text;
begin
  if coalesce(new.ref_code, '') <> '' then
    return new;
  end if;

  for attempt in 1..20 loop
    candidate := public.generate_ref_code();
    if not exists (select 1 from public.profiles where ref_code = candidate) then
      new.ref_code := candidate;
      return new;
    end if;
  end loop;

  raise exception 'Unable to generate a unique referral code';
end;
$function$;

create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  assigned_role text := case
    when lower(new.email) = 'nhanmit120604@gmail.com' then 'admin'
    else 'user'
  end;
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    lower(new.email),
    assigned_role
  )
  on conflict (id) do update
  set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    email = excluded.email,
    role = excluded.role,
    updated_at = timezone('utc', now());

  return new;
end;
$function$;

drop trigger if exists on_auth_user_created_role on auth.users;
create trigger on_auth_user_created_role
  after insert on auth.users
  for each row execute function public.handle_new_user_role();
