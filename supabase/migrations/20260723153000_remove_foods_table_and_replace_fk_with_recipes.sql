-- Migration: Remove legacy foods table and replace foreign keys with references to public.recipes

-- 1. Remove food_id column from recipe_ingredients
ALTER TABLE IF EXISTS public.recipe_ingredients DROP COLUMN IF EXISTS food_id CASCADE;

-- 2. Update weekly_food_items: Ensure recipe_id exists as TEXT and drop legacy food_id
ALTER TABLE IF EXISTS public.weekly_food_items ADD COLUMN IF NOT EXISTS recipe_id TEXT REFERENCES public.recipes(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS public.weekly_food_items DROP COLUMN IF EXISTS food_id CASCADE;

-- 3. Update daily_meal_logs: Ensure recipe_id exists as TEXT and drop legacy food_id
ALTER TABLE IF EXISTS public.daily_meal_logs ADD COLUMN IF NOT EXISTS recipe_id TEXT REFERENCES public.recipes(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.daily_meal_logs DROP COLUMN IF EXISTS food_id CASCADE;

-- 4. Drop the legacy foods table completely
DROP TABLE IF EXISTS public.foods CASCADE;
