import { AIChatResponse } from './types';

type WorkoutAdjusterInput = {
  dayOfWeek: number;
  todayExercises: Array<{
    exercise_id: string | null;
    name?: string | null;
    sets?: number | null;
    reps?: string | null;
    rest_seconds?: number | null;
    weight_kg?: number | null;
  }>;
};

export const workoutAdjusterService = async (input: WorkoutAdjusterInput): Promise<AIChatResponse> => {
  const simplified = input.todayExercises.slice(0, 4).map((item) => ({
    exercise_id: item.exercise_id,
    name: item.name || undefined,
    sets: Math.max(1, Math.min(4, Number(item.sets || 2) - 1)),
    reps: item.reps || '8-10',
    rest_seconds: Math.max(60, Number(item.rest_seconds || 60) + 30),
    weight_kg: Math.max(0, Number(item.weight_kg || 0) * 0.85),
    note: 'Giảm tải cho ngày hồi phục'
  }));

  return {
    reply: 'Mình đề xuất buổi nhẹ hơn cho hôm nay: giảm khối lượng, tăng thời gian nghỉ để vẫn giữ nhịp tập.',
    intent: 'adjust_workout',
    confidence: 0.87,
    actionRequired: true,
    actionType: 'replace_today_workout',
    actionPayload: {
      day_of_week: input.dayOfWeek,
      duration_minutes: 10,
      exercises: simplified
    }
  };
};
