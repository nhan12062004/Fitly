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
      reply: `Minh se tao lich tap tuan moi voi khoang ${input.weeklyWorkouts} buoi, uu tien muc tieu ${goal}.`,
      intent,
      confidence: 0.78,
      actionRequired: true,
      actionType: 'create_weekly_workout_plan',
      actionPayload: {
        summary: 'Generate a new weekly workout plan from latest profile and constraints.',
        details: {
          weekly_workouts: input.weeklyWorkouts,
          fitness_goal: goal
        }
      }
    };
  }

  return {
    reply: `Minh se tao thuc don tuan moi voi ${input.mealsPerDay} bua/ngay, bam sat muc tieu ${goal}.`,
    intent,
    confidence: 0.78,
    actionRequired: true,
    actionType: 'create_weekly_meal_plan',
    actionPayload: {
      summary: 'Generate a new weekly meal plan from latest profile and nutrition targets.',
      details: {
        meals_per_day: input.mealsPerDay,
        fitness_goal: goal
      }
    }
  };
};
