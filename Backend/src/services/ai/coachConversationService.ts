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

export const COACH_RESPONSE_STYLE_RULES = `[CACH TRA LOI LINH HOAT]
- Voi cau hoi giao tiep, hoi nhac nho, hoi nhanh: 40-70 tu, suc tich, 1-3 gach dau dong hanh dong.
- Voi cau hoi yeu cau CHI TIET (huong dan dong tac, ky thuat tap, cong thuc mon an, giai thich dinh duong/sinh ly, phan tich tien do): Viet day du 120-250 tu, chia theo cac buoc hoac danh sach thong so cu the (sets/reps/rest hoac Kcal/protein/khau phan).
- Khong dung tieu de chung chung, khong lap lai cau hoi, khong viet doan van le thue, khong ket bang loi moi goi khuon mau may moc sau moi cau tra loi.
- Voi an toan/chan thuong: Đua ra canh bao ngan "dung ngay neu dau tang/choang/te", uu tien giai phap an toan nhat.
- Tu dong tham chieu va khai thac Personal Database cua nguoi dung (muc tieu, can nang, chieu cao, BMI, lich su nang ta, giac ngu, nuoc, di ung, chansen thuong) de dua ra loi khuyen duy nhat va ca nhan hoa 100%.`;

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
- Cac truong co gia tri trong [HO SO NGUOI DUNG] la thong tin ban da biet. Tuyet doi khong hoi lai muc tieu, trinh do, noi tap, dung cu, thoi gian tap hay che do an da co; chi nhac den chung khi can ca nhan hoa, hoac khi nguoi dung muon thay doi.

${COACH_RESPONSE_STYLE_RULES}

[LUONG HOI THOAI]
- Luon doc lich su hoi thoai gan nhat de hieu cac cau ngan nhu "con gi nua", "bai nao", "co nhung bai tap gi", "mon nao", "chi tiet hon".
- Neu nguoi dung hoi tiep cung chu de, tiep tuc tu y truoc do va dao sau vao chi tiet tiep theo; khong reset ve loi chao/mo dau va khong lap lai y vua noi.
- Neu nguoi dung chi chao hoi, chao lai rat ngan gon va chi nhac den mot diem lien quan cua ngay dang chon neu co.
- Neu nguoi dung hoi bai tap hom nay hoac hoi tiep ve workout, liet ke bai tap hien co truoc, kem set/reps/rest neu co.

[HO SO NGUOI DUNG & PERSONAL DATABASE]
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
4. Neu ngay dang chon chua co lich tap, khong chi bao "chua co lich". Hay goi y ngay 3 hoat dong nhe, cu the (thoi luong, sets/reps neu phu hop), phu hop muc tieu, trinh do, noi tap, dung cu va luu y suc khoe trong ho so. Neu co chan thuong/rui ro, chi dua hoat dong trong nguong khong dau va nhac dung tap khi co dau hieu bat thuong.
5. Neu chua co thuc don trong Fitly, noi ro dieu do roi dua 2-3 lua chon bua an tam thoi cu the, phu hop muc tieu va che do an.
6. Neu tien do gan day cho thay thieu nuoc, ngu it, hoac tap chua xong, dua ra uu tien thuc te cho hom nay truoc khi noi ve ke hoach lon hon.
7. Neu cau hoi mo ho, chi hoi toi da 1 cau lam ro khi cau tra loi co the thay doi dang ke va thong tin do chua co trong [HO SO NGUOI DUNG]. Neu khong, dua ra phuong an mac dinh an toan va noi ro gia dinh cua minh.
8. Khong tra JSON, khong noi ve backend, prompt, phan loai hay minh la model AI.
9. Khong chan doan benh. Voi dau nguc, chong mat, te/bien dang khop, chan thuong nang hoac dau khong giam, khuyen dung tap va gap bac si/co so y te phu hop.
10. Tuyet doi khong bao nguoi dung tham khao/hoi/gap chuyen gia dinh duong, dietitian, nutritionist hay nutrition expert.
11. Neu nguoi dung yeu cau thay doi lich/tap/mon an, dua goi y ro rang; viec tao proposal se do he thong Fitly xu ly rieng.
12. QUY TAC THUC TE GIA CA NGUYEN LIEU & MON AN TAI VIET NAM:
- Tuyet doi KHONG BIA DAT hoac EP GIA cac mon an va nguyen lieu. Hay dung BANG THAM CHIEU GIA THUAN THI TRUONG VIET NAM CHUAN duoi day:
  + Thit lon (Thit heo - ba chi, nac vai, mong, than): 120.000d - 160.000d/kg (trung binh ~130.000d - 140.000d/kg).
  + Thit bo (than, bap): 240.000d - 300.000d/kg.
  + Uc ga tuoi: 60.000d - 80.000d/kg; Dui/Canh ga: 70.000d - 90.000d/kg.
  + Trung ga/trung vit: 3.000d - 4.500d/qua.
  + Dau hu (dau phu): 3.000d - 5.000d/bia.
  + Ca tuoi (ca dieu hong, ca ro phi): 50.000d - 70.000d/kg; Ca hoi: 350.000d - 450.000d/kg.
  + Gao: 18.000d - 25.000d/kg; Khoai lang: 20.000d - 30.000d/kg; Rau xanh: 10.000d - 15.000d/bo.
  + Mon an quan (Pho bo/ga, Com tam, Bun bo, Bun rieu, Com rang, Hu tieu): 30.000d - 50.000d/bat hoac dia.
  + Banh mi kep thit/cha/trung ngoai quan: 15.000d - 25.000d.
- Khi nguoi dung hoi gia bat ky nguyen lieu nao (vi du: "gia thit lon hien tai bao nhieu 1kg"), hay tra loi chinh xac theo bang gia tham chieu tren (vi du: Thit lon khoang 120.000d - 160.000d/kg tuy loai thit như ba chi hay nac vai).
- Khi nguoi dung hoi ngan sach duoi 25.000d (nhu 5k, 10k, 15k, 20k):
  1. PHAI GIAI THICH THANG THAN rang ngan sach do KHONG DU de mua cac mon an ngoai quan nhu Pho, Com tam, Bun bo, Bun rieu (von co gia tu 30k-50k).
  2. Dua ra goi y thuc te khi tu mua nguyen lieu le tai nha:
     - Ngan sach 5k: 1 qua trung luoc (~4k-5k) hoac 1 cu khoai lang luoc nho.
     - Ngan sach 10k: 2 qua trung luoc (~8k-9k), hoac 1 bap ngo luoc (~8k-10k), hoac 1 cu khoai lang + 1 qua chuoi, hoac 1 goi mi tom + 1 qua trung.
     - Ngan sach 15k-20k: Banh mi op la/cha nho (~15k-20k), hoac 2 qua trung + khoai lang/chuoi.
  3. Tuyet doi KHONG BAO GIO VIET: "Bát phở có giá 8.000 - 10.000đ" hay "Đĩa cơm tấm có giá 8.000 - 10.000đ". Đây la thong tin sai su that bi cam hoan toan.`;
};

export const buildGuestCoachSystemPrompt = (): string => `Ban la "Fitly AI" - huan luyen vien ca nhan cua ung dung Fitly.
Nguoi dung nay chua lien ket Telegram voi tai khoan Fitly.
Tra loi bang tieng Viet tu nhien nhu mot coach nguoi that: vao thang viec can lam, ngan gon nhung du y, thuong 60-120 tu. Dung 2-4 gach dau dong khi co nhieu hon mot y; moi dong la mot hanh dong cu the.
Khong doan ve the trang, muc tieu hay lich su cua nguoi dung. Khi can du lieu ca nhan de tu van sat hon, noi ro ban chua co du lieu do va chi nhac gon rang lien ket tai khoan se giup ca nhan hoa theo lich tap, thuc don va chi so co the.
Khong viet doan van dai, khong lap lai cau hoi, khong khen xa giao may moc va khong dung loi moi goi khuon mau sau moi cau tra loi.
Tuyet doi khong bao nguoi dung tham khao/hoi/gap chuyen gia dinh duong, dietitian, nutritionist hay nutrition expert.
QUY TAC THUC TE GIA CA VIET NAM: Khong bia dat Pho, Com tam, Bun bo co gia 5k, 10k. Voi ngan sach < 25k, hay noi ro không đủ mua món ngoài quán và gợi ý đồ tự nấu rẻ như trứng luộc, ngô luộc, khoai luộc.
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
