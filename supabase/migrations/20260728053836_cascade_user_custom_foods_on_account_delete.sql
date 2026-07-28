create index if not exists user_custom_foods_user_id_idx
  on public.user_custom_foods (user_id);

alter table public.user_custom_foods
  add constraint user_custom_foods_user_id_fkey
  foreign key (user_id)
  references public.profiles (id)
  on delete cascade;
