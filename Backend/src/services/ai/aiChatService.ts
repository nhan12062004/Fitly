import { normalizeVietnameseText } from './aiRouterService';
import { AIChatContext, AIChatMealSummary, AIChatResponse } from './types';

const getMealTypeLabel = (mealType?: string | null): string => {
  const key = String(mealType || '').toLowerCase();
  if (key === 'breakfast') return 'Bua sang';
  if (key === 'lunch') return 'Bua trua';
  if (key === 'dinner') return 'Bua toi';
  if (key === 'snack') return 'Bua phu';
  return 'Bua an';
};

const formatMealCalories = (meal: AIChatMealSummary): number => {
  const quantity = Number(meal.quantity || 1);
  return Math.round(Number(meal.calories || 0) * quantity);
};

export const aiChatService = async (message: string, context?: AIChatContext): Promise<AIChatResponse> => {
  const normalized = normalizeVietnameseText(message);
  const dayLabel = context?.targetDayLabel || 'Hom nay';
  const todayWorkoutCount = Number(context?.todayWorkoutCount || 0);
  const todayMealCount = Number(context?.todayMealCount || 0);
  const exercises = Array.isArray(context?.exercises) ? context.exercises : [];
  const meals = Array.isArray(context?.meals) ? context.meals : [];

  const wantsWorkout =
    normalized.includes('bai tap') ||
    normalized.includes('tap gi') ||
    normalized.includes('workout') ||
    normalized.includes('lich tap');
  const wantsMeal =
    normalized.includes('thuc don') ||
    normalized.includes('mon an') ||
    normalized.includes('bua an') ||
    normalized.includes('an gi') ||
    normalized.includes('toi nay an') ||
    normalized.includes('trua nay an') ||
    normalized.includes('sang nay an') ||
    normalized.includes('goi y mon') ||
    normalized.includes('meal');
  const wantsPlanDetails =
    normalized.includes('xem lich') ||
    normalized.includes('lich hom nay') ||
    normalized.includes('hom nay co') ||
    normalized.includes('co nhung') ||
    normalized.includes('gom nhung') ||
    normalized.includes('bao nhieu bai') ||
    normalized.includes('bao nhieu mon') ||
    normalized.includes('xem bai tap') ||
    normalized.includes('xem thuc don');

  if (wantsPlanDetails) {
    const sections: string[] = [];

    if (!wantsMeal || wantsWorkout) {
      if (exercises.length > 0) {
        const exerciseLines = exercises
          .slice(0, 5)
          .map((exercise, index) => {
            const parts = [
              `${index + 1}. ${exercise.name || 'Bai tap'}`,
              `${Number(exercise.sets || 3)} sets x ${exercise.reps || '8-12'}`,
            ];
            if (Number(exercise.rest_seconds || 0) > 0) {
              parts.push(`nghi ${Number(exercise.rest_seconds)}s`);
            }
            return parts.join(' - ');
          })
          .join('\n');
        sections.push(`${dayLabel} co ${exercises.length} bai tap:\n${exerciseLines}`);
      } else {
        sections.push(`${dayLabel} hien chua co bai tap nao trong lich.`);
      }
    }

    if (!wantsWorkout || wantsMeal) {
      if (meals.length > 0) {
        const mealLines = meals
          .slice(0, 5)
          .map((meal, index) => {
            const calories = formatMealCalories(meal);
            const quantity = Number(meal.quantity || 1);
            return `${index + 1}. ${getMealTypeLabel(meal.meal_type)} - ${meal.name || 'Mon an'} x${quantity} (${calories} kcal)`;
          })
          .join('\n');
        sections.push(`${dayLabel} co ${meals.length} mon an:\n${mealLines}`);
      } else {
        sections.push(`${dayLabel} hien chua co mon an nao trong thuc don.`);
      }
    }

    return {
      reply: sections.join('\n\n'),
      intent: 'view_day_plan',
      confidence: 0.9,
      actionRequired: false,
      actionType: null,
      actionPayload: null,
    };
  }

  if (wantsMeal) {
    if (meals.length > 0) {
      const mealLines = meals
        .slice(0, 4)
        .map((meal, index) => {
          const calories = formatMealCalories(meal);
          const quantity = Number(meal.quantity || 1);
          return `${index + 1}. ${getMealTypeLabel(meal.meal_type)} - ${meal.name || 'Mon an'} x${quantity} (${calories} kcal)`;
        })
        .join('\n');

      return {
        reply: `${dayLabel} dang co ${meals.length} mon an. Ban co the uu tien cac lua chon nay:\n${mealLines}`,
        intent: 'view_day_plan',
        confidence: 0.88,
        actionRequired: false,
        actionType: null,
        actionPayload: null,
      };
    }

    const dinnerHint = normalized.includes('toi nay') || normalized.includes('bua toi');
    const lunchHint = normalized.includes('trua nay') || normalized.includes('bua trua');
    const mealLabel = dinnerHint ? 'bua toi' : lunchHint ? 'bua trua' : 'bua an';

    return {
      reply: `${dayLabel} hien chua co mon nao trong meal plan. Neu ban can mot goi y nhanh cho ${mealLabel}, hay uu tien 1 nguon dam nac nhu uc ga/ca/trung, them rau, va 1 phan tinh bot vua phai nhu com, khoai hoac yen mach.`,
      intent: 'advice',
      confidence: 0.82,
      actionRequired: false,
      actionType: null,
      actionPayload: null,
    };
  }

  const reply =
    todayWorkoutCount + todayMealCount > 0
      ? `${dayLabel} hien co ${todayWorkoutCount} bai tap va ${todayMealCount} mon an. Neu ban muon, minh co the lam buoi tap nhe hon, doi mon gon hon, hoac toi uu theo muc tieu tang co/giam mo.`
      : `${dayLabel} chua co du lich de toi uu. Ban co the yeu cau tao lai lich, doi mon, hoac noi ro tinh trang nhu "hom nay met" hay "chi co 10 phut".`;

  return {
    reply,
    intent: 'advice',
    confidence: 0.66,
    actionRequired: false,
    actionType: null,
    actionPayload: null,
  };
};
