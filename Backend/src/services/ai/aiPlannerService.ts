import { AIChatResponse, AIIntent } from './types';

type PlannerInput = {
  weeklyWorkouts: number;
  mealsPerDay: number;
  fitnessGoal?: string;
};

export const aiPlannerService = async (intent: AIIntent, input: PlannerInput): Promise<AIChatResponse> => {
  const goal = input.fitnessGoal || 'general_fitness';

  if (intent === 'create_workout_plan') {
    return {
      reply: `Bạn có thể dùng nút Tạo kế hoạch trong AI Coach để tạo lịch tập tuần mới khoảng ${input.weeklyWorkouts} buổi, theo mục tiêu ${goal}.`,
      intent,
      responseMode: 'coach_advice',
      confidence: 0.78,
      actionRequired: false,
      actionType: null,
      actionPayload: null
    };
  }

  return {
    reply: `Bạn có thể mở Thực đơn và chọn Tạo thực đơn AI để tạo món cho ngày hoặc cả tuần, với ${input.mealsPerDay} bữa/ngày theo mục tiêu ${goal}.`,
    intent,
    responseMode: 'coach_advice',
    confidence: 0.78,
    actionRequired: false,
    actionType: null,
    actionPayload: null
  };
};
