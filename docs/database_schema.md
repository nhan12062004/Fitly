-- AUTO-GENERATED from Supabase on 2026-07-07T08:19:37.823Z
-- Source RPC: export_public_tables_structure
-- Note: schema only. Data snapshots are intentionally excluded to avoid leaking sensitive records.

-- 1. Table: ai_chat_messages
CREATE TABLE public.ai_chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role text,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  intent text,
  action_type text,
  action_payload jsonb,
  confidence numeric
);
-- 2. Table: ai_plan_adjustments
CREATE TABLE public.ai_plan_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  old_plan_id uuid,
  new_plan_id uuid,
  reason text,
  created_at timestamp with time zone DEFAULT now(),
  plan_type text,
  source_type text,
  source_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_by text DEFAULT 'ai'::text,
  status text DEFAULT 'proposed'::text,
  applied_at timestamp with time zone,
  rejected_at timestamp with time zone,
  chat_message_id uuid,
  apply_idempotency_key text
);
-- 3. Table: body_metrics
CREATE TABLE public.body_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  weight numeric(5,2),
  height numeric(5,2),
  body_fat_percentage numeric(4,2),
  created_at timestamp with time zone DEFAULT now(),
  target_weight double precision,
  body_fat double precision,
  chest double precision,
  waist double precision,
  hips double precision,
  neck numeric(5,1) DEFAULT NULL::numeric
);
-- 4. Table: challenge_checkins
CREATE TABLE public.challenge_checkins (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id uuid NOT NULL,
  user_id uuid NOT NULL,
  checkin_date date NOT NULL DEFAULT CURRENT_DATE,
  source_type text NOT NULL,
  source_id uuid,
  score integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
-- 5. Table: challenge_participants
CREATE TABLE public.challenge_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text,
  joined_at timestamp with time zone NOT NULL DEFAULT now()
);
-- 6. Table: challenges
CREATE TABLE public.challenges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by uuid NOT NULL,
  title text NOT NULL,
  description text,
  mode text NOT NULL DEFAULT 'solo'::text,
  challenge_type text NOT NULL DEFAULT 'daily_checkin'::text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  invite_code text,
  max_members integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
-- 7. Table: daily_exercise_sessions
CREATE TABLE public.daily_exercise_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  log_date date DEFAULT CURRENT_DATE,
  exercise_id text,
  sets integer DEFAULT 3,
  reps text DEFAULT '10-12'::text,
  weight_kg numeric DEFAULT 0,
  rest_seconds integer DEFAULT 60,
  order_index integer,
  is_completed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  weekly_plan_exercise_id uuid,
  planned_sets integer,
  planned_reps text,
  planned_weight_kg numeric,
  planned_rest_seconds integer,
  actual_sets integer,
  actual_reps text,
  actual_weight_kg numeric,
  actual_rest_seconds integer,
  target_rpe numeric(3,1),
  estimated_kcal integer DEFAULT 0,
  actual_kcal_estimated integer DEFAULT 0,
  completed_sets integer DEFAULT 0,
  load_adjustment_note text
);
-- 8. Table: daily_exercise_set_logs
CREATE TABLE public.daily_exercise_set_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_exercise_session_id uuid NOT NULL,
  workout_session_exercise_id uuid,
  set_number integer NOT NULL,
  planned_reps text,
  target_weight_kg numeric,
  actual_reps integer,
  actual_weight_kg numeric,
  rest_seconds integer,
  rpe numeric(3,1),
  estimated_kcal integer DEFAULT 0,
  notes text,
  is_completed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
-- 9. Table: daily_meal_logs
CREATE TABLE public.daily_meal_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  weekly_food_item_id uuid,
  food_id uuid,
  log_date date DEFAULT CURRENT_DATE,
  meal_type text,
  quantity numeric DEFAULT 1,
  calories numeric DEFAULT 0,
  protein numeric DEFAULT 0,
  carbs numeric DEFAULT 0,
  fat numeric DEFAULT 0,
  is_completed boolean DEFAULT false,
  eaten_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  custom_food_id uuid,
  custom_food_name text,
  source text,
  confidence text,
  image_url text,
  telegram_file_id text,
  notes text,
  ai_estimate jsonb
);
-- 10. Table: daily_progress_logs
CREATE TABLE public.daily_progress_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  log_date date DEFAULT CURRENT_DATE,
  calories_burned integer DEFAULT 0,
  calories_consumed integer DEFAULT 0,
  workout_duration integer DEFAULT 0,
  water_intake_ml integer DEFAULT 0,
  sleep_hours double precision DEFAULT 0
);
-- 11. Table: daily_workout_session_exercises
CREATE TABLE public.daily_workout_session_exercises (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid,
  exercise_id text,
  sets integer DEFAULT 3,
  reps text DEFAULT '10-12'::text,
  weight_kg numeric DEFAULT 0,
  rest_seconds integer DEFAULT 60,
  order_index integer NOT NULL,
  is_completed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  daily_exercise_session_id uuid,
  weekly_plan_exercise_id uuid,
  planned_sets integer,
  planned_reps text,
  planned_weight_kg numeric,
  planned_rest_seconds integer,
  actual_sets integer,
  actual_reps text,
  actual_weight_kg numeric,
  actual_rest_seconds integer,
  target_rpe numeric(3,1),
  estimated_kcal integer DEFAULT 0,
  actual_kcal_estimated integer DEFAULT 0,
  completed_sets integer DEFAULT 0
);
-- 12. Table: daily_workout_sessions
CREATE TABLE public.daily_workout_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  weekly_plan_id uuid,
  log_date date DEFAULT CURRENT_DATE,
  title text,
  duration_minutes integer DEFAULT 0,
  calories_burned integer DEFAULT 0,
  status text DEFAULT 'planned'::text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);
-- 13. Table: exercises
CREATE TABLE public.exercises (
  id text NOT NULL PRIMARY KEY,
  name text NOT NULL,
  body_part text,
  equipment text,
  target_muscle text,
  gif_url text,
  instructions jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  secondary_muscles jsonb DEFAULT '[]'::jsonb,
  image_url text,
  difficulty text,
  goal_type text[],
  contraindications text[],
  estimated_duration_seconds integer,
  calories_per_minute numeric,
  movement_pattern text
);
-- 14. Table: foods
CREATE TABLE public.foods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  category text,
  calories numeric DEFAULT 0,
  protein numeric DEFAULT 0,
  carbs numeric DEFAULT 0,
  fat numeric DEFAULT 0,
  serving_unit text DEFAULT '100g'::text,
  image_url text,
  created_at timestamp with time zone DEFAULT now(),
  meal_type text[],
  goal_type text[],
  allergens text[],
  price_level text,
  cooking_time_minutes integer,
  region text DEFAULT 'Vietnam'::text,
  is_easy_to_prepare boolean DEFAULT true
);
-- 15. Table: health_conditions
CREATE TABLE public.health_conditions (
  user_id uuid NOT NULL PRIMARY KEY,
  medical_history text,
  sleep_hours numeric(4,2),
  health_condition text,
  injuries text,
  medications text,
  smoke_drink text,
  stress_level text,
  sleep_quality text,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);
-- 16. Table: lifestyle_settings
CREATE TABLE public.lifestyle_settings (
  user_id uuid NOT NULL PRIMARY KEY,
  fitness_goal character varying(50),
  activity_level character varying(50),
  workout_duration integer,
  weekly_workouts integer,
  daily_water_goal numeric(3,1),
  diet_preference text,
  cooking_ability text,
  budget_level text,
  current_diet text,
  workout_location text,
  workout_time text,
  equipment_available text,
  experience_level text,
  motivation text,
  expectations text,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  target_calories integer DEFAULT 0,
  calories_burn_goal numeric DEFAULT 500,
  meals_per_day integer DEFAULT 3
);
-- 17. Table: meal_feedback
CREATE TABLE public.meal_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  weekly_food_item_id uuid,
  feedback_type text,
  comment text,
  created_at timestamp with time zone DEFAULT now()
);
-- 18. Table: profiles
CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY,
  full_name text,
  email text,
  phone text,
  gender text,
  birthday date,
  job text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  role text DEFAULT 'user'::text,
  telegram_chat_id text,
  membership_tier text NOT NULL DEFAULT 'free'::text,
  ai_coach_free_used_at timestamp with time zone
);
-- 19. Table: telegram_reminder_dispatches
CREATE TABLE public.telegram_reminder_dispatches (
  reminder_key text NOT NULL PRIMARY KEY,
  reminder_type text NOT NULL,
  reminder_date date NOT NULL,
  slot_label text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);
-- 20. Table: user_custom_foods
CREATE TABLE public.user_custom_foods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  serving_description text,
  calories numeric DEFAULT 0,
  protein numeric DEFAULT 0,
  carbs numeric DEFAULT 0,
  fat numeric DEFAULT 0,
  source text DEFAULT 'telegram_photo_ai'::text,
  confidence text DEFAULT 'medium'::text,
  image_url text,
  telegram_file_id text,
  usage_count integer NOT NULL DEFAULT 1,
  last_used_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);
-- 21. Table: user_notifications
CREATE TABLE public.user_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  tone text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  href text NOT NULL DEFAULT '/overview'::text,
  source_type text NOT NULL DEFAULT 'system'::text,
  source_id text,
  dedupe_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamp with time zone
);
-- 22. Table: weekly_food_items
CREATE TABLE public.weekly_food_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  food_plan_id uuid,
  day_of_week integer NOT NULL,
  meal_type text NOT NULL,
  food_id uuid,
  quantity numeric DEFAULT 1,
  calories numeric DEFAULT 0,
  protein numeric DEFAULT 0,
  carbs numeric DEFAULT 0,
  fat numeric DEFAULT 0,
  order_index integer NOT NULL,
  is_rest_day boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);
-- 23. Table: weekly_food_plans
CREATE TABLE public.weekly_food_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  name text DEFAULT 'Diet Plan'::text,
  week_start_date date,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  plan_status text DEFAULT 'active'::text,
  generated_by text DEFAULT 'ai'::text,
  ai_explanation text
);
-- 24. Table: weekly_plan_exercises
CREATE TABLE public.weekly_plan_exercises (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  weekly_plan_id uuid,
  day_of_week integer NOT NULL,
  exercise_id text,
  sets integer DEFAULT 3,
  reps text DEFAULT '10-12'::text,
  weight_kg numeric DEFAULT 0,
  rest_seconds integer DEFAULT 60,
  order_index integer NOT NULL,
  is_rest_day boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  planned_sets integer,
  planned_reps text,
  planned_weight_kg numeric,
  planned_rest_seconds integer,
  target_rpe numeric(3,1),
  estimated_kcal integer DEFAULT 0,
  ai_note text,
  load_instruction text
);
-- 25. Table: weekly_plans
CREATE TABLE public.weekly_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  name text DEFAULT 'Workout Creator'::text,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  week_start_date date NOT NULL DEFAULT (((date_trunc('week'::text, (CURRENT_DATE + '1 day'::interval)))::date - '1 day'::interval))::date,
  plan_status text DEFAULT 'active'::text,
  generated_by text DEFAULT 'ai'::text,
  ai_explanation text
);
-- 26. Table: workout_session_feedback
CREATE TABLE public.workout_session_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  session_id uuid,
  difficulty text,
  completed_all boolean DEFAULT true,
  pain_area text,
  energy_level integer,
  comment text,
  created_at timestamp with time zone DEFAULT now(),
  workout_session_id uuid
);
