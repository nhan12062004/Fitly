import { AIChatResponse } from './types';
import {
  PersonalizationContext,
  sanitizeWorkoutActionExercises,
} from './personalizationGuardService';

type WorkoutAdjusterInput = {
  dayOfWeek: number;
  todayExercises: Array<{
    exercise_id: string | null;
    name?: string | null;
    sets?: number | null;
    reps?: string | null;
    rest_seconds?: number | null;
    weight_kg?: number | null;
    body_part?: string | null;
    target_muscle?: string | null;
  }>;
  safetyContext?: PersonalizationContext;
};

export const workoutAdjusterService = async (input: WorkoutAdjusterInput): Promise<AIChatResponse> => {
  if (input.todayExercises.length === 0) {
    return {
      reply: 'Minh chua thay bai tap nao trong ngay nay de doi tu dong. Hay tao lai lich hoac chon ngay co bai tap truoc.',
      intent: 'adjust_workout',
      responseMode: 'plan_edit',
      confidence: 0.72,
      actionRequired: false,
      actionType: null,
      actionPayload: null
    };
  }

  const guarded = sanitizeWorkoutActionExercises(input.todayExercises, input.safetyContext || {});

  if (guarded.exercises.length === 0) {
    return {
      reply: 'Minh khong tu dong doi buoi nay vi ho so suc khoe/chan thuong hien tai khong phu hop voi cac bai dang co. Hay tam dung cac bai gay dau/tac dong manh va tao lai lich de AI chon bai an toan hon.',
      intent: 'adjust_workout',
      responseMode: 'safety',
      confidence: 0.9,
      actionRequired: false,
      actionType: null,
      actionPayload: null
    };
  }

  const simplified = guarded.exercises.slice(0, 4).map((item) => ({
    exercise_id: item.exercise_id,
    name: item.name || undefined,
    sets: Math.max(1, Math.min(4, Number(item.sets || 2) - 1)),
    reps: item.reps || '8-10',
    rest_seconds: Math.max(60, Number(item.rest_seconds || 60) + 30),
    weight_kg: Math.max(0, Number(item.weight_kg || 0) * 0.85),
    target_rpe: 6,
    note: 'Giam tai theo ho so suc khoe va ngay hoi phuc'
  }));

  return {
    reply: guarded.removedCount > 0
      ? 'Minh da loai cac bai co the xung dot voi ho so suc khoe/chan thuong, roi de xuat phien ban nhe hon cho cac bai con lai.'
      : 'Minh de xuat buoi nhe hon cho hom nay: giam khoi luong, tang thoi gian nghi de van giu nhip tap.',
    intent: 'adjust_workout',
    responseMode: 'plan_edit',
    confidence: 0.87,
    actionRequired: simplified.length > 0,
    actionType: simplified.length > 0 ? 'replace_today_workout' : null,
    actionPayload: simplified.length > 0
      ? {
          day_of_week: input.dayOfWeek,
          duration_minutes: 10,
          exercises: simplified
        }
      : null
  };
};
