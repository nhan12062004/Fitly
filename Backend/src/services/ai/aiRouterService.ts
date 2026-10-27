import { AIChatContext, AIIntent, AIResponseMode } from './types';
import { toMondayWeekKey } from '../../lib/weekKey';

type IntentDetectionResult = {
  intent: AIIntent;
  confidence: number;
};

export const normalizeVietnameseText = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const extractDayIndexFromText = (message: string, todayDayIndex?: number): number | null => {
  const normalized = normalizeVietnameseText(message);
  if (!normalized) return null;

  // "mai" / "ngày mai" / "tomorrow" → tomorrow's day index
  if (
    typeof todayDayIndex === 'number' &&
    (
      /\bmai\b/.test(normalized) ||
      normalized.includes('ngay mai') ||
      normalized.includes('tomorrow')
    ) &&
    // Make sure the message isn't about something unrelated like "email"
    !normalized.includes('email')
  ) {
    return (todayDayIndex + 1) % 7;
  }

  // "hôm nay" / "today" → today's day index
  if (
    typeof todayDayIndex === 'number' &&
    (normalized.includes('hom nay') || normalized.includes('today'))
  ) {
    return todayDayIndex;
  }

  if (normalized.includes('chu nhat') || /\bcn\b/.test(normalized)) {
    return 6;
  }

  for (let day = 2; day <= 7; day += 1) {
    if (new RegExp(`\\bthu ${day}\\b`).test(normalized)) {
      return day - 2;
    }
  }

  return null;
};

export const resolveChatWeekStartKey = (message: string, todayKey: string, selectedWeekKey?: string): string | null => {
  const normalized = normalizeVietnameseText(message);
  const currentMonday = toMondayWeekKey(todayKey);
  if (!currentMonday) return null;
  if (hasAny(normalized, ['tuan sau', 'next week'])) {
    const nextMonday = new Date(`${currentMonday}T00:00:00Z`);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    return nextMonday.toISOString().slice(0, 10);
  }
  if (hasAny(normalized, ['ngay mai', 'mai', 'tomorrow'])) {
    const tomorrow = new Date(`${todayKey}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return toMondayWeekKey(tomorrow.toISOString().slice(0, 10));
  }
  if (hasAny(normalized, ['hom nay', 'today', 'tuan nay', 'this week'])) return currentMonday;
  return toMondayWeekKey(selectedWeekKey || todayKey);
};

const hasAny = (value: string, terms: string[]) => terms.some((term) => ` ${value} `.includes(` ${term} `));

export const getResponseModeForIntent = (intent: AIIntent): AIResponseMode => {
  if (
    intent === 'adjust_workout' ||
    intent === 'adjust_meal' ||
    intent === 'create_workout_plan' ||
    intent === 'create_meal_plan'
  ) {
    return 'plan_edit';
  }

  if (intent === 'injury_care') return 'safety';
  if (intent === 'motivation') return 'support';
  if (intent === 'out_of_scope') return 'redirect';
  return 'coach_advice';
};

export const isInjuryAdviceRequest = (message: string): boolean => {
  const normalized = normalizeVietnameseText(message);
  const painText = normalized.replace(/\bbat dau\b/g, '')
    .replace(/\bdau goi\b/g, (phrase) => /đầu gối/i.test(message) ? '' : phrase);
  if (!normalized) return false;

  const mentionsPainOrInjury = hasAny(painText, [
    'dau',
    'nhuc',
    'sung',
    'viem',
    'chan thuong',
    'bong gan',
    'lat co',
    'cang co',
    'te',
    'buot',
  ]);

  const mentionsBodyArea = hasAny(normalized, [
    'khop',
    'co chan',
    'mat ca',
    'goi',
    'dau goi',
    'lung',
    'vai',
    'co tay',
    'khuu tay',
    'hang',
    'dui',
    'bap chan',
    'gan got',
    'ban chan',
  ]);

  const asksForCare = hasAny(normalized, [
    'giam dau',
    'lam sao',
    'cach nao',
    'nen lam gi',
    'xu ly',
    'hoi phuc',
    'co nen tap',
    'di kham',
  ]);

  return mentionsPainOrInjury && (mentionsBodyArea || asksForCare);
};

export const detectIntent = (message: string, context?: AIChatContext): IntentDetectionResult => {
  const normalized = normalizeVietnameseText(message);
  const referencedDayIndex = extractDayIndexFromText(message);
  const todayWorkoutCount = Number(context?.todayWorkoutCount || 0);
  const todayMealCount = Number(context?.todayMealCount || 0);

  const mentionsWorkout = hasAny(normalized, ['bai tap', 'tap gi', 'lich tap', 'buoi tap', 'workout']);
  const mentionsMeal = hasAny(normalized, [
    'thuc don', 'mon an', 'mon', 'bua', 'bua an', 'bua phu', 'an gi',
    'toi nay an', 'trua nay an', 'sang nay an', 'goi y mon', 'protein', 'dam', 'kcal', 'meal',
  ]);

  const mentionsRecovery = hasAny(normalized, [
    'phuc hoi',
    'hoi phuc',
    'gian co',
    'stretch',
    'khoi dong',
    'ha nhiet',
    'ngu',
    'mat ngu',
    'nghi ngoi',
    'met',
    'doms',
    'dau co',
    'cang co',
    'u nuoc',
    'uong nuoc',
    'bo sung',
    'cardio nhe',
  ]);

  const mentionsMotivation = hasAny(normalized, [
    'luoi',
    'nan',
    'chan tap',
    'mat dong luc',
    'khong co dong luc',
    'khong muon tap',
    'bo tap',
    'bo bua',
    'tri hoan',
    'khong theo duoc',
    'khong duy tri duoc',
  ]);

  const mentionsOutOfScope = hasAny(normalized, [
    'email',
    'cv',
    'bitcoin',
    'crypto',
    'vang',
    'chung khoan',
    'co phieu',
    'lap trinh',
    'code',
    'fix bug',
    've may bay',
    'du lich',
  ]);

  const asksForSchedule =
    normalized.includes('xem lich') ||
    normalized.includes('lich hom nay') ||
    normalized.includes('hom nay co') ||
    normalized.includes('co nhung') ||
      normalized.includes('gom nhung') ||
      normalized.includes('bao nhieu bai') ||
      normalized.includes('bao nhieu mon') ||
      normalized.includes('xem bai tap') ||
      normalized.includes('xem thuc don') ||
      referencedDayIndex !== null;

  const asksForMealChange = hasAny(normalized, [
    'doi mon',
    'doi bua',
    'doi thuc don',
    'khong thich mon',
    'thay mon',
    'goi y mon khac',
    'gon hon',
    'thay uc ga',
    'khong an duoc',
    'bo mon',
  ]);

  const asksForWorkoutChange = hasAny(normalized, [
    'doi bai tap',
    'bai tap khac',
    'thay bai tap',
    'doi dong tac',
    'thay dong tac',
    'rut gon buoi tap',
    'rut gon',
    'nhe hon',
    'giam tai',
    'giam do nang',
    'nang qua',
    'khong co ta',
    '10 phut',
    'dieu chinh',
    'doi lich tap',
  ]);

  const mentionsGeneralHealth = hasAny(normalized, [
    'suc khoe',
    'an kieng',
    'dinh duong',
    'protein',
    'dam',
    'chat beo',
    'tinh bot',
    'kcal',
    'calo',
    'nuoc',
    'ngu',
    'stress',
    'ky thuat',
    'huong dan',
    'tap sao',
  ]);

  if (isInjuryAdviceRequest(normalized)) {
    return { intent: 'injury_care', confidence: 0.94 };
  }

  if (mentionsMotivation) {
    return { intent: 'motivation', confidence: 0.9 };
  }

  if (asksForMealChange) {
    return { intent: 'adjust_meal', confidence: 0.84 };
  }

  if (asksForWorkoutChange) {
    return { intent: 'adjust_workout', confidence: 0.86 };
  }

  if (hasAny(normalized, ['tao lich tap', 'lap lich tap', 'tao bai tap', 'tao buoi tap'])) {
    return { intent: 'create_workout_plan', confidence: 0.86 };
  }
  if (hasAny(normalized, ['tao thuc don', 'lap thuc don', 'tao lich an'])) {
    return { intent: 'create_meal_plan', confidence: 0.86 };
  }

  const previousUserTopic = [...(context?.chatHistory || [])].reverse()
    .filter((item) => item.role === 'user')
    .map((item) => normalizeVietnameseText(item.content))
    .map((item) => hasAny(item, ['bai tap', 'lich tap', 'buoi tap', 'workout']) ? 'workout'
      : hasAny(item, ['mon', 'bua', 'thuc don', 'meal']) ? 'meal' : null)
    .find(Boolean);
  if (hasAny(normalized, ['bai nao', 'bai nao nua']) && previousUserTopic === 'workout') {
    return { intent: 'workout_plan', confidence: 0.84 };
  }
  if (hasAny(normalized, ['mon nao', 'mon nao nua']) && previousUserTopic === 'meal') {
    return { intent: 'meal_plan', confidence: 0.84 };
  }

  if (
    asksForSchedule &&
    (mentionsWorkout ||
      mentionsMeal ||
      normalized.includes('lich') ||
      normalized.includes('hom nay') ||
      normalized.includes('thuc don'))
  ) {
    if (mentionsMeal && !mentionsWorkout) {
      return { intent: 'meal_plan', confidence: 0.88 };
    }

    if (mentionsWorkout && !mentionsMeal) {
      return { intent: 'workout_plan', confidence: 0.88 };
    }

    if (todayWorkoutCount > 0 || todayMealCount > 0) {
      return { intent: todayWorkoutCount >= todayMealCount ? 'workout_plan' : 'meal_plan', confidence: 0.84 };
    }

    return { intent: 'general_health', confidence: 0.72 };
  }

  if (normalized.includes('lich tap tuan')) {
    return { intent: 'create_workout_plan', confidence: 0.8 };
  }

  if (normalized.includes('thuc don tuan')) {
    return { intent: 'create_meal_plan', confidence: 0.8 };
  }

  if (normalized.includes('tien do') || normalized.includes('tuan nay')) {
    return { intent: 'analyze_progress', confidence: 0.78 };
  }

  if (mentionsRecovery) {
    return { intent: 'recovery', confidence: 0.82 };
  }

  if (mentionsMeal) {
    return { intent: 'meal_plan', confidence: 0.74 };
  }

  if (mentionsWorkout) {
    return { intent: 'workout_plan', confidence: 0.74 };
  }

  if (mentionsGeneralHealth) {
    return { intent: 'general_health', confidence: 0.68 };
  }

  if (mentionsOutOfScope) {
    return { intent: 'out_of_scope', confidence: 0.85 };
  }

  return { intent: 'general_health', confidence: 0.58 };
};
