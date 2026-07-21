-- Keep the legacy image_url/gif_url columns temporarily so existing catalog
-- seeds remain runnable while video URLs are populated. Remove them in a
-- separate migration only after all clients use video_url.
alter table public.exercises
  add column if not exists video_url text;

comment on column public.exercises.video_url is
  'Public direct URL to a browser-playable exercise video (prefer MP4 H.264/AAC).';
