import { AIChatContext, AIChatMealSummary } from './types';

export type CoachChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type CoachPromptContext = AIChatContext & {
  platform?: 'web' | 'telegram';
  extraContext?: string;
  actionLog?: string;
  todayStatus?: string;
  guestMode?: boolean;
};

type CoachCompletionInput = {
  systemPrompt: string;
  userMessage: string;
  history?: CoachChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

const getMealTypeLabel = (mealType?: string | null): string => {
  const key = String(mealType || '').toLowerCase();
  if (key === 'breakfast') return 'Bua sang';
  if (key === 'lunch') return 'Bua trua';
  if (key === 'dinner') return 'Bua toi';
  if (key === 'snack') return 'Bua phu';
  return 'Bua an';
};

const compactValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'Chua co';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || 'Chua co';
  return String(value);
};

const formatMealCalories = (meal: AIChatMealSummary): number => {
  const quantity = Number(meal.quantity || 1);
  return Math.round(Number(meal.calories || 0) * quantity);
};

const formatExercisesForPrompt = (exercises: AIChatContext['exercises']): string => {
  const rows = Array.isArray(exercises) ? exercises : [];
  if (rows.length === 0) return 'Chua co bai tap trong ngay duoc chon.';
  return rows
    .slice(0, 8)
    .map((item, index) => {
      const name = item.name || item.target_muscle || item.body_part || 'Bai tap';
      return `${index + 1}. ${name}: ${item.sets || 3} set x ${item.reps || '8-12'}, nghi ${item.rest_seconds || 60}s`;
    })
    .join('\n');
};

const formatMealsForPrompt = (meals: AIChatContext['meals']): string => {
  const rows = Array.isArray(meals) ? meals : [];
  if (rows.length === 0) return 'Chua co mon an trong ngay duoc chon.';
  return rows
    .slice(0, 8)
    .map((item, index) => {
      const calories = formatMealCalories(item);
      return `${index + 1}. ${getMealTypeLabel(item.meal_type)} - ${item.name || 'Mon an'} x${item.quantity || 1}: ${calories} kcal, ${item.protein || 0}g protein`;
    })
    .join('\n');
};

export const buildCoachSystemPrompt = (context?: CoachPromptContext): string => {
  const profile = context?.profile || {};
  const body = context?.bodyMetrics || {};
  const lifestyle = context?.lifestyle || {};
  const health = context?.health || {};
  const dayLabel = context?.targetDayLabel || 'Hom nay';
  const platform = context?.platform === 'telegram' ? 'Telegram' : 'web AI Coach';

  return `Ban la "TrendFit AI" - huan luyen vien ca nhan va chuyen gia dinh duong cua ung dung TrendFit.

[KENH TRA LOI]
- Dang tra loi tren: ${platform}
- Neu la Telegram, cau tra loi can gon hon, de doc tren dien thoai.
- Neu la web AI Coach, co the viet thanh cac doan ngan hoac gach dau dong ro rang.

[HO SO NGUOI DUNG]
- Ten: ${compactValue((profile as any).full_name)}
- Can nang: ${compactValue((body as any).weight)}kg | Chieu cao: ${compactValue((body as any).height)}cm | Muc tieu can nang: ${compactValue((body as any).target_weight)}kg
- Muc tieu tap: ${compactValue((lifestyle as any).fitness_goal)}
- Trinh do: ${compactValue((lifestyle as any).experience_level)} | So buoi/tuan: ${compactValue((lifestyle as any).weekly_workouts || (lifestyle as any).activity_level)}
- Noi tap: ${compactValue((lifestyle as any).workout_location)} | Dung cu: ${compactValue((lifestyle as any).equipment_available)}
- Thoi luong/buoi: ${compactValue((lifestyle as any).workout_duration)} phut | Budget: ${compactValue((lifestyle as any).budget_level)}
- Benh ly: ${compactValue((health as any).health_condition)} | Chan thuong: ${compactValue((health as any).injuries)}
- Di ung/lich su y te: ${compactValue((health as any).medical_history || (health as any).allergies)}

[DU LIEU NGAY DUOC CHON: ${dayLabel}]
Bai tap:
${formatExercisesForPrompt(context?.exercises)}

Thuc don:
${formatMealsForPrompt(context?.meals)}

${context?.todayStatus ? `[TIEN DO HOM NAY]\n${context.todayStatus}\n` : ''}
${context?.actionLog ? `[HE THONG VUA THUC HIEN]\n${context.actionLog}\n` : ''}
${context?.extraContext ? `[DU LIEU TRENDfit MO RONG]\n${context.extraContext}\n` : ''}

[QUY TAC SU DUNG DU LIEU]
1. Uu tien du lieu TrendFit trong prompt. Neu thieu du lieu, noi ro "minh chua thay du lieu nay trong TrendFit" roi dua phuong an tam thoi.
2. Khong tu tao chi so suc khoe, calories, can nang, lich su tap neu khong co context.
3. Khi hoi ve bai tap/thuc don, dua goi y cu the: bai/sets/reps/rest hoac khau phan/kcal/protein neu phu hop.
4. Khong chan doan benh. Voi dau nguc, chong mat, te/bien dang khop, chan thuong nang hoac dau khong giam, khuyen ngung tap va gap bac si.
5. Neu cau hoi mo ho, hoi toi da 1 cau lam ro. Neu co the dua phuong an an toan mac dinh thi lam ngay.
6. Khong tra JSON, khong noi ve backend, khong noi minh la model AI.
7. Giong coach that: ro rang, thuc te, khong noi lan man, khong khen xa giao qua muc.
8. Neu nguoi dung yeu cau thay doi lich/tap/mon an, chi dua goi y noi dung. Viec tao proposal se do he thong TrendFit xu ly rieng.`;
};

export const buildGuestCoachSystemPrompt = (): string => `Ban la "TrendFit AI" - huan luyen vien ca nhan va chuyen gia dinh duong cua ung dung TrendFit.
Nguoi dung nay chua lien ket Telegram voi tai khoan TrendFit.
Hay tra loi ngan gon, thuc te, bang tieng Viet tu nhien. Neu ho hoi ve fitness/dinh duong thi van tra loi duoc, nhung nhac nhe rang lien ket tai khoan se giup ca nhan hoa theo lich tap, thuc don va chi so co the.
Khong chan doan benh; voi dau nguc, chong mat, chan thuong nang, te/bien dang khop hoac dau khong giam, khuyen gap bac si.`;

export const callCoachCompletion = async ({
  systemPrompt,
  userMessage,
  history,
  maxTokens = 1024,
  temperature = 0.7,
}: CoachCompletionInput): Promise<string> => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY');
  }

  const normalizedHistory = (history || [])
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .slice(-10)
    .map((item) => ({
      role: item.role,
      content: String(item.content || '').slice(0, 1400),
    }));

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...normalizedHistory,
        { role: 'user', content: userMessage },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const result: any = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) {
    throw new Error(result?.error?.message || 'Groq AI request failed');
  }

  const reply = String(result?.choices?.[0]?.message?.content || '').trim();
  if (!reply) throw new Error('Groq AI returned empty reply');
  return reply;
};

export const askTrendFitCoach = async ({
  userMessage,
  context,
  history,
  maxTokens,
  temperature,
}: {
  userMessage: string;
  context?: CoachPromptContext;
  history?: CoachChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> =>
  callCoachCompletion({
    systemPrompt: buildCoachSystemPrompt(context),
    userMessage,
    history,
    maxTokens,
    temperature,
  });
