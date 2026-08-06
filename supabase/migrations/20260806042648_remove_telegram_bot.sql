
-- Telegram Bot is retired. Preserve meal history while removing external IDs
-- and normalizing historical source values to Fitly-native labels.
UPDATE public.daily_meal_logs
SET source = CASE source
  WHEN 'telegram_photo_ai' THEN 'ai_photo'
  WHEN 'telegram_voice_ai' THEN 'ai_voice'
  ELSE source
END
WHERE source IN ('telegram_photo_ai', 'telegram_voice_ai');

UPDATE public.user_custom_foods
SET source = CASE source
  WHEN 'telegram_photo_ai' THEN 'ai_photo'
  WHEN 'telegram_voice_ai' THEN 'ai_voice'
  ELSE source
END
WHERE source IN ('telegram_photo_ai', 'telegram_voice_ai');

ALTER TABLE public.user_custom_foods
  ALTER COLUMN source SET DEFAULT 'manual';

DROP TABLE IF EXISTS public.telegram_reminder_dispatches;

ALTER TABLE public.daily_meal_logs
  DROP COLUMN IF EXISTS telegram_file_id;

ALTER TABLE public.user_custom_foods
  DROP COLUMN IF EXISTS telegram_file_id;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS telegram_chat_id,
  DROP COLUMN IF EXISTS telegram_notify_water,
  DROP COLUMN IF EXISTS telegram_notify_sleep,
  DROP COLUMN IF EXISTS telegram_notify_workout;
