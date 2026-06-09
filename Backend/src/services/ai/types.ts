export type AIIntent =
  | 'workout_plan'
  | 'meal_plan'
  | 'recovery'
  | 'injury_care'
  | 'motivation'
  | 'general_health'
  | 'out_of_scope'
  | 'view_day_plan'
  | 'create_workout_plan'
  | 'create_meal_plan'
  | 'adjust_workout'
  | 'adjust_meal'
  | 'analyze_progress';

export type AIResponseMode =
  | 'plan_edit'
  | 'coach_advice'
  | 'support'
  | 'safety'
  | 'redirect';

export type AIActionType =
  | 'replace_today_workout'
  | 'replace_today_meal'
  | 'create_weekly_workout_plan'
  | 'create_weekly_meal_plan';

export type WorkoutExercisePayload = {
  exercise_id?: string | null;
  name?: string;
  sets?: number;
  reps?: string;
  rest_seconds?: number;
  weight_kg?: number;
  note?: string;
};

export type AIActionPayload =
  | {
      day_of_week: number;
      duration_minutes: number;
      exercises: WorkoutExercisePayload[];
    }
  | {
      day_of_week: number;
      old_weekly_food_item_id: string;
      old_food_id: string;
      old_food_name: string;
      new_food_id: string;
      new_food_name: string;
      meal_type: string;
      quantity: number;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      notes?: string;
    }
  | {
      summary: string;
      details?: Record<string, unknown>;
    };

export type AIChatResponse = {
  reply: string;
  intent: AIIntent;
  responseMode: AIResponseMode;
  confidence: number;
  actionRequired: boolean;
  actionType: AIActionType | null;
  actionPayload: AIActionPayload | null;
  adjustmentId?: string;
};

export type AIChatExerciseSummary = {
  exercise_id?: string | null;
  name?: string | null;
  sets?: number | null;
  reps?: string | null;
  rest_seconds?: number | null;
  weight_kg?: number | null;
  body_part?: string | null;
  target_muscle?: string | null;
};

export type AIChatMealSummary = {
  id?: string | null;
  meal_type?: string | null;
  food_id?: string | null;
  name?: string | null;
  quantity?: number | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
};

export type AIChatContext = {
  todayWorkoutCount?: number;
  todayMealCount?: number;
  todayDayIndex?: number;
  targetDayIndex?: number;
  targetDayLabel?: string;
  exercises?: AIChatExerciseSummary[];
  meals?: AIChatMealSummary[];
  profile?: Record<string, unknown> | null;
  bodyMetrics?: Record<string, unknown> | null;
  lifestyle?: Record<string, unknown> | null;
  health?: Record<string, unknown> | null;
  chatHistory?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
};
