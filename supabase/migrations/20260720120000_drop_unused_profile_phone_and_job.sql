-- Phone and job are no longer collected or used by Fitly profiles.

begin;

alter table public.profiles
  drop column if exists phone,
  drop column if exists job;

commit;
