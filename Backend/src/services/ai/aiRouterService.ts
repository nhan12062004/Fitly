import { AIChatContext, AIIntent } from './types';

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

export const extractDayIndexFromText = (message: string): number | null => {
  const normalized = normalizeVietnameseText(message);
  if (!normalized) return null;

  if (normalized.includes('chu nhat') || /\bcn\b/.test(normalized)) {
    return 6;
  }

  for (let day = 2; day <= 7; day += 1) {
    if (normalized.includes(`thu ${day}`)) {
      return day - 2;
    }
  }

  return null;
};

export const detectIntent = (message: string, _context?: AIChatContext): IntentDetectionResult => {
  const normalized = normalizeVietnameseText(message);
  const referencedDayIndex = extractDayIndexFromText(message);

  const mentionsWorkout =
    normalized.includes('bai tap') ||
    normalized.includes('tap gi') ||
    normalized.includes('lich tap') ||
    normalized.includes('buoi tap') ||
    normalized.includes('workout');

  const mentionsMeal =
    normalized.includes('thuc don') ||
    normalized.includes('mon an') ||
    normalized.includes('bua an') ||
    normalized.includes('bua phu') ||
    normalized.includes('an gi') ||
    normalized.includes('toi nay an') ||
    normalized.includes('trua nay an') ||
    normalized.includes('sang nay an') ||
    normalized.includes('goi y mon') ||
    normalized.includes('meal');

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

  if (
    normalized.includes('doi mon') ||
    normalized.includes('doi bua') ||
    normalized.includes('doi thuc don') ||
    normalized.includes('khong thich mon') ||
    normalized.includes('an gi') ||
    normalized.includes('toi nay an') ||
    normalized.includes('trua nay an') ||
    normalized.includes('sang nay an') ||
    normalized.includes('goi y mon') ||
    normalized.includes('gon hon')
  ) {
    return { intent: 'adjust_meal', confidence: 0.84 };
  }

  if (
    normalized.includes('doi bai tap') ||
    normalized.includes('bai tap khac') ||
    normalized.includes('thay bai tap') ||
    normalized.includes('doi dong tac') ||
    normalized.includes('thay dong tac') ||
    normalized.includes('met') ||
    normalized.includes('dau') ||
    normalized.includes('10 phut') ||
    normalized.includes('bai nhe') ||
    normalized.includes('nhe hon') ||
    normalized.includes('dieu chinh')
  ) {
    return { intent: 'adjust_workout', confidence: 0.86 };
  }

  if (
    asksForSchedule &&
    (mentionsWorkout ||
      mentionsMeal ||
      normalized.includes('lich') ||
      normalized.includes('hom nay') ||
      normalized.includes('thuc don'))
  ) {
    return { intent: 'view_day_plan', confidence: 0.88 };
  }

  if (normalized.includes('tao lich tap') || normalized.includes('lich tap tuan')) {
    return { intent: 'create_workout_plan', confidence: 0.8 };
  }

  if (normalized.includes('tao thuc don') || normalized.includes('thuc don tuan')) {
    return { intent: 'create_meal_plan', confidence: 0.8 };
  }

  if (normalized.includes('tien do') || normalized.includes('tuan nay')) {
    return { intent: 'analyze_progress', confidence: 0.78 };
  }

  return { intent: 'advice', confidence: 0.62 };
};
