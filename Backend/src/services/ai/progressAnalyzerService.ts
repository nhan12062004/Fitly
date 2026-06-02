import { AIChatResponse } from './types';

type ProgressAnalyzerInput = {
  completedWorkouts: number;
  targetWorkouts: number;
  completedMeals?: number;
  targetMeals?: number;
};

export const progressAnalyzerService = async (input: ProgressAnalyzerInput): Promise<AIChatResponse> => {
  const workoutAdherence = input.targetWorkouts > 0
    ? Math.round((input.completedWorkouts / input.targetWorkouts) * 100)
    : 0;
  const mealAdherence = input.targetMeals && input.targetMeals > 0
    ? Math.round(((input.completedMeals || 0) / input.targetMeals) * 100)
    : null;

  const nutritionText = mealAdherence === null
    ? 'Du lieu dinh duong chua day du.'
    : `Muc do bam sat thuc don khoang ${mealAdherence}%.`;

  return {
    reply: `Tien do tap luyen tuan nay: ${workoutAdherence}% muc tieu. ${nutritionText} Neu thay qua tai, minh co the de xuat tuan tiep theo nhe hon de duy tri nhip.`,
    intent: 'analyze_progress',
    confidence: 0.82,
    actionRequired: false,
    actionType: null,
    actionPayload: null
  };
};
