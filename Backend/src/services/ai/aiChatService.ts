import { askFitlyCoach } from './coachConversationService';
import { getResponseModeForIntent, normalizeVietnameseText } from './aiRouterService';
import { AIChatContext, AIChatMealSummary, AIChatResponse, AIIntent } from './types';

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

const hasAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));

const isGreetingMessage = (message: string): boolean => {
  const normalized = normalizeVietnameseText(message);
  if (!normalized) return false;
  const wordCount = normalized.split(' ').filter(Boolean).length;
  return wordCount <= 4 && /^(hi|hello|hey|alo|chao|xin chao|chao coach|hi coach)(\b|$)/.test(normalized);
};

const isShortFollowUpMessage = (message: string): boolean => {
  const normalized = normalizeVietnameseText(message);
  return [
    'con gi nua',
    'con nua khong',
    'co gi nua',
    'gom nhung gi',
    'bai nao',
    'bai nao nua',
    'mon nao',
    'mon nao nua',
    'ke tiep di',
    'noi tiep di',
    'chi tiet hon',
    'cu the hon',
  ].includes(normalized);
};

const getPreviousTopic = (history?: AIChatContext['chatHistory']): 'workout' | 'meal' | null => {
  const rows = Array.isArray(history) ? history : [];
  for (const item of [...rows].reverse()) {
    const normalized = normalizeVietnameseText(item.content);
    if (!normalized) continue;
    if (hasAny(normalized, ['bai tap', 'workout', 'lich tap', 'buoi tap', 'tap gi', 'set x'])) {
      return 'workout';
    }
    if (hasAny(normalized, ['thuc don', 'mon an', 'bua', 'an gi', 'protein', 'meal'])) {
      return 'meal';
    }
  }
  return null;
};

const buildGreetingReply = (context?: AIChatContext): string => {
  const dayLabel = context?.targetDayLabel || 'Hôm nay';
  const workoutCount = Number(context?.todayWorkoutCount || 0);
  const mealCount = Number(context?.todayMealCount || 0);
  const workoutText = workoutCount > 0 ? `${workoutCount} bài tập` : 'chưa có bài tập';
  const mealText = mealCount > 0 ? `${mealCount} món ăn` : 'chưa có thực đơn';
  return `Chào bạn. Mình đang theo ${dayLabel}: ${workoutText} và ${mealText}. Bạn muốn xem danh sách bài tập, chỉnh buổi tập nhẹ hơn, hay hỏi về bữa ăn hôm nay?`;
};

const isDailyCalorieQuestion = (message: string): boolean => {
  const normalized = normalizeVietnameseText(message);
  const mentionsCalories = hasAny(normalized, ['kcal', 'calo', 'calories', 'calorie', 'cal']);
  const asksAmount = hasAny(normalized, ['bao nhieu', 'nen an', 'can an', 'mot ngay', 'hang ngay', 'moi ngay', 'target', 'muc']);
  return mentionsCalories && asksAmount;
};

const readNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
};

const getAgeYears = (profile?: Record<string, unknown> | null) => {
  const birthday = String(
    profile?.birthday ||
      profile?.birth_date ||
      profile?.date_of_birth ||
      '',
  );
  if (!birthday) return 30;
  const birthDate = new Date(birthday);
  if (Number.isNaN(birthDate.getTime())) return 30;
  const now = new Date();
  const age = now.getFullYear() - birthDate.getFullYear();
  return Math.max(15, Math.min(90, age));
};

const getActivityFactor = (lifestyle?: Record<string, unknown> | null) => {
  const weeklyWorkouts = Number(lifestyle?.weekly_workouts || 0);
  const activityText = normalizeVietnameseText(String(lifestyle?.activity_level || lifestyle?.weekly_workouts || ''));

  if (hasAny(activityText, ['it van dong', 'sedentary', 'khong tap'])) return 1.2;
  if (hasAny(activityText, ['nhe', 'light'])) return 1.35;
  if (hasAny(activityText, ['vua', 'moderate', '3 4', '3-4'])) return 1.45;
  if (hasAny(activityText, ['nang', 'active', '5 6', '5-6'])) return 1.6;
  if (hasAny(activityText, ['rat nang', 'very active', 'hang ngay'])) return 1.75;

  if (weeklyWorkouts >= 6) return 1.65;
  if (weeklyWorkouts >= 5) return 1.55;
  if (weeklyWorkouts >= 3) return 1.45;
  if (weeklyWorkouts >= 1) return 1.3;
  return 1.25;
};

const roundToNearest50 = (value: number) => Math.round(value / 50) * 50;

const buildDailyCalorieTargetReply = (context?: AIChatContext): string => {
  const body = context?.bodyMetrics || {};
  const profile = context?.profile || {};
  const lifestyle = context?.lifestyle || {};
  const weight = readNumber((body as any).weight, (profile as any).weight);
  const height = readNumber((body as any).height, (profile as any).height);

  if (!weight || !height) {
    return [
      'Để tính kcal sát hơn, mình cần tối thiểu cân nặng, chiều cao và mức vận động.',
      'Cách tạm tính nhanh: lấy cân nặng x 28-32 kcal để ra mức duy trì, nếu muốn giảm cân thì trừ khoảng 300-500 kcal/ngày. Ví dụ 80kg thường bắt đầu quanh 1.900-2.300 kcal/ngày khi giảm cân.',
    ].join('\n\n');
  }

  const age = getAgeYears(profile);
  const genderText = normalizeVietnameseText(String((profile as any).gender || (body as any).gender || 'male'));
  const genderOffset = genderText.includes('nu') || genderText.includes('female') ? -161 : 5;
  const bmr = 10 * weight + 6.25 * height - 5 * age + genderOffset;
  const maintenance = roundToNearest50(bmr * getActivityFactor(lifestyle));
  const targetWeight = readNumber((body as any).target_weight, (profile as any).target_weight);
  const goalText = normalizeVietnameseText(String((lifestyle as any).fitness_goal || ''));
  const wantsLoss = goalText.includes('giam') || goalText.includes('loss') || (!!targetWeight && targetWeight < weight);
  const wantsGain = goalText.includes('tang co') || goalText.includes('muscle') || goalText.includes('bulk') || (!!targetWeight && targetWeight > weight);

  const minCalories = wantsGain
    ? maintenance + 150
    : wantsLoss
      ? Math.max(Math.round(bmr), maintenance - 500)
      : maintenance - 150;
  const maxCalories = wantsGain
    ? maintenance + 300
    : wantsLoss
      ? Math.max(Math.round(bmr + 150), maintenance - 300)
      : maintenance + 150;

  const proteinMin = Math.round(weight * 1.6);
  const proteinMax = Math.round(weight * 2);
  const fatMin = Math.round(weight * 0.6);
  const fatMax = Math.round(weight * 0.9);
  const goalLabel = wantsGain ? 'tăng cơ' : wantsLoss ? 'giảm cân' : 'giữ cân';

  return [
    `Với dữ liệu hiện tại của bạn (${Math.round(weight)}kg, ${Math.round(height)}cm), mức duy trì ước tính khoảng ${maintenance - 100}-${maintenance + 100} kcal/ngày.`,
    `Nếu mục tiêu là ${goalLabel}, mình sẽ bắt đầu ở khoảng ${roundToNearest50(minCalories)}-${roundToNearest50(maxCalories)} kcal/ngày, rồi theo dõi 10-14 ngày để chỉnh tiếp.`,
    `Macro dễ bám: protein ${proteinMin}-${proteinMax}g/ngày, fat ${fatMin}-${fatMax}g/ngày, phần kcal còn lại để cho carb. Nếu cân không đi đúng hướng sau 2 tuần, tăng/giảm 150-200 kcal là đủ.`,
  ].join('\n\n');
};

const buildPlanOverviewReply = (message: string, context?: AIChatContext): string => {
  const normalized = normalizeVietnameseText(message);
  const dayLabel = context?.targetDayLabel || 'Hom nay';
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
    normalized.includes('mon') ||
    normalized.includes('bua') ||
    normalized.includes('an gi') ||
    normalized.includes('protein') ||
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

  const includeWorkout = wantsPlanDetails || wantsWorkout || (!wantsMeal && exercises.length > 0);
  const includeMeal = wantsPlanDetails || wantsMeal || (!wantsWorkout && meals.length > 0);
  const sections: string[] = [];

  if (includeWorkout) {
    if (exercises.length > 0) {
      const lines = exercises
        .slice(0, 5)
        .map((exercise, index) => {
          const parts = [
            `${index + 1}. ${exercise.name || 'Bai tap'}`,
            `${Number(exercise.sets || 3)} set x ${exercise.reps || '8-12'}`,
          ];
          if (Number(exercise.rest_seconds || 0) > 0) {
            parts.push(`nghi ${Number(exercise.rest_seconds)}s`);
          }
          return parts.join(' - ');
        })
        .join('\n');
      sections.push(`${dayLabel} co ${exercises.length} bai tap:\n${lines}`);
    } else {
      sections.push(`${dayLabel} hien chua co bai tap nao trong lich.`);
    }
  }

  if (includeMeal) {
    if (meals.length > 0) {
      const lines = meals
        .slice(0, 5)
        .map((meal, index) => {
          const calories = formatMealCalories(meal);
          const quantity = Number(meal.quantity || 1);
          return `${index + 1}. ${getMealTypeLabel(meal.meal_type)} - ${meal.name || 'Mon an'} x${quantity} (${calories} kcal)`;
        })
        .join('\n');
      sections.push(`${dayLabel} co ${meals.length} mon an:\n${lines}`);
    } else {
      sections.push(`${dayLabel} hien chua co mon an nao trong thuc don.`);
    }
  }

  if (sections.length === 0) {
    return `${dayLabel} hien chua co du lieu workout hoac meal plan. Ban co the yeu cau tao lai lich hoac noi ro muc tieu hom nay de minh goi y theo tinh huong.`;
  }

  return sections.join('\n\n');
};

const buildInjuryCareReply = (): string =>
  [
    'Neu ban dang dau, sung, te, choang vang, hoac co dau hieu chan thuong ro, hay uu tien an toan truoc va tam dung cac bai tap tac dong manh ngay luc nay.',
    'Cach xu ly muc co ban: nghi ngoi, chuom lanh 15-20 phut moi lan, bang ep nhe neu co sung, ke cao vung bi dau, va tranh cac dong tac gay tang dau.',
    'Neu dau tang, khong chiu luc duoc, sung bam tim ro, te, bien dang khop, choang vang, hoac sau 2-3 ngay khong giam, ban nen di kham co xuong khop hoac y te the thao.',
  ].join('\n\n');

const buildRecoveryReply = (context?: AIChatContext): string => {
  const dayLabel = context?.targetDayLabel || 'Hom nay';
  const exercises = Array.isArray(context?.exercises) ? context.exercises : [];
  const meals = Array.isArray(context?.meals) ? context.meals : [];

  if (exercises.length > 0) {
    const firstExercise = exercises[0];
    const restSeconds = Math.max(75, Number(firstExercise?.rest_seconds || 60));
    return [
      `${dayLabel} neu ban thay met, uu tien giam 1 set moi bai, giu ky thuat sach, va tang thoi gian nghi len khoang ${restSeconds} giay.`,
      'Sau buoi tap, nen bu protein, bu nuoc, di bo nhe 5-10 phut, va ngu du. Neu muon, minh co the rut gon buoi tap hom nay thanh phien ban de phuc hoi hon.',
    ].join('\n\n');
  }

  if (meals.length > 0) {
    return [
      `${dayLabel} ban co the uu tien phuc hoi bang cach giu du protein, them nuoc, rau, va mot nguon tinh bot vua phai quanh buoi tap.`,
      'Neu ban muon, minh co the goi y mot bua gon hon nhung van ho tro phuc hoi tot.',
    ].join('\n\n');
  }

  return [
    `${dayLabel} minh chua thay du workout hoac meal plan cu the, nen uu tien phuc hoi co ban: ngu du, uong nuoc, an du protein, va van dong nhe trong nguong de chiu.`,
    'Neu ban noi ro dang met, dau co, hay muon nhe buoi tap, minh se goi y sat hon.',
  ].join('\n\n');
};

const buildMotivationReply = (context?: AIChatContext): string => {
  const dayLabel = context?.targetDayLabel || 'Hom nay';
  const workoutCount = Number(context?.todayWorkoutCount || 0);
  const mealCount = Number(context?.todayMealCount || 0);

  if (workoutCount > 0) {
    return [
      `Neu ${dayLabel.toLowerCase()} ban dang luoi hoac mat nhip, dung nghi den ca buoi tap. Chi can bat dau bang 10 phut dau tien hoac 1 bai dau tien.`,
      'Hoan thanh diem bat dau do truoc, sau do moi quyet dinh co tap tiep hay khong. Neu ban muon, minh co the rut gon buoi hom nay de de vao nhip hon.',
    ].join('\n\n');
  }

  if (mealCount > 0) {
    return [
      `Neu ban de bo bua hoac khong muon an theo ke hoach ${dayLabel.toLowerCase()}, hay giu muc tieu nho: an dung 1 bua chinh hoac giu du protein cho bua sap toi.`,
      'Chi can bam sat mot diem nho hom nay la du de giu nhiep. Neu can, minh co the doi sang lua chon gon hon.',
    ].join('\n\n');
  }

  return [
    'Neu hom nay ban mat dong luc, dung ep ban than vao muc tieu qua lon. Chon 1 viec rat nho de bat dau: di bo 10 phut, uong nuoc, hoac an dung 1 bua.',
    'Sau khi lam xong viec nho do, minh co the giup ban len buoc tiep theo.',
  ].join('\n\n');
};

const buildGeneralHealthReply = (context?: AIChatContext): string => {
  const dayLabel = context?.targetDayLabel || 'Hom nay';
  const todayWorkoutCount = Number(context?.todayWorkoutCount || 0);
  const todayMealCount = Number(context?.todayMealCount || 0);

  if (todayWorkoutCount + todayMealCount > 0) {
    return `${dayLabel} hien co ${todayWorkoutCount} bai tap va ${todayMealCount} mon an. Ban co the hoi ro hon ve workout, meal plan, phuc hoi, giam met, hoac cach bam sat muc tieu hom nay.`;
  }

  return `${dayLabel} minh chua thay du lich tap hoac thuc don. Ban co the hoi ve dinh duong, phuc hoi, hoac yeu cau tao lai ke hoach de minh ho tro sat hon.`;
};

const buildOutOfScopeReply = (): string =>
  'Minh tap trung vao workout, meal plan, phuc hoi, va thoi quen suc khoe. Neu ban can, hay hoi minh ve buoi tap hom nay, thuc don, giam met, phuc hoi, hoac cach giu dong luc.';

const getFallbackReply = (message: string, intent: AIIntent, context?: AIChatContext): string => {
  if (isGreetingMessage(message)) return buildGreetingReply(context);
  if (isDailyCalorieQuestion(message)) return buildDailyCalorieTargetReply(context);

  const previousTopic = getPreviousTopic(context?.chatHistory);
  if (isShortFollowUpMessage(message)) {
    if (previousTopic === 'workout') return buildPlanOverviewReply('bai tap hom nay', context);
    if (previousTopic === 'meal') return buildPlanOverviewReply('thuc don hom nay', context);
  }

  if (intent === 'injury_care') return buildInjuryCareReply();
  if (intent === 'recovery') return buildRecoveryReply(context);
  if (intent === 'motivation') return buildMotivationReply(context);
  if (intent === 'out_of_scope') return buildOutOfScopeReply();
  if (intent === 'workout_plan' || intent === 'meal_plan' || intent === 'view_day_plan') {
    return buildPlanOverviewReply(message, context);
  }
  return buildGeneralHealthReply(context);
};

const getIntentConfidence = (intent: AIIntent): number => {
  if (intent === 'injury_care') return 0.92;
  if (intent === 'motivation') return 0.88;
  if (intent === 'recovery') return 0.84;
  if (intent === 'out_of_scope') return 0.84;
  if (intent === 'workout_plan' || intent === 'meal_plan' || intent === 'view_day_plan') return 0.82;
  return 0.7;
};

export const aiChatService = async (
  message: string,
  detectedIntent: AIIntent,
  context?: AIChatContext,
): Promise<AIChatResponse> => {
  const responseMode = getResponseModeForIntent(detectedIntent);

  if (isDailyCalorieQuestion(message)) {
    return {
      reply: buildDailyCalorieTargetReply(context),
      intent: detectedIntent === 'general_health' ? 'meal_plan' : detectedIntent,
      responseMode: 'coach_advice',
      confidence: 0.9,
      actionRequired: false,
      actionType: null,
      actionPayload: null,
    };
  }

  if (detectedIntent === 'injury_care' || detectedIntent === 'out_of_scope') {
    return {
      reply: getFallbackReply(message, detectedIntent, context),
      intent: detectedIntent,
      responseMode,
      confidence: getIntentConfidence(detectedIntent),
      actionRequired: false,
      actionType: null,
      actionPayload: null,
    };
  }

  try {
    const aiReply = await askFitlyCoach({
      userMessage: message,
      context: {
        ...context,
        platform: 'web',
        detectedIntent,
        responseMode,
      },
      history: context?.chatHistory,
      maxTokens: 1024,
      temperature: detectedIntent === 'motivation' ? 0.75 : 0.6,
    });

    if (aiReply) {
      return {
        reply: aiReply,
        intent: detectedIntent,
        responseMode,
        confidence: getIntentConfidence(detectedIntent),
        actionRequired: false,
        actionType: null,
        actionPayload: null,
      };
    }
  } catch (error: any) {
    console.warn('[aiChatService] Groq chat fallback:', error?.message || error);
  }

  return {
    reply: getFallbackReply(message, detectedIntent, context),
    intent: detectedIntent,
    responseMode,
    confidence: getIntentConfidence(detectedIntent),
    actionRequired: false,
    actionType: null,
    actionPayload: null,
  };
};
