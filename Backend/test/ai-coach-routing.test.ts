import { expect, it, vi } from 'vitest';
import { detectIntent, extractDayIndexFromText, isInjuryAdviceRequest, resolveChatWeekStartKey } from '../src/services/ai/aiRouterService';
import { parseNaturalTracking } from '../src/services/coachCommandService';
import { mealAdjusterService } from '../src/services/ai/mealAdjusterService';
import { aiChatService, isDailyCalorieQuestion } from '../src/services/ai/aiChatService';
import { buildCoachSystemPrompt, mergeCoachChatHistory, sanitizeCoachReply } from '../src/services/ai/coachConversationService';

it('distinguishes creating, viewing, pain, and follow-up questions', () => {
  expect(detectIntent('Tạo lịch tập thứ 2').intent).toBe('create_workout_plan');
  expect(detectIntent('Xem lịch tập thứ 2').intent).toBe('workout_plan');
  expect(isInjuryAdviceRequest('Bắt đầu tập vai thế nào?')).toBe(false);
  expect(isInjuryAdviceRequest('Bài tập cho đầu gối là gì?')).toBe(false);
  expect(detectIntent('Tôi đau vai khi tập').intent).toBe('injury_care');
  expect(detectIntent('Bài nào nữa?', { chatHistory: [{ role: 'user', content: 'Hôm nay có bài tập gì?' }] }).intent).toBe('workout_plan');
  expect(detectIntent('Tôi dị ứng hải sản').intent).not.toBe('adjust_meal');
});

it('maps relative dates across the Sunday boundary', () => {
  expect(resolveChatWeekStartKey('Lịch tập ngày mai', '2026-11-01', '2026-10-26')).toBe('2026-11-02');
  expect(resolveChatWeekStartKey('Thứ hai tuần sau ăn gì?', '2026-10-27', '2026-10-26')).toBe('2026-11-02');
  expect(extractDayIndexFromText('thứ 20')).toBeNull();
});

it('reuses persisted conversation without repeating the same turns from the client', () => {
  const user = { role: 'user' as const, content: 'Hôm nay tập gì?' };
  const coach = { role: 'assistant' as const, content: 'Squat và chống đẩy.' };
  const followUp = { role: 'user' as const, content: 'Bài nào nữa?' };
  expect(mergeCoachChatHistory([user, coach], [user, coach, followUp])).toEqual([user, coach, followUp]);
});

it('does not turn questions into progress writes', () => {
  expect(parseNaturalTracking('Tôi nên uống 2l nước không?')).toEqual({});
  expect(parseNaturalTracking('Ngủ 8 giờ có tốt không?')).toEqual({});
  expect(parseNaturalTracking('Ăn 500 kcal có ít quá?')).toEqual({});
  expect(parseNaturalTracking('Đã uống 500ml nước')).toEqual({ waterMl: 500 });
  expect(parseNaturalTracking('Ghi 8 giờ ngủ')).toEqual({ sleepHours: 8 });
  expect(parseNaturalTracking('Ghi 500 kcal đã ăn')).toEqual({ calories: 500 });
});

it('keeps the original recipe ID when proposing a different meal', async () => {
  const response = await mealAdjusterService({
    dayOfWeek: 1,
    currentMeal: { id: 'meal-item', meal_type: 'lunch', food_id: 'recipe-old', foods: { name: 'Món cũ' } },
    candidateFoods: [
      { id: 'recipe-old', name: 'Món cũ' },
      { id: 'recipe-new', name: 'Món mới', calories: 400 },
    ],
  });
  expect(response.actionRequired).toBe(true);
  expect(response.actionPayload).toMatchObject({ old_weekly_food_item_id: 'meal-item', old_food_id: 'recipe-old', new_food_id: 'recipe-new' });
});

it('does not invent calorie inputs or suppress specialist referrals', async () => {
  expect(isDailyCalorieQuestion('Tôi nên ăn bao nhiêu kcal mỗi ngày?')).toBe(true);
  expect(isDailyCalorieQuestion('Hôm nay tôi đã ăn bao nhiêu kcal?')).toBe(false);
  const response = await aiChatService('Tôi nên ăn bao nhiêu kcal mỗi ngày?', 'general_health', {
    profile: {}, bodyMetrics: { weight: 70, height: 170 }, lifestyle: { target_calories: 1800 },
  });
  expect(response.reply).toContain('1800 kcal/ngày');
  expect(response.reply).toContain('chưa thể ước tính lại');
  const minor = await aiChatService('Tôi nên ăn bao nhiêu kcal mỗi ngày?', 'general_health', {
    profile: { birthday: '2015-01-01', gender: 'Nam' }, bodyMetrics: { weight: 45, height: 155 }, lifestyle: {},
  });
  expect(minor.reply).toContain('chưa thể ước tính kcal cá nhân');
  expect(sanitizeCoachReply('Hãy trao đổi với chuyên gia dinh dưỡng được cấp phép.')).toContain('chuyên gia dinh dưỡng');
  expect(buildCoachSystemPrompt()).not.toContain('120.000d - 160.000d/kg');
});

it('does not disguise an unavailable AI provider as a personalized technical answer', async () => {
  vi.stubEnv('GROQ_API_KEY', '');
  try {
    await expect(aiChatService('Giải thích kỹ thuật squat cho tôi', 'general_health')).rejects.toThrow('Missing GROQ_API_KEY');
  } finally {
    vi.unstubAllEnvs();
  }
});
