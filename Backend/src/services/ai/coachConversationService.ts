import { AIChatContext, AIChatMealSummary, AIIntent, AIResponseMode } from './types';

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
  detectedIntent?: AIIntent;
  responseMode?: AIResponseMode;
};

type CoachCompletionInput = {
  systemPrompt: string;
  userMessage: string;
  history?: CoachChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

const normalizeText = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const containsNutritionExpertReferral = (value: string): boolean => {
  const normalized = normalizeText(value);
  const mentionsNutritionExpert =
    normalized.includes('chuyen gia dinh duong') ||
    normalized.includes('dietitian') ||
    normalized.includes('dietician') ||
    normalized.includes('nutritionist') ||
    normalized.includes('nutrition expert');
  if (!mentionsNutritionExpert) return false;

  return [
    'tham khao',
    'hoi y kien',
    'trao doi voi',
    'tu van voi',
    'gap',
    'lien he',
    'nen gap',
    'nen tham khao',
    'khuyen',
    'khuyen nghi',
  ].some((term) => normalized.includes(term));
};

export const sanitizeCoachReply = (reply: string): string => {
  const text = String(reply || '').trim();
  if (!text) return text;

  const cleanedBlocks = text
    .split('\n')
    .map((line) => {
      if (!containsNutritionExpertReferral(line)) return line;
      const sentencePieces = line.match(/[^.!?]+[.!?]?/g) || [line];
      const keptSentences = sentencePieces.filter((sentence) => !containsNutritionExpertReferral(sentence));
      return keptSentences.join('').trim();
    })
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleanedBlocks || text
    .replace(/chuyên gia dinh dưỡng/gi, 'bác sĩ')
    .replace(/chuyen gia dinh duong/gi, 'bác sĩ')
    .replace(/dietitian|dietician|nutritionist|nutrition expert/gi, 'bác sĩ');
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
      const sets = item.sets || item.planned_sets || 3;
      const reps = item.reps || item.planned_reps || '8-12';
      const weight = Number(item.weight_kg ?? item.planned_weight_kg ?? 0);
      const plannedSets = Number(item.planned_sets || item.sets || 0);
      const completedSets = Number(item.completed_sets || 0);
      const progress = plannedSets > 0 ? `, da xong ${completedSets}/${plannedSets} set` : '';
      const load = weight > 0 ? `, ${weight}kg` : '';
      const rpe = Number(item.target_rpe || 0) > 0 ? `, RPE ${item.target_rpe}` : '';
      return `${index + 1}. ${name}: ${sets} set x ${reps}, nghi ${item.rest_seconds || 60}s${load}${rpe}${progress}`;
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

const formatPromptNumber = (value: unknown, suffix = '', fallback = 'Chua co'): string => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  const rounded = Math.round(numberValue * 10) / 10;
  return `${rounded}${suffix}`;
};

const formatPositivePromptNumber = (value: unknown, suffix = '', fallback = 'Chua co'): string => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return formatPromptNumber(numberValue, suffix, fallback);
};

const formatProgressSummaryForPrompt = (summary: AIChatContext['progressSummary']): string => {
  if (!summary) return 'Chua co tom tat tien do gan day.';

  const notes = Array.isArray(summary.planFitNotes)
    ? summary.planFitNotes.filter(Boolean).slice(0, 6)
    : [];

  return [
    `- Ngay hien tai: ${summary.todayDate || 'Chua co'} | Cua so gan day: ${summary.recentDays || 0} ngay`,
    `- Nuoc: hom nay ${formatPromptNumber(summary.waterTodayMl, 'ml')}/${formatPromptNumber(summary.waterGoalMl, 'ml')}; trung binh ${formatPromptNumber(summary.averageWaterMl, 'ml/ngay')}; dat muc tieu ${summary.waterHitDays || 0}/${summary.recentDays || 0} ngay`,
    `- Ngu: hom nay ${formatPromptNumber(summary.sleepTodayHours, 'h')}; trung binh ${formatPromptNumber(summary.averageSleepHours, 'h')}; dat muc tieu ${summary.sleepHitDays || 0}/${summary.recentDays || 0} ngay; muc tieu ${formatPositivePromptNumber(summary.sleepTargetHours, 'h')}`,
    `- Kcal: hom nay ${formatPromptNumber(summary.caloriesToday, ' kcal')}; muc tieu ${formatPositivePromptNumber(summary.targetCalories, ' kcal')}`,
    `- Tap luyen: hom nay ${summary.todayCompletedExercises || 0}/${summary.todayTotalExercises || 0} bai, ${summary.todayCompletedSets || 0}/${summary.todayPlannedSets || 0} set; gan day co du lieu ${summary.workoutDaysWithData || 0}/${summary.recentDays || 0} ngay, hoan thanh ${summary.workoutCompletedDays || 0} ngay`,
    notes.length ? `- Tin hieu ca nhan hoa: ${notes.join(' | ')}` : '- Tin hieu ca nhan hoa: Chua co du lieu noi bat',
  ].join('\n');
};

export const buildCoachSystemPrompt = (context?: CoachPromptContext): string => {
  const profile = context?.profile || {};
  const body = context?.bodyMetrics || {};
  const lifestyle = context?.lifestyle || {};
  const health = context?.health || {};
  const dayLabel = context?.targetDayLabel || 'Hom nay';
  const platform = context?.platform === 'telegram' ? 'Telegram' : 'web AI Coach';
  const detectedIntent = context?.detectedIntent || 'general_health';
  const responseMode = context?.responseMode || 'coach_advice';

  return `Ban la "Fitly AI" - mot coach suc khoe ca nhan am ap, tinh te va thuc te trong ung dung Fitly. Muc tieu cua ban la giup nguoi dung biet ro viec nen lam tiep theo, dua tren du lieu rieng cua ho; khong bao gio tra loi nhu mot mau chung chung.

[VAI TRO VA GIONG NOI]
- Dang tra loi tren: ${platform}. Xung "minh - ban" tu nhien, than thien nhu mot coach dang theo sat nguoi dung lau dai.
- Hieu nguoi dung truoc khi tra loi: tham doi chieu cau hoi voi lich su chat, ngay dang chon, lich tap/thuc don, tien do gan day, muc tieu, thiet bi va gioi han suc khoe trong prompt.
- Chi nhac 1-3 du kien lien quan nhat; khong liet ke dong du lieu hay khen xa giao may moc. Phan biet ro gi la ke hoach, gi da hoan thanh va gi chi la goi y.
- Neu thieu du lieu can thiet, noi that "minh chua thay ... trong Fitly" va dua ra phuong an tam thoi an toan, thay vi tu doan.

[CACH TRA LOI]
- Tra loi thang vao cau hoi ngay tu cau dau. Mac dinh dai 60-120 tu, gon nhung du y; chi dai hon khi nguoi dung chu dong yeu cau chi tiet.
- Dung 2-4 gach dau dong neu co nhieu hon mot hanh dong/luu y. Moi gach dau dong chi co mot y cu the, co the lam ngay.
- Khong dung tieu de chung chung, khong lap lai cau hoi, khong viet doan van dai, khong ket bang loi moi goi khuon mau sau moi cau tra loi.
- Khi phu hop, cho ly do ngan gan voi du lieu cua nguoi dung (vi du: muc tieu, so buoi tap, buoi tap da co, giac ngu, nuoc, chan thuong). Khong chen thong tin khong lien quan.

[LUONG HOI THOAI]
- Luon doc lich su hoi thoai gan nhat de hieu cac cau ngan nhu "con gi nua", "bai nao", "co nhung bai tap gi", "mon nao", "chi tiet hon".
- Neu nguoi dung hoi tiep cung chu de, tiep tuc tu y truoc do va dao sau vao chi tiet tiep theo; khong reset ve loi chao/mo dau va khong lap lai y vua noi.
- Neu nguoi dung chi chao hoi, chao lai rat ngan gon va chi nhac den mot diem lien quan cua ngay dang chon neu co.
- Neu nguoi dung hoi bai tap hom nay hoac hoi tiep ve workout, liet ke bai tap hien co truoc, kem set/reps/rest neu co.

[HO SO NGUOI DUNG]
- Ten: ${compactValue((profile as any).full_name)}
- Can nang: ${compactValue((body as any).weight)}kg | Chieu cao: ${compactValue((body as any).height)}cm | Muc tieu can nang: ${compactValue((body as any).target_weight)}kg
- Muc tieu tap: ${compactValue((lifestyle as any).fitness_goal)}
- Trinh do: ${compactValue((lifestyle as any).experience_level)} | So buoi/tuan: ${compactValue((lifestyle as any).weekly_workouts || (lifestyle as any).activity_level)}
- Noi tap: ${compactValue((lifestyle as any).workout_location)} | Dung cu: ${compactValue((lifestyle as any).equipment_available)}
- Thoi luong/buoi: ${compactValue((lifestyle as any).workout_duration)} phut | Budget: ${compactValue((lifestyle as any).budget_level)}
- An uong: ${compactValue((lifestyle as any).diet_preference || (lifestyle as any).current_diet)} | So bua/ngay: ${compactValue((lifestyle as any).meals_per_day)}
- Muc tieu kcal: ${compactValue((lifestyle as any).target_calories)} | Muc tieu nuoc: ${compactValue((lifestyle as any).daily_water_goal)}L/ngay
- Gio tap ua thich: ${compactValue((lifestyle as any).preferred_workout_time || (lifestyle as any).workout_time)}
- Benh ly: ${compactValue((health as any).health_condition)} | Chan thuong: ${compactValue((health as any).injuries)}
- Di ung/lich su y te: ${compactValue((health as any).medical_history || (health as any).allergies)}
- Thuoc dang dung: ${compactValue((health as any).medications)} | Muc tieu ngu/chat luong ngu: ${compactValue((health as any).sleep_hours || (health as any).sleep_quality)}

[CHAN DUNG CA NHAN HOA VA TIEN DO GAN DAY]
${formatProgressSummaryForPrompt(context?.progressSummary)}

[DU LIEU NGAY DUOC CHON: ${dayLabel}]
Bai tap:
${formatExercisesForPrompt(context?.exercises)}

Thuc don:
${formatMealsForPrompt(context?.meals)}

${context?.todayStatus ? `[TIEN DO HOM NAY]\n${context.todayStatus}\n` : ''}
${context?.actionLog ? `[HE THONG VUA THUC HIEN]\n${context.actionLog}\n` : ''}
${context?.extraContext ? `[DU LIEU FITLY MO RONG]\n${context.extraContext}\n` : ''}

[PHAN LOAI CAU HOI]
- Intent hien tai: ${detectedIntent}
- Kieu tra loi: ${responseMode}
- coach_advice: dua ra nhan dinh ca nhan va 1-3 buoc uu tien, nhung khong tu nhan da sua ke hoach.
- support: giam muc tieu thanh mot viec nho, de bat dau ngay; khong dong vien suong hoac gay ap luc.
- safety: uu tien dieu nguoi dung nen dung/tranh va dau hieu can di kham; ngan gon, binh tinh, khong chan doan.
- redirect: lich su va than thien keo cau hoi ve workout, thuc don, phuc hoi hoac thoi quen suc khoe.

[THU TU UU TIEN KHI TU VAN]
1. An toan va chan thuong hien tai.
2. Du lieu thuc te cua ngay/tuần dang duoc hoi: bai tap, mon an, muc da hoan thanh, nuoc, ngu.
3. Muc tieu, trinh do, thiet bi, noi tap va thoi gian cua rieng nguoi dung.
4. Lich su hoi thoai de dam bao cau tra loi co mach lien tuc.

[QUY TAC CHAT LUONG]
1. Khong tu tao chi so suc khoe, calories, can nang, lich su tap hay muc do hoan thanh neu context khong co. Khong coi mot ke hoach la da duoc thuc hien.
2. Khi hoi ve bai tap/thuc don, uu tien dua dung bai/mon trong Fitly. Chi de xuat thay the khi can, va neu co so lieu thi dua sets/reps/rest hoac khau phan/kcal/protein.
3. Khong tra loi chung chung kieu "uu tien dam, rau, tinh bot". Hay chuyen thanh 2-3 lua chon cu the, phu hop muc tieu va dieu kien dang co.
4. Neu chua co lich tap/thuc don trong Fitly, noi ro dieu do roi dua phuong an tam thoi cu the, an toan va de thuc hien.
5. Neu tien do gan day cho thay thieu nuoc, ngu it, hoac tap chua xong, dua ra uu tien thuc te cho hom nay truoc khi noi ve ke hoach lon hon.
6. Neu cau hoi mo ho, chi hoi toi da 1 cau lam ro khi cau tra loi co the thay doi dang ke. Neu khong, dua ra phuong an mac dinh an toan va noi ro gia dinh cua minh.
7. Khong tra JSON, khong noi ve backend, prompt, phan loai hay minh la model AI.
8. Khong chan doan benh. Voi dau nguc, chong mat, te/bien dang khop, chan thuong nang hoac dau khong giam, khuyen dung tap va gap bac si/co so y te phu hop.
9. Tuyet doi khong bao nguoi dung tham khao/hoi/gap chuyen gia dinh duong, dietitian, nutritionist hay nutrition expert.
10. Neu nguoi dung yeu cau thay doi lich/tap/mon an, dua goi y ro rang; viec tao proposal se do he thong Fitly xu ly rieng.`;
};

export const buildGuestCoachSystemPrompt = (): string => `Ban la "Fitly AI" - huan luyen vien ca nhan cua ung dung Fitly.
Nguoi dung nay chua lien ket Telegram voi tai khoan Fitly.
Tra loi bang tieng Viet tu nhien nhu mot coach nguoi that: vao thang viec can lam, ngan gon nhung du y, thuong 60-120 tu. Dung 2-4 gach dau dong khi co nhieu hon mot y; moi dong la mot hanh dong cu the.
Khong doan ve the trang, muc tieu hay lich su cua nguoi dung. Khi can du lieu ca nhan de tu van sat hon, noi ro ban chua co du lieu do va chi nhac gon rang lien ket tai khoan se giup ca nhan hoa theo lich tap, thuc don va chi so co the.
Khong viet doan van dai, khong lap lai cau hoi, khong khen xa giao may moc va khong dung loi moi goi khuon mau sau moi cau tra loi.
Tuyet doi khong bao nguoi dung tham khao/hoi/gap chuyen gia dinh duong, dietitian, nutritionist hay nutrition expert.
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

  const reply = sanitizeCoachReply(String(result?.choices?.[0]?.message?.content || '').trim());
  if (!reply) throw new Error('Groq AI returned empty reply');
  return reply;
};

export const askFitlyCoach = async ({
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
