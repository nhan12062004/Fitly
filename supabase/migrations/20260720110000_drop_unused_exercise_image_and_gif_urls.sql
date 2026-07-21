-- Exercise media is standardized on video_url. The legacy image_url and
-- gif_url fields are unused and intentionally removed from the catalog.

begin;

alter table public.exercises
  drop column if exists image_url,
  drop column if exists gif_url;

commit;
