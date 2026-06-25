import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  Bot,
  Dumbbell,
  Loader2,
  Menu,
  Mic,
  Paperclip,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Utensils,
  X,
} from 'lucide-react';
import { API_BASE_URL } from '../lib/Api';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { SkeletonBlock, SkeletonSurface } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';
import {
  DEFAULT_WORKOUT_FREQUENCY,
  WORKOUT_FREQUENCY_OPTIONS,
  normalizeWorkoutFrequency,
  weeklyWorkoutsToFrequency,
  workoutFrequencyToWeeklyWorkouts,
} from '../lib/WorkoutFrequency';
import {
  DEFAULT_WORKOUT_DURATION,
  WORKOUT_DURATION_TAGS,
  normalizeWorkoutDurationTag,
} from '../lib/WorkoutDuration';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const RECENT_CHAT_LIMIT = 80;
const COACH_MENU_COMMANDS = [
  {
    command: 'menu',
    label: '/menu',
    description: 'Mở bảng điều khiển Fitly',
  },
  {
    command: 'today',
    label: '/today',
    description: 'Xem tiến độ hôm nay',
  },
  {
    command: 'workout',
    label: '/workout',
    description: 'Xem bài tập gần đây và hôm nay',
  },
  {
    command: 'meals',
    label: '/meals',
    description: 'Xem thực đơn hôm nay',
  },
  {
    command: 'health',
    label: '/health',
    description: 'Xem báo cáo sức khỏe nhỏ',
  },
  {
    command: 'water',
    label: '/water',
    description: 'Ghi nhanh lượng nước',
  },
  {
    command: 'sleep',
    label: '/sleep',
    description: 'Ghi nhanh giấc ngủ',
  },
  {
    command: 'help',
    label: '/help',
    description: 'Xem hướng dẫn sử dụng',
  },
  {
    command: 'clear',
    label: '/clear',
    description: 'Xoá ngữ cảnh trò chuyện',
  },
];
const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

type WeeklyPlan = {
  id: string;
  name: string | null;
  description: string | null;
  week_start_date?: string | null;
  updated_at?: string | null;
};

type PlanExercise = {
  id: string;
  day_of_week: number;
  exercise_id: string | null;
  sets: number | null;
  reps: string | null;
  weight_kg: number | null;
  rest_seconds: number | null;
  order_index: number;
  is_rest_day: boolean | null;
  exercises?: {
    name?: string | null;
    body_part?: string | null;
    target_muscle?: string | null;
    image_url?: string | null;
    gif_url?: string | null;
  } | null;
};

type FoodPlan = {
  id: string;
  name: string | null;
  week_start_date?: string | null;
  updated_at?: string | null;
};

type FoodPlanItem = {
  id: string;
  day_of_week: number;
  meal_type: string;
  food_id: string | null;
  quantity: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  order_index: number;
  is_rest_day: boolean | null;
  foods?: {
    name?: string | null;
    category?: string | null;
    serving_unit?: string | null;
  } | null;
};

type LifestyleSummary = {
  weekly_workouts?: number | null;
  activity_level?: string | null;
  workout_duration?: number | null;
  workout_location?: string | null;
  equipment_available?: string | null;
  experience_level?: string | null;
  fitness_goal?: string | null;
  diet_preference?: string | null;
  meals_per_day?: number | null;
  target_calories?: number | null;
  daily_water_goal?: number | null;
};

type PlanSettings = {
  activity_level: string;
  workout_duration: string;
  workout_location: string;
  equipment_available: string;
  experience_level: string;
  fitness_goal: string;
  diet_preference: string;
  meals_per_day: string;
};

const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  activity_level: DEFAULT_WORKOUT_FREQUENCY,
  workout_duration: DEFAULT_WORKOUT_DURATION,
  workout_location: 'Phòng Gym',
  equipment_available: 'Đầy đủ tạ & máy móc',
  experience_level: 'Người mới',
  fitness_goal: 'Giảm cân',
  diet_preference: 'Bình thường',
  meals_per_day: '3',
};

const PLAN_GOAL_OPTIONS = ['Giảm cân', 'Tăng cơ', 'Giữ dáng'];
const PLAN_EXPERIENCE_OPTIONS = ['Người mới', 'Đã tập dưới 6 tháng', 'Trung cấp', 'Nâng cao'];
const PLAN_LOCATION_OPTIONS = ['Phòng Gym', 'Tập tại nhà (Home Workout)'];
const PLAN_EQUIPMENT_OPTIONS = ['Đầy đủ tạ & máy móc', 'Tạ đơn & Thảm', 'Dây kháng lực', 'Không dụng cụ'];
const PLAN_DIET_OPTIONS = ['Bình thường', 'Ăn chay', 'Ăn nhiều đạm (High Protein)', 'Keto / Low Carb', 'Eat Clean'];
const PLAN_MEAL_OPTIONS = ['2', '3', '4', '5'];

type DayPlan = {
  label: string;
  dayIndex: number;
  exercises: PlanExercise[];
  meals: FoodPlanItem[];
};

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  intent?: string | null;
  responseMode?: 'plan_edit' | 'coach_advice' | 'support' | 'safety' | 'redirect';
  actionRequired?: boolean;
  actionType?: string | null;
  actionPayload?: unknown;
  adjustmentId?: string | null;
  actionStatus?: 'idle' | 'applied' | 'rejected';
  optimistic?: boolean;
  quickActions?: CoachQuickAction[];
};

type AICoachPageCache = {
  plan: WeeklyPlan | null;
  items: PlanExercise[];
  todaySessionItems: PlanExercise[];
  foodItems: FoodPlanItem[];
  lifestyle: LifestyleSummary | null;
  chatMessages: ChatMessage[];
};

const aiCoachPageCache = new Map<string, AICoachPageCache>();

type WorkoutProposalPayload = {
  day_of_week: number;
  duration_minutes: number;
  exercises: Array<{
    exercise_id?: string | null;
    name?: string;
    sets?: number;
    reps?: string;
    rest_seconds?: number;
    weight_kg?: number;
  }>;
};

type WorkoutProposalExerciseMeta = {
  id: string;
  name?: string | null;
  body_part?: string | null;
  target_muscle?: string | null;
  image_url?: string | null;
  gif_url?: string | null;
};

type MealProposalPayload = {
  day_of_week: number;
  old_weekly_food_item_id: string;
  old_food_id: string;
  old_food_name: string;
  new_food_id: string;
  new_food_name: string;
  meal_type: string;
  quantity: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  notes?: string;
};

type AIChatApiResponse = {
  code?: string;
  reply: string;
  intent: string;
  responseMode?: 'plan_edit' | 'coach_advice' | 'support' | 'safety' | 'redirect';
  actionRequired: boolean;
  actionType: string | null;
  actionPayload: unknown;
  confidence: number;
  adjustmentId?: string | null;
};

type CoachQuickAction = {
  label: string;
  command: string;
  amountMl?: number;
  sleepHours?: number;
};

type CoachCommandApiResponse = {
  command: string;
  reply: string;
  responseMode?: ChatMessage['responseMode'];
  quickActions?: CoachQuickAction[];
  clearHistory?: boolean;
};

const getDatePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === 'year')?.value || '1970',
    month: parts.find((part) => part.type === 'month')?.value || '01',
    day: parts.find((part) => part.type === 'day')?.value || '01',
  };
};

const getVietnamDateKey = (date = new Date()) => {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const getVietnamDayBoundsUtc = (dateKey = getVietnamDateKey()) => {
  const start = new Date(`${dateKey}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
};

const getWeekStartKey = (baseDate: Date) => {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return getVietnamDateKey(date);
};

const normalizeMediaUrl = (value: unknown) => {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
};

const normalizeVietnameseClient = (value: string) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const inferChatTopic = (value: string): 'meal' | 'workout' | null => {
  const normalized = normalizeVietnameseClient(value);

  const asksMeal =
    normalized.includes('an gi') ||
    normalized.includes('toi nay an') ||
    normalized.includes('trua nay an') ||
    normalized.includes('sang nay an') ||
    normalized.includes('bua') ||
    normalized.includes('mon') ||
    normalized.includes('bua an') ||
    normalized.includes('bua toi') ||
    normalized.includes('bua trua') ||
    normalized.includes('thuc don') ||
    normalized.includes('goi y mon') ||
    normalized.includes('protein') ||
    normalized.includes('dam') ||
    normalized.includes('kcal') ||
    normalized.includes('meal');

  if (asksMeal) return 'meal';

  const asksWorkout =
    normalized.includes('bai tap') ||
    normalized.includes('workout') ||
    normalized.includes('tap chan') ||
    normalized.includes('tap lung') ||
    normalized.includes('tap nguc') ||
    normalized.includes('doi bai tap') ||
    normalized.includes('thay bai tap') ||
    normalized.includes('buoi tap');

  if (asksWorkout) return 'workout';

  return null;
};

const includesAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));

const inferResponseMode = (
  intent?: string | null,
  actionType?: string | null,
): ChatMessage['responseMode'] => {
  if (actionType) return 'plan_edit';
  if (intent === 'injury_care') return 'safety';
  if (intent === 'motivation') return 'support';
  if (intent === 'out_of_scope') return 'redirect';
  return 'coach_advice';
};

const getAssistantModeLabel = (message: ChatMessage) => {
  if (message.responseMode === 'plan_edit') return 'Dieu chinh ke hoach';
  if (message.responseMode === 'support') return 'Dong luc';
  if (message.responseMode === 'safety') return 'An toan';
  if (message.responseMode === 'redirect') return 'Pham vi AI Coach';
  if (message.intent === 'recovery') return 'Phuc hoi';
  if (message.intent === 'meal_plan' || message.intent === 'workout_plan') return 'Kế hoạch hôm nay';
  return 'AI Coach';
};

const getAssistantBubbleClasses = (message: ChatMessage) => {
  if (message.responseMode === 'safety') {
    return 'border-warning/35 bg-warning/10 text-text-primary';
  }
  if (message.responseMode === 'support') {
    return 'border-info/35 bg-info/10 text-text-primary';
  }
  if (message.responseMode === 'redirect') {
    return 'border-border-primary bg-bg-secondary/55 text-text-secondary';
  }
  return 'border-border-primary bg-bg-secondary/75 text-text-secondary';
};

const isInjuryAdviceQuestion = (value: string) => {
  const normalized = normalizeVietnameseClient(value);
  if (!normalized) return false;

  const mentionsPainOrInjury = includesAny(normalized, [
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
  const mentionsBodyArea = includesAny(normalized, [
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
  const asksForCare = includesAny(normalized, [
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

const buildInjuryAdviceReply = () =>
  [
    'Có vẻ đây là đau/căng khớp cổ chân sau vận động. Trước mắt bạn nên tạm dừng các hoạt động tác động mạnh trong 24-48 giờ.',
    'Cách giảm đau an toàn: nghỉ ngơi, chườm lạnh 15-20 phút mỗi lần, băng ép nhẹ nếu có sưng, kê cao chân khi nằm/ngồi, và tránh chạy nhảy hay tập các bài dùng nhiều cổ chân.',
    'Nếu đau tăng, sưng/bầm tím rõ, không chịu lực được, tê/biến dạng khớp, hoặc 2-3 ngày không giảm, nên đi khám cơ xương khớp/chấn thương thể thao.',
  ].join('\n\n');

const isHighProteinMealQuestion = (value: string) => {
  const normalized = normalizeVietnameseClient(value);
  return (
    (normalized.includes('protein') || normalized.includes('dam')) &&
    (normalized.includes('bua') || normalized.includes('mon') || normalized.includes('an'))
  );
};

const buildHighProteinMealReply = () =>
  [
    'Một bữa nhiều protein dễ làm: 180g ức gà áp chảo hoặc cá ngừ/cá hồi, 1 chén cơm hoặc 200g khoai, thêm một phần rau lớn.',
    'Nếu muốn gọn hơn: 2 trứng + 200g sữa chua Hy Lạp không đường + 1 quả chuối + một ít yến mạch. Mục tiêu là khoảng 35-50g protein cho một bữa.',
    'Giữ dầu mỡ vừa phải, ưu tiên luộc/áp chảo/nướng để no lâu mà không đội calories quá cao.',
  ].join('\n\n');

const buildNoMealPlanSuggestionReply = (question: string, lifestyle?: LifestyleSummary | null) => {
  const normalized = normalizeVietnameseClient(question);
  const mealLabel = normalized.includes('sang')
    ? 'bữa sáng'
    : normalized.includes('toi')
      ? 'bữa tối'
      : normalized.includes('phu') || normalized.includes('snack')
        ? 'bữa phụ'
        : 'bữa trưa';

  const options =
    mealLabel === 'bữa sáng'
      ? [
          '2 trứng + 1 hũ sữa chua Hy Lạp không đường + 1 quả chuối.',
          'Yến mạch 50g + sữa ít béo + 1 muỗng whey hoặc 150g sữa chua.',
          'Bánh mì nguyên cám + ức gà hoặc cá ngừ + rau xà lách.',
        ]
      : mealLabel === 'bữa tối'
        ? [
            'Cá hồi hoặc cá thu 150g + rau luộc/xào ít dầu + 1/2 chén cơm.',
            'Ức gà áp chảo 160g + salad lớn + khoai lang 150g.',
            'Đậu phụ sốt cà chua + trứng luộc + rau xanh, tinh bột vừa phải.',
          ]
        : mealLabel === 'bữa phụ'
          ? [
              'Sữa chua Hy Lạp + chuối hoặc dâu.',
              '1 ly sữa ít béo + 1 nắm hạt nhỏ.',
              '2 trứng luộc hoặc 1 hộp cá ngừ nhỏ nếu cần thêm protein.',
            ]
          : [
              'Ức gà áp chảo 160-180g + 1 chén cơm + rau xanh.',
              'Cá ngừ/cá hồi 150g + khoai lang 200g + salad.',
              'Bò nạc 120-150g hoặc đậu phụ + cơm vừa phải + rau luộc.',
            ];

  return [
    `Mình chưa thấy thực đơn chi tiết hôm nay, nhưng vẫn có thể gợi ý ${mealLabel} ngay:`,
    options.map((item, index) => `${index + 1}. ${item}`).join('\n'),
    'Chọn 1 món theo nguyên tắc: đủ đạm, nhiều rau, tinh bột vừa phải. Nếu bạn cho mình mục tiêu hiện tại như giảm cân/tăng cơ và cân nặng, mình sẽ chỉnh khẩu phần sát hơn.',
  ].join('\n\n');
};

const buildPersonalizedNoMealPlanSuggestionReply = (question: string, lifestyle?: LifestyleSummary | null) => {
  const baseReply = buildNoMealPlanSuggestionReply(question, lifestyle);
  const goalText = normalizeVietnameseClient(lifestyle?.fitness_goal || '');
  const dietText = normalizeVietnameseClient(lifestyle?.diet_preference || '');
  const targetCalories = Number(lifestyle?.target_calories || 0);
  const mealsPerDay = Math.max(2, Math.min(5, Math.round(Number(lifestyle?.meals_per_day || 3))));
  const perMealCalories = targetCalories ? Math.round(targetCalories / mealsPerDay / 50) * 50 : 0;
  const isMuscleGain = goalText.includes('tang co') || goalText.includes('muscle');
  const isWeightLoss = goalText.includes('giam') || goalText.includes('loss');
  const isVegetarian = dietText.includes('chay') || dietText.includes('vegetarian') || dietText.includes('vegan');
  const goalNote = isMuscleGain
    ? 'Vì mục tiêu của bạn nghiêng về tăng cơ, hãy giữ mỗi bữa có 30-45g protein và thêm tinh bột quanh buổi tập.'
    : isWeightLoss
      ? 'Vì mục tiêu của bạn nghiêng về giảm cân, hãy giữ rau nhiều, protein cao và tiết chế dầu/nước sốt.'
      : 'Mình sẽ tạm giữ khẩu phần vừa phải, ưu tiên protein và rau để dễ bám kế hoạch.';
  const calorieNote = perMealCalories
    ? `Với mức ${targetCalories} kcal/ngày và ${mealsPerDay} bữa/ngày, bữa này nên xoay quanh ${perMealCalories - 100}-${perMealCalories + 100} kcal.`
    : 'Nếu cập nhật target calories, mình sẽ cân khẩu phần sát hơn.';
  const dietNote = isVegetarian ? 'Mình đang ưu tiên cách chọn món hợp chế độ ăn chay của bạn.' : '';

  return [baseReply, [goalNote, calorieNote, dietNote].filter(Boolean).join(' ')].join('\n\n');
};

const isWeekStartColumnError = (error: any) =>
  String(error?.message || '').includes('week_start_date') ||
  String(error?.details || '').includes('week_start_date') ||
  String(error?.hint || '').includes('week_start_date');

const getMealTypeLabel = (value: string) => {
  const key = String(value || '').toLowerCase();
  if (key === 'breakfast') return 'Bữa sáng';
  if (key === 'lunch') return 'Bữa trưa';
  if (key === 'dinner') return 'Bữa tối';
  if (key === 'snack') return 'Bữa phụ';
  return value || 'Bữa ăn';
};

const sumMealMetric = (meals: FoodPlanItem[], field: 'calories' | 'protein' | 'carbs' | 'fat') =>
  meals.reduce((sum, meal) => sum + Number(meal[field] || 0) * Number(meal.quantity || 1), 0);

const buildCoachOpening = (day: DayPlan) => {
  if (day.exercises.length > 0 && day.meals.length > 0) {
    return `${day.label} mình thấy bạn đã có lịch tập và thực đơn rồi. Cứ nhắn mình nếu muốn rút gọn buổi tập, đổi món, hoặc ưu tiên việc nào trước.`;
  }
  if (day.meals.length > 0) {
    return `${day.label} bạn đã có thực đơn. Nếu cần, mình có thể giúp đổi món hoặc cân lại protein cho dễ theo hơn.`;
  }
  if (day.exercises.length > 0) {
    return `${day.label} bạn có ${day.exercises.length} bài tập. Mình để sẵn ở đây để xem nhanh; cần nhẹ hơn hoặc đổi bài thì nhắn mình.`;
  }
  return `${day.label} mình chưa thấy đủ dữ liệu hôm nay. Bạn cứ nói mục tiêu hoặc tình trạng hiện tại, mình sẽ gợi ý nhanh.`;
};

const buildMealDigest = (day: DayPlan) => {
  if (day.meals.length === 0) {
    return 'Thực đơn hôm nay chưa có món nào.';
  }

  const calories = Math.round(sumMealMetric(day.meals, 'calories'));
  const protein = Math.round(sumMealMetric(day.meals, 'protein'));
  const lines = day.meals.slice(0, 4).map((meal, index) => {
    const name = meal.foods?.name || 'Món ăn';
    const type = getMealTypeLabel(meal.meal_type);
    const quantity = Number(meal.quantity || 1);
    return `${index + 1}. ${type} - ${name} x${quantity}`;
  });

  const remaining = day.meals.length - lines.length;
  if (remaining > 0) {
    lines.push(`+${remaining} món nữa`);
  }

  return `Thực đơn hôm nay có ${day.meals.length} món, ${calories} kcal và ${protein}g protein.\n${lines.join('\n')}`;
};

const isGreetingQuestion = (value: string) => {
  const normalized = normalizeVietnameseClient(value);
  if (!normalized) return false;
  const wordCount = normalized.split(' ').filter(Boolean).length;
  return wordCount <= 4 && /^(hi|hello|hey|alo|chao|xin chao|chao coach|hi coach)(\b|$)/.test(normalized);
};

const isShortFollowUpQuestion = (value: string) => {
  const normalized = normalizeVietnameseClient(value);
  if (!normalized) return false;
  return [
    'con gi nua',
    'con nua khong',
    'co gi nua',
    'gom nhung gi',
    'ke tiep di',
    'noi tiep di',
    'chi tiet hon',
    'cu the hon',
    'bai nao nua',
    'mon nao nua',
  ].includes(normalized);
};

const isWorkoutListQuestion = (value: string) => {
  const normalized = normalizeVietnameseClient(value);
  return includesAny(normalized, [
    'co nhung bai tap gi',
    'co nhung bai nao',
    'nhung bai tap gi',
    'cac bai tap gi',
    'gom nhung bai',
    'danh sach bai',
    'bai nao',
    'tap gi',
    'workout hom nay',
    'lich tap hom nay',
  ]);
};

const isMealListQuestion = (value: string) => {
  const normalized = normalizeVietnameseClient(value);
  return includesAny(normalized, [
    'co nhung mon gi',
    'mon nao',
    'an gi',
    'thuc don hom nay',
    'meal plan hom nay',
    'bua nao',
  ]);
};

const buildNaturalGreetingReply = (day: DayPlan) => {
  const workoutSummary = day.exercises.length > 0 ? `${day.exercises.length} bài tập` : 'chưa có bài tập';
  const mealSummary = day.meals.length > 0 ? `${day.meals.length} món ăn` : 'chưa có thực đơn';
  return `Chào bạn. Mình đang theo ${day.label}: ${workoutSummary} và ${mealSummary}. Bạn muốn xem danh sách bài tập, chỉnh buổi tập nhẹ hơn, hay hỏi về bữa ăn hôm nay?`;
};

const buildWorkoutListReply = (day: DayPlan) => {
  if (day.exercises.length === 0) {
    return `${day.label} hiện chưa có bài tập nào trong lịch. Bạn có thể nói mục tiêu hôm nay, ví dụ tập ngực nhẹ hoặc tập toàn thân 30 phút, mình sẽ gợi ý buổi phù hợp.`;
  }

  const totalSets = day.exercises.reduce((sum, exercise) => sum + Number(exercise.sets || 0), 0);
  const lines = day.exercises.slice(0, 6).map((exercise, index) => {
    const name = exercise.exercises?.name || 'Bài tập';
    const sets = Number(exercise.sets || 3);
    const reps = exercise.reps || '8-12';
    const rest = Number(exercise.rest_seconds || 60);
    const muscle = exercise.exercises?.target_muscle || exercise.exercises?.body_part || '';
    return `${index + 1}. ${name}: ${sets} hiệp x ${reps}${rest > 0 ? `, nghỉ ${rest}s` : ''}${muscle ? ` - ${muscle}` : ''}`;
  });
  const hiddenCount = day.exercises.length - lines.length;
  if (hiddenCount > 0) {
    lines.push(`+${hiddenCount} bài nữa trong buổi này.`);
  }

  return [
    `${day.label} có ${day.exercises.length} bài tập${totalSets > 0 ? ` và ${totalSets} sets` : ''}.`,
    lines.join('\n'),
    'Nếu muốn, mình có thể sắp lại thứ tự, rút gọn buổi tập, hoặc đổi bài theo thiết bị bạn có.',
  ].join('\n\n');
};

const buildCoachReply = (
  day: DayPlan,
  question: string,
  previousTopic?: 'meal' | 'workout' | null,
  lifestyle?: LifestyleSummary | null,
) => {
  const normalizedQuestion = question.toLowerCase();
  const normalizedIntent = normalizeVietnameseClient(question);
  const inferredTopic = inferChatTopic(question) || previousTopic || null;
  const firstExercise = day.exercises[0];
  const firstMeal = day.meals[0];
  const calories = Math.round(sumMealMetric(day.meals, 'calories'));
  const protein = Math.round(sumMealMetric(day.meals, 'protein'));

  if (isInjuryAdviceQuestion(question)) {
    return buildInjuryAdviceReply();
  }

  if (isHighProteinMealQuestion(question)) {
    return buildHighProteinMealReply();
  }

  if (isGreetingQuestion(question)) {
    return buildNaturalGreetingReply(day);
  }

  if (day.meals.length === 0 && inferredTopic === 'meal') {
    return buildPersonalizedNoMealPlanSuggestionReply(question, lifestyle);
  }

  if (
    day.exercises.length > 0 &&
    (isWorkoutListQuestion(question) || (previousTopic === 'workout' && isShortFollowUpQuestion(question)))
  ) {
    return buildWorkoutListReply(day);
  }

  if (
    day.meals.length > 0 &&
    (isMealListQuestion(question) || (previousTopic === 'meal' && isShortFollowUpQuestion(question)))
  ) {
    return buildMealDigest(day);
  }

  if (normalizedIntent.includes('chan')) {
    return 'Nếu bạn muốn tập chân, có thể ưu tiên squat, split squat, Romanian deadlift và glute bridge. Nếu đầu gối đang mỏi, hãy bắt đầu với bodyweight squat hoặc leg press nhẹ rồi tăng dần tải.';
  }

  if (normalizedIntent.includes('lung')) {
    return 'Nếu bạn muốn thêm bài cho lưng, có thể đi theo nhóm kéo ngang và kéo dọc: seated row, lat pulldown, dumbbell row và face pull.';
  }

  if (normalizedIntent.includes('nguc')) {
    return 'Nếu bạn muốn thêm bài cho ngực, có thể ưu tiên incline press, dumbbell fly, push-up và chest press máy để dễ kiểm soát tải.';
  }

  if (
    normalizedQuestion.includes('ăn') ||
    normalizedQuestion.includes('thực đơn') ||
    normalizedQuestion.includes('meal') ||
    inferredTopic === 'meal'
  ) {
    return day.meals.length > 0
      ? `${day.label} đang có ${day.meals.length} món, tổng khoảng ${calories || 0} kcal và ${protein || 0}g protein. Nếu muốn siết mỡ hơn, hãy giữ protein và cắt bớt món phụ hoặc tinh bột ở bữa tối.`
      : buildPersonalizedNoMealPlanSuggestionReply(question, lifestyle);
  }

  if (
    normalizedQuestion.includes('nhẹ') ||
    normalizedQuestion.includes('mệt') ||
    normalizedQuestion.includes('met')
  ) {
    return day.exercises.length > 0
      ? `Nếu thấy mệt ở ${day.label}, hãy giảm 1 hiệp ở mỗi bài, giữ kỹ thuật sạch và kéo nghỉ lên ${Math.max(75, Number(firstExercise?.rest_seconds || 60))} giây.`
      : `Ngày này chưa có bài tập. Bạn có thể tạo lại AI Coach để bổ sung lịch tập.`;
  }

  if (day.exercises.length > 0 && inferredTopic === 'workout') {
    return buildWorkoutListReply(day);
  }

  if (firstMeal?.foods?.name) {
    return `${day.label} hiện nghiêng về dinh dưỡng nhiều hơn vận động. Bạn có thể giữ thực đơn hiện tại và thêm cardio nhẹ hoặc đi bộ sau bữa chính.`;
  }

  return `Mình đang bám theo dữ liệu của ${day.label}. Hãy hỏi cụ thể hơn về bài tập hoặc thực đơn để mình gợi ý sát hơn.`;
};

const areChatMessagesEquivalent = (left: ChatMessage, right: ChatMessage) =>
  left.role === right.role &&
  left.content === right.content &&
  (left.actionType || null) === (right.actionType || null) &&
  !!left.actionRequired === !!right.actionRequired;

const mergeOptimisticChatMessages = (serverMessages: ChatMessage[], currentMessages: ChatMessage[]) => {
  const optimisticMessages = currentMessages.filter((message) => message.optimistic && message.role === 'user');
  if (optimisticMessages.length === 0) return serverMessages;

  const merged = [...serverMessages];
  optimisticMessages.forEach((message) => {
    if (!serverMessages.some((serverMessage) => areChatMessagesEquivalent(serverMessage, message))) {
      merged.push(message);
    }
  });

  return merged;
};

function AICoachSkeleton() {
  return (
    <div className="dashboard-page-shell flex flex-col gap-4 animate-pulse pb-4 md:gap-5 md:pb-6 lg:pb-7" aria-hidden="true">
      <section>
        <article className="ai-coach-chat-shell flex h-[calc(100dvh-8rem)] min-w-0 flex-col overflow-hidden rounded-xl border border-border-primary bg-bg-secondary text-text-primary shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
          <div className="shrink-0 border-b border-border-primary bg-bg-secondary px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-bg-tertiary/75" />
              <div className="min-w-0 flex-1">
                {SkeletonBlock('h-5 w-28 rounded-lg')}
                {SkeletonBlock('mt-2 h-3 w-44 rounded-lg')}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden bg-bg-tertiary px-5 py-5">
            <div className="flex h-full flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 h-8 w-8 shrink-0 rounded-full bg-ai/70" />
                <div className="w-full max-w-[980px] space-y-4">
                  <div className="rounded-[20px] border border-border-primary bg-bg-secondary px-4 py-4">
                    {SkeletonBlock('h-3 w-20 rounded-lg')}
                    {SkeletonBlock('mt-3 h-3 w-full rounded-lg')}
                    {SkeletonBlock('mt-2 h-3 w-[82%] rounded-lg')}
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <SkeletonSurface className="flex min-h-[280px] min-w-0 flex-col gap-4 bg-bg-secondary/80 p-4 shadow-none">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {SkeletonBlock('h-3 w-24')}
                          {SkeletonBlock('mt-4 h-6 w-[84%] rounded-xl')}
                          {SkeletonBlock('mt-3 h-4 w-[60%]')}
                        </div>
                        <div className="h-10 w-10 shrink-0 rounded-2xl bg-bg-tertiary/60" />
                      </div>

                      <div className="flex flex-1 flex-col rounded-xl border border-border-primary bg-bg-tertiary/25 p-3">
                        <div className="flex items-center justify-between gap-3">
                          {SkeletonBlock('h-3 w-20')}
                          <div className="h-6 w-12 rounded-full bg-bg-tertiary/55" />
                        </div>

                        <div className="mt-3 space-y-2.5">
                          {Array.from({ length: 3 }).map((_, index) => (
                            <div
                              key={index}
                              className="flex items-start gap-3 rounded-lg border border-border-primary/80 bg-bg-tertiary/35 px-3 py-3"
                            >
                              <div className="h-8 w-8 shrink-0 rounded-full bg-bg-secondary/90" />
                              <div className="min-w-0 flex-1">
                                {SkeletonBlock('h-4 w-[80%] rounded-lg')}
                                {SkeletonBlock('mt-2 h-3 w-20 rounded-lg')}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </SkeletonSurface>

                    <SkeletonSurface className="flex min-h-[280px] min-w-0 flex-col gap-4 bg-bg-secondary/80 p-4 shadow-none">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {SkeletonBlock('h-3 w-24')}
                          {SkeletonBlock('mt-4 h-5 w-[76%] rounded-xl')}
                          {SkeletonBlock('mt-3 h-5 w-[56%] rounded-xl')}
                        </div>
                        <div className="h-10 w-10 shrink-0 rounded-2xl bg-bg-tertiary/60" />
                      </div>

                      <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary/35 px-3 py-3"
                          >
                            <div className="h-8 w-8 shrink-0 rounded-full bg-bg-secondary/90" />
                            <div className="min-w-0 flex-1">
                              {SkeletonBlock('h-4 w-[72%] rounded-lg')}
                              {SkeletonBlock('mt-2 h-3 w-20 rounded-lg')}
                            </div>
                            <div className="h-4 w-14 shrink-0 rounded-lg bg-bg-tertiary/60" />
                          </div>
                        ))}
                      </div>
                    </SkeletonSurface>

                    <SkeletonSurface className="flex min-h-[280px] min-w-0 flex-col gap-4 bg-bg-secondary/80 p-4 shadow-none">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {SkeletonBlock('h-3 w-24')}
                          {SkeletonBlock('mt-4 h-5 w-[68%] rounded-xl')}
                        </div>
                        <div className="h-10 w-10 shrink-0 rounded-2xl bg-bg-tertiary/60" />
                      </div>

                      <div className="space-y-4">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <div key={index}>
                            <div className="mb-2 flex items-center justify-between gap-3">
                              {SkeletonBlock('h-4 w-24 rounded-lg')}
                              {SkeletonBlock('h-4 w-12 rounded-lg')}
                            </div>
                            <div className="h-2 rounded-full bg-bg-tertiary/60" />
                          </div>
                        ))}
                      </div>

                      <div className="mt-auto rounded-xl border border-border-primary bg-bg-tertiary/30 px-4 py-3">
                        {SkeletonBlock('h-3 w-full rounded-lg')}
                        {SkeletonBlock('mt-2 h-3 w-[78%] rounded-lg')}
                      </div>
                    </SkeletonSurface>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <div className="w-full max-w-[320px] rounded-[18px] bg-bg-secondary/80 px-4 py-3">
                  {SkeletonBlock('h-3 w-20 rounded-lg')}
                  {SkeletonBlock('mt-3 h-3 w-full rounded-lg')}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-1 h-8 w-8 shrink-0 rounded-full bg-ai/55" />
                <div className="w-full max-w-[560px] rounded-[18px] border border-border-primary bg-bg-secondary/80 px-4 py-3">
                  {SkeletonBlock('h-3 w-16 rounded-lg')}
                  {SkeletonBlock('mt-3 h-3 w-full rounded-lg')}
                  {SkeletonBlock('mt-2 h-3 w-[88%] rounded-lg')}
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border-primary bg-bg-tertiary px-5 pb-4 pt-4">
            <div className="flex items-center gap-3 rounded-xl border border-border-primary bg-bg-secondary px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
              {SkeletonBlock('h-4 flex-1 rounded-lg')}
              <div className="h-10 w-10 rounded-[14px] bg-bg-tertiary/60" />
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function ActionProposalCard({
  actionType,
  actionPayload,
}: {
  actionType?: string | null;
  actionPayload?: unknown;
}) {
  if (actionType === 'replace_today_workout') {
    return <WorkoutProposalCard payload={actionPayload as WorkoutProposalPayload} />;
  }

  if (actionType === 'replace_today_meal') {
    const payload = actionPayload as MealProposalPayload;
    return (
      <div className="ai-surface mt-2 rounded-xl border p-3 text-sm text-text-primary">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-ai">Đề xuất đổi món</p>
        <p className="mt-2 font-black">
          {payload?.old_food_name || 'Món cũ'} {' -> '} {payload?.new_food_name || 'Món mới'}
        </p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">
          {getMealTypeLabel(String(payload?.meal_type || 'meal'))} • {Math.round(Number(payload?.calories || 0))} kcal • {Math.round(Number(payload?.protein || 0))}g protein
        </p>
        {payload?.notes ? <p className="mt-1 text-xs text-text-secondary">{payload.notes}</p> : null}
      </div>
    );
  }

  return null;
}

function WorkoutProposalCard({ payload }: { payload: WorkoutProposalPayload }) {
  const exercises = Array.isArray(payload?.exercises) ? payload.exercises : [];
  const exerciseIds = useMemo(
    () =>
      exercises
        .map((exercise) => String(exercise.exercise_id || '').trim())
        .filter(Boolean),
    [exercises],
  );
  const [exerciseMetaById, setExerciseMetaById] = useState<Record<string, WorkoutProposalExerciseMeta>>({});

  useEffect(() => {
    let cancelled = false;

    const loadExerciseMeta = async () => {
      if (exerciseIds.length === 0) {
        setExerciseMetaById({});
        return;
      }

      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, image_url, gif_url')
        .in('id', exerciseIds);

      if (cancelled || error) return;

      const nextMap = Object.fromEntries(
        ((data as WorkoutProposalExerciseMeta[]) || []).map((item) => [String(item.id), item]),
      );
      setExerciseMetaById(nextMap);
    };

    void loadExerciseMeta();

    return () => {
      cancelled = true;
    };
  }, [exerciseIds]);

  return (
    <div className="ai-surface mt-2 rounded-xl border p-3 text-sm text-text-primary">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-ai">Đề xuất mới</p>
      <p className="mt-2 font-black">
        {Number(payload?.duration_minutes || 0)} phút, {exercises.length} bài tập
      </p>
      <p className="mt-1 text-xs font-semibold text-text-secondary">Giảm set, tăng nghỉ để phục hồi nhưng vẫn giữ nhịp tập.</p>

      <div className="mt-3 space-y-2">
        {exercises.slice(0, 4).map((exercise, index) => {
          const exerciseId = String(exercise.exercise_id || '').trim();
          const meta = exerciseId ? exerciseMetaById[exerciseId] : undefined;
          const imageUrl = meta?.image_url || meta?.gif_url || '';
          const title = meta?.name || exercise.name || exerciseId || 'Bài tập';
          const focus = meta?.body_part || meta?.target_muscle || '';

          return (
            <div key={`${exercise.exercise_id || 'exercise'}-${index}`} className="flex items-center gap-3 rounded-lg border border-border-primary/80 bg-bg-primary/35 px-3 py-3">
              <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-primary bg-bg-tertiary">
                <ExerciseThumb src={imageUrl} alt={title} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-black text-text-primary">
                  {index + 1}. {title}
                </p>
                <p className="text-sm font-semibold text-text-secondary">
                  {exercise.sets || 0} hiệp × {exercise.reps || '-'}
                </p>
                <p className="text-xs font-semibold text-text-tertiary">
                  {focus || 'Đang cập nhật nhóm cơ'}
                  {exercise.rest_seconds ? ` • Nghỉ ${exercise.rest_seconds}s` : ''}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryBubble({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ai text-white shadow-[0_10px_24px_rgb(var(--ai-rgb)_/_0.22)]">
        {icon}
      </div>
      <div className="max-w-[88%] rounded-xl border border-border-primary bg-bg-secondary px-4 py-4 text-[15px] leading-7 text-text-primary shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-ai">{title}</p>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

function ExerciseThumb({ src, alt }: { src?: string; alt: string }) {
  const candidates = useMemo(() => {
    const primary = normalizeMediaUrl(src);
    if (!primary) return [];

    const urlWithoutProtocol = primary.replace(/^https?:\/\//, '');
    const proxy = `https://images.weserv.nl/?url=${encodeURIComponent(urlWithoutProtocol)}&n=-1`;
    return [primary, proxy];
  }, [src]);

  const [candidateIndex, setCandidateIndex] = useState(0);
  const currentSrc = candidates[candidateIndex];

  useEffect(() => {
    setCandidateIndex(0);
  }, [src]);

  if (!currentSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-tertiary text-xs font-semibold text-text-tertiary">
        Không có ảnh
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className="h-full w-full object-cover"
      onError={() => {
        setCandidateIndex((index) => {
          const nextIndex = index + 1;
          return nextIndex < candidates.length ? nextIndex : index;
        });
      }}
    />
  );
}

function TodayDigestBubble({ day }: { day: DayPlan }) {
  const totalSets = day.exercises.reduce((sum, item) => sum + Number(item.sets || 0), 0);
  const mealDigest = buildMealDigest(day);

  return (
    <SummaryBubble icon={<Bot className="h-4 w-4" />} title="Hôm nay">
      <div className="space-y-3">
        <p className="font-semibold">{buildCoachOpening(day)}</p>

        <div className="space-y-2">
          {day.exercises.length === 0 ? (
            <p className="flex items-start gap-2 text-sm font-semibold text-text-secondary">
              <Dumbbell className="mt-0.5 h-4 w-4 shrink-0 text-ai" />
              <span>Hôm nay chưa có bài tập nào.</span>
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
                <Dumbbell className="h-4 w-4 text-ai" />
                {day.exercises.length} bài tập{totalSets > 0 ? `, ${totalSets} sets` : ''}
              </p>
              <div className="space-y-2">
                {day.exercises.slice(0, 4).map((item, index) => {
                  const imageUrl = item.exercises?.image_url || item.exercises?.gif_url || '';
                  return (
                    <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border-primary/80 bg-bg-primary/35 px-3 py-3">
                      <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-primary bg-bg-tertiary">
                        <ExerciseThumb src={imageUrl} alt={item.exercises?.name || 'Bài tập'} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-black text-text-primary">
                          {index + 1}. {item.exercises?.name || 'Bài tập'}
                        </p>
                        <p className="text-sm font-semibold text-text-secondary">
                          {item.sets || 3} hiệp × {item.reps || '8-12'}
                        </p>
                        <p className="text-xs font-semibold text-text-tertiary">
                          {item.exercises?.body_part || item.exercises?.target_muscle || 'Strength'}
                          {item.rest_seconds ? ` • Nghỉ ${item.rest_seconds}s` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {day.exercises.length > 4 ? (
                <p className="text-sm font-semibold text-text-secondary">+{day.exercises.length - 4} bài nữa trong buổi hôm nay.</p>
              ) : null}
            </>
          )}
        </div>

        <p className="flex items-start gap-2 whitespace-pre-line text-sm font-semibold text-text-secondary">
          <Utensils className="mt-1 h-4 w-4 shrink-0 text-ai" />
          <span>{mealDigest}</span>
        </p>
      </div>
    </SummaryBubble>
  );
}

export default function AICoach() {
  const { user, isLoggedIn, refreshTick, profile, isPremium, refreshProfile, openPremiumModal } = useAuth();
  const toast = useToast();
  const initialTodayDateKey = getVietnamDateKey();
  const initialWeekStartKey = getWeekStartKey(new Date(`${initialTodayDateKey}T00:00:00`));
  const initialCoachCache = user?.id ? aiCoachPageCache.get(`${user.id}:${initialWeekStartKey}:${initialTodayDateKey}`) || null : null;
  const [loading, setLoading] = useState(() => !initialCoachCache);
  const [, setIsRefreshingPlan] = useState(false);
  const [, setIsRefreshingChat] = useState(false);
  const [plan, setPlan] = useState<WeeklyPlan | null>(() => initialCoachCache?.plan || null);
  const [items, setItems] = useState<PlanExercise[]>(() => initialCoachCache?.items || []);
  const [todaySessionItems, setTodaySessionItems] = useState<PlanExercise[]>(() => initialCoachCache?.todaySessionItems || []);
  const [foodItems, setFoodItems] = useState<FoodPlanItem[]>(() => initialCoachCache?.foodItems || []);
  const [lifestyle, setLifestyle] = useState<LifestyleSummary | null>(() => initialCoachCache?.lifestyle || null);
  const [planSettings, setPlanSettings] = useState<PlanSettings>(() => ({ ...DEFAULT_PLAN_SETTINGS }));
  const [isPlanSettingsOpen, setIsPlanSettingsOpen] = useState(false);
  const [isSavingPlanSettings, setIsSavingPlanSettings] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<{ name: string; size: number; type: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => initialCoachCache?.chatMessages || []);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceRecognitionRef = useRef<any>(null);
  const voiceStopRequestedRef = useRef(false);
  const submitLockRef = useRef(false);
  const lastSubmitRef = useRef<{ message: string; at: number } | null>(null);
  const hasHydratedPlanRef = useRef(!!initialCoachCache);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const hasAutoScrolledChatRef = useRef(false);
  const shouldJumpToLatestRef = useRef(true);

  const todayDateKey = useMemo(() => getVietnamDateKey(), []);
  const weekStartKey = useMemo(() => getWeekStartKey(new Date(`${todayDateKey}T00:00:00`)), [todayDateKey]);
  const cacheKey = user?.id ? `${user.id}:${weekStartKey}:${todayDateKey}` : null;
  const profileCreatedAt = profile?.created_at ? new Date(profile.created_at) : null;
  const freeUsedAt = profile?.ai_coach_free_used_at ? new Date(profile.ai_coach_free_used_at) : null;
  const trialEndsAt = profileCreatedAt ? new Date(profileCreatedAt.getTime() + 7 * 24 * 60 * 60 * 1000) : null;
  const isTrialActive = !!trialEndsAt && trialEndsAt.getTime() >= Date.now();
  const canGenerateCoachPlan = isPremium || (!!profileCreatedAt && !freeUsedAt && isTrialActive);

  useEffect(() => {
    const loadPlan = async () => {
      const cached = cacheKey ? aiCoachPageCache.get(cacheKey) || null : null;
      if (!user?.id) {
        setPlan(null);
        setItems([]);
        setTodaySessionItems([]);
        setFoodItems([]);
        setLifestyle(null);
        setLoading(false);
        setIsRefreshingPlan(false);
        return;
      }

      if (cached) {
        setPlan(cached.plan);
        setItems(cached.items);
        setTodaySessionItems(cached.todaySessionItems || []);
        setFoodItems(cached.foodItems);
        setLifestyle(cached.lifestyle);
      }

      if (!hasHydratedPlanRef.current && !cached) {
        setLoading(true);
      } else if (cached) {
        setIsRefreshingPlan(true);
      }
      try {
        const lifestyleResult = await supabase
          .from('lifestyle_settings')
          .select(
            'weekly_workouts, activity_level, workout_duration, workout_location, equipment_available, experience_level, fitness_goal, diet_preference, meals_per_day, target_calories, daily_water_goal',
          )
          .eq('user_id', user.id)
          .maybeSingle();

        if (lifestyleResult.error) throw lifestyleResult.error;
        setLifestyle((lifestyleResult.data || null) as LifestyleSummary | null);

        let selectedPlan: WeeklyPlan | null = null;
        const byWeek = await supabase
          .from('weekly_plans')
          .select('id, name, description, week_start_date, updated_at')
          .eq('user_id', user.id)
          .eq('week_start_date', weekStartKey)
          .maybeSingle();

        if (byWeek.error && isWeekStartColumnError(byWeek.error)) {
          const fallback = await supabase
            .from('weekly_plans')
            .select('id, name, description, week_start_date, updated_at')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (fallback.error) throw fallback.error;
          selectedPlan = fallback.data as WeeklyPlan | null;
        } else if (byWeek.error) {
          throw byWeek.error;
        } else {
          selectedPlan = byWeek.data as WeeklyPlan | null;
        }

        setPlan(selectedPlan);

        if (!selectedPlan?.id) {
          setItems([]);
        } else {
          const planItems = await supabase
            .from('weekly_plan_exercises')
            .select(`
              *,
              exercises:exercise_id (name, body_part, target_muscle, image_url, gif_url)
            `)
            .eq('weekly_plan_id', selectedPlan.id)
            .order('day_of_week', { ascending: true })
            .order('order_index', { ascending: true });

          if (planItems.error) throw planItems.error;
          setItems((planItems.data || []) as PlanExercise[]);
        }

        const todaySessions = await supabase
          .from('daily_exercise_sessions')
          .select(`
            id,
            exercise_id,
            order_index,
            sets,
            reps,
            weight_kg,
            rest_seconds,
            exercises:exercise_id (name, body_part, target_muscle, image_url, gif_url)
          `)
          .eq('user_id', user.id)
          .eq('log_date', todayDateKey)
          .order('order_index', { ascending: true });

        if (todaySessions.error) throw todaySessions.error;
        const sessionDate = new Date(`${todayDateKey}T00:00:00`);
        const sessionDay = sessionDate.getDay();
        const sessionDayIndex = sessionDay === 0 ? 6 : sessionDay - 1;
        setTodaySessionItems(
          (todaySessions.data || []).map((session: any) => ({
            id: `daily-${String(session.id || '')}`,
            day_of_week: sessionDayIndex,
            exercise_id: session.exercise_id ? String(session.exercise_id) : null,
            sets: session.sets ?? null,
            reps: session.reps ?? null,
            weight_kg: session.weight_kg ?? null,
            rest_seconds: session.rest_seconds ?? null,
            order_index: Number(session.order_index || 0),
            is_rest_day: false,
            exercises: session.exercises || null,
          })),
        );

        const foodPlans = await supabase
          .from('weekly_food_plans')
          .select('id, name, week_start_date, updated_at')
          .eq('user_id', user.id)
          .eq('week_start_date', weekStartKey)
          .limit(20);

        if (foodPlans.error) throw foodPlans.error;

        const latestFoodPlan = (foodPlans.data || []).sort(
          (a: any, b: any) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime(),
        )[0] as FoodPlan | undefined;

        if (!latestFoodPlan?.id) {
          setFoodItems([]);
        } else {
          const foodPlanItems = await supabase
            .from('weekly_food_items')
            .select('*, foods:food_id (name, category, serving_unit)')
            .eq('food_plan_id', latestFoodPlan.id)
            .order('day_of_week', { ascending: true })
            .order('order_index', { ascending: true });

          if (foodPlanItems.error) throw foodPlanItems.error;
          setFoodItems((foodPlanItems.data || []) as FoodPlanItem[]);
        }
      } catch (err: any) {
        toast.error(err?.message || 'Không thể tải kế hoạch từ AI Coach.');
      } finally {
        hasHydratedPlanRef.current = true;
        setLoading(false);
        setIsRefreshingPlan(false);
      }
    };

    void loadPlan();
  }, [user?.id, refreshTick, weekStartKey, reloadKey, cacheKey]);

  useEffect(() => {
    const nextFrequency = normalizeWorkoutFrequency(
      lifestyle?.activity_level || weeklyWorkoutsToFrequency(lifestyle?.weekly_workouts),
    );

    setPlanSettings((current) => ({
      ...current,
      activity_level: nextFrequency,
      workout_duration: normalizeWorkoutDurationTag(lifestyle?.workout_duration || current.workout_duration),
      workout_location: lifestyle?.workout_location || current.workout_location,
      equipment_available: lifestyle?.equipment_available || current.equipment_available,
      experience_level: lifestyle?.experience_level || current.experience_level,
      fitness_goal: lifestyle?.fitness_goal || current.fitness_goal,
      diet_preference: lifestyle?.diet_preference || current.diet_preference,
      meals_per_day: lifestyle?.meals_per_day ? String(lifestyle.meals_per_day) : current.meals_per_day,
    }));
  }, [lifestyle]);

  const generateCoachPlan = async () => {
    if (!user?.id) return;
    setIsGenerating(true);

    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token;
      if (!accessToken) throw new Error('Missing access token');

      const response = await fetch(`${API_BASE_URL}/api/ai-coach/generate-weekly-plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ weekStartDate: weekStartKey }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Không thể tạo kế hoạch từ AI Coach.');
      }
      await refreshProfile();
      setReloadKey((value) => value + 1);
    } catch (err: any) {
      const message =
        err instanceof TypeError
          ? 'Không thể kết nối tới AI Coach. Kiểm tra backend, VITE_API_URL hoặc CORS.'
          : err?.message || 'Không thể tạo kế hoạch từ AI Coach.';
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlanSettingsChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const name = event.target.name as keyof PlanSettings;
    const value = event.target.value;
    setPlanSettings((current) => ({ ...current, [name]: value }));
  };

  const savePlanSettings = async (mode: 'save' | 'regenerate') => {
    if (!user?.id) return;
    setIsSavingPlanSettings(true);

    const normalizedFrequency = normalizeWorkoutFrequency(planSettings.activity_level);
    const normalizedDuration = normalizeWorkoutDurationTag(planSettings.workout_duration);
    const mealsPerDay = Math.max(2, Math.min(5, Number(planSettings.meals_per_day) || 3));
    const payload: LifestyleSummary & { user_id: string; updated_at: string } = {
      user_id: user.id,
      activity_level: normalizedFrequency,
      weekly_workouts: workoutFrequencyToWeeklyWorkouts(normalizedFrequency),
      workout_duration: Number(normalizedDuration),
      workout_location: planSettings.workout_location,
      equipment_available: planSettings.equipment_available,
      experience_level: planSettings.experience_level,
      fitness_goal: planSettings.fitness_goal,
      diet_preference: planSettings.diet_preference,
      meals_per_day: mealsPerDay,
      updated_at: new Date().toISOString(),
    };

    try {
      const { error: saveError } = await supabase.from('lifestyle_settings').upsert(payload);
      if (saveError) throw saveError;

      setLifestyle(payload);
      await refreshProfile();
      setReloadKey((value) => value + 1);

      if (mode === 'regenerate') {
        if (canGenerateCoachPlan) {
          await generateCoachPlan();
        } else {
          openPremiumModal();
        }
      }
      setIsPlanSettingsOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu cài đặt kế hoạch.');
    } finally {
      setIsSavingPlanSettings(false);
    }
  };

  const todayDayIndex = useMemo(() => {
    const today = new Date(`${todayDateKey}T00:00:00`);
    const day = today.getDay();
    return day === 0 ? 6 : day - 1;
  }, [todayDateKey]);

  const days = useMemo<DayPlan[]>(
    () =>
      DAY_LABELS.map((label, dayIndex) => {
        const planExercises = items.filter((item) => item.day_of_week === dayIndex && !item.is_rest_day);
        return {
          label,
          dayIndex,
          exercises: dayIndex === todayDayIndex && todaySessionItems.length > 0 ? todaySessionItems : planExercises,
          meals: foodItems.filter((item) => item.day_of_week === dayIndex && !item.is_rest_day),
        };
      }),
    [items, todaySessionItems, foodItems, todayDayIndex],
  );

  const selectedDay = days[todayDayIndex] || days[0];
  useEffect(() => {
    const fetchChat = async () => {
      const cached = cacheKey ? aiCoachPageCache.get(cacheKey) || null : null;
      if (!user?.id) {
        shouldJumpToLatestRef.current = true;
        hasAutoScrolledChatRef.current = false;
        setChatMessages([]);
        setIsRefreshingChat(false);
        return;
      }

      shouldJumpToLatestRef.current = true;
      hasAutoScrolledChatRef.current = false;
      if (cached) {
        setChatMessages(cached.chatMessages);
        setIsRefreshingChat(true);
      }
      const chatDayBounds = getVietnamDayBoundsUtc(todayDateKey);

      const chatRes = await supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', chatDayBounds.startIso)
        .lt('created_at', chatDayBounds.endIso)
        .order('created_at', { ascending: false })
        .limit(RECENT_CHAT_LIMIT);

      if (chatRes.error || !chatRes.data || chatRes.data.length === 0) {
        setChatMessages((current) => {
          const optimisticMessages = current.filter((message) => message.optimistic);
          return optimisticMessages.length > 0 ? optimisticMessages : [];
        });
        setIsRefreshingChat(false);
        return;
      }

      const orderedChatData = [...(chatRes.data as any[])].reverse();
      const chatIds = orderedChatData.map((item: any) => String(item.id || '')).filter(Boolean);
      const adjustmentRes = chatIds.length > 0
        ? await supabase
            .from('ai_plan_adjustments')
            .select('id, chat_message_id, status')
            .eq('user_id', user.id)
            .eq('source_type', 'chat')
            .in('chat_message_id', chatIds)
        : { data: [], error: null };

      const adjustmentByChatId = new Map(
        ((adjustmentRes.data as any[]) || []).map((item: any) => [
          String(item.chat_message_id || ''),
          {
            id: String(item.id || ''),
            status: item.status === 'applied' || item.status === 'rejected' ? item.status : 'idle',
          },
        ]),
      );

      const serverMessages = orderedChatData.map((item) => {
        const linkedAdjustment = adjustmentByChatId.get(String(item.id || ''));
        const role = item.role as ChatMessage['role'];
        const content = String(item.content || '');
        return {
          id: String(item.id || ''),
          role,
          content,
          intent: item.intent || null,
          responseMode: inferResponseMode(item.intent, item.action_type),
          actionRequired: !!item.action_type,
          actionType: item.action_type || null,
          actionPayload: item.action_payload,
          adjustmentId: linkedAdjustment?.id || null,
          actionStatus: linkedAdjustment?.status || 'idle',
          optimistic: false,
        } as ChatMessage;
      });

      setChatMessages((current) => mergeOptimisticChatMessages(serverMessages, current));
      setIsRefreshingChat(false);
    };

    void fetchChat();
  }, [user?.id, reloadKey, todayDateKey, cacheKey]);

  useLayoutEffect(() => {
    if (loading || !isLoggedIn) return;

    const container = chatScrollRef.current;
    const content = chatContentRef.current;
    const bottom = chatBottomRef.current;
    if (!container || !content || !bottom) return;

    const shouldJumpToLatest = shouldJumpToLatestRef.current || !hasAutoScrolledChatRef.current;
    const behavior: ScrollBehavior = shouldJumpToLatest ? 'auto' : 'smooth';
    let resizeObserver: ResizeObserver | null = null;
    let resizeObserverStopId: number | null = null;
    const frameIds: number[] = [];
    const timeoutIds: number[] = [];

    const scrollToBottom = () => {
      container.scrollTop = container.scrollHeight;
      bottom.scrollIntoView({
        block: 'end',
        behavior,
      });
    };

    const queueScroll = () => {
      const frameId = window.requestAnimationFrame(scrollToBottom);
      frameIds.push(frameId);
    };

    queueScroll();
    timeoutIds.push(window.setTimeout(queueScroll, 0));
    timeoutIds.push(window.setTimeout(queueScroll, 120));
    timeoutIds.push(window.setTimeout(queueScroll, 320));

    if (shouldJumpToLatest && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        container.scrollTop = container.scrollHeight;
      });
      resizeObserver.observe(content);
      resizeObserverStopId = window.setTimeout(() => {
        resizeObserver?.disconnect();
      }, 900);
    }

    hasAutoScrolledChatRef.current = true;
    shouldJumpToLatestRef.current = false;

    return () => {
      frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      if (resizeObserverStopId !== null) {
        window.clearTimeout(resizeObserverStopId);
      }
      resizeObserver?.disconnect();
    };
  }, [chatMessages, selectedDay.dayIndex, loading, isLoggedIn, plan?.id]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  useEffect(() => {
    if (!isComposerMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && composerRootRef.current?.contains(target)) return;
      setIsComposerMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isComposerMenuOpen]);

  useEffect(() => {
    if (!cacheKey) return;
    aiCoachPageCache.set(cacheKey, {
      plan,
      items,
      todaySessionItems,
      foodItems,
      lifestyle,
      chatMessages
    });
  }, [cacheKey, plan, items, todaySessionItems, foodItems, lifestyle, chatMessages]);

  const handleAdjustmentAction = async (messageId: string, adjustmentId: string, action: 'apply' | 'reject') => {
    if (!user?.id) return;
    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token;
      if (!accessToken) throw new Error('Missing access token');
      const endpoint = action === 'apply' ? '/api/ai/apply-adjustment' : '/api/ai/reject-adjustment';
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(action === 'apply' ? { 'Idempotency-Key': `apply-${adjustmentId}` } : {}),
        },
        body: JSON.stringify({ adjustmentId }),
      });
      if (!response.ok) throw new Error('Action failed');

      setChatMessages((current) =>
        current.map((item) =>
          item.id === messageId ? { ...item, actionStatus: action === 'apply' ? 'applied' : 'rejected' } : item,
        ),
      );
      shouldJumpToLatestRef.current = true;
      setReloadKey((value) => value + 1);
    } catch {
      toast.error('Không thể cập nhật đề xuất lúc này. Vui lòng thử lại.');
    }
  };

  const formatAttachmentSize = (size: number) => {
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  };

  const applyQuickPrompt = (prompt: string) => {
    setChatInput(prompt);
    setIsComposerMenuOpen(false);
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
  };

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedAttachment({ name: file.name, size: file.size, type: file.type || 'file' });
    setIsComposerMenuOpen(false);
    event.target.value = '';
  };

  const startVoiceInput = () => {
    if (isListening || isSendingChat) return;
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      toast.warning('Trinh duyet hien tai chua ho tro ghi am thanh van ban.');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    voiceStopRequestedRef.current = false;
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
      if (transcript) {
        setChatInput((current) => `${current}${current ? ' ' : ''}${transcript}`);
      }
    };
    recognition.onerror = () => {
      if (!voiceStopRequestedRef.current) {
        toast.error('Không thể nhận diện giọng nói lúc này.');
      }
    };
    recognition.onend = () => {
      setIsListening(false);
      voiceRecognitionRef.current = null;
      window.requestAnimationFrame(() => chatInputRef.current?.focus());
    };
    voiceRecognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const stopVoiceInput = () => {
    if (!voiceRecognitionRef.current) return;
    voiceStopRequestedRef.current = true;
    try {
      voiceRecognitionRef.current.stop();
    } catch {
      voiceRecognitionRef.current = null;
      setIsListening(false);
    }
  };

  const submitCoachCommand = async (
    command: string,
    options?: { amountMl?: number; sleepHours?: number },
  ) => {
    if (!user?.id || isSendingChat) return;
    const normalizedCommand = String(command || '').replace(/^\//, '').trim().toLowerCase();
    if (!normalizedCommand) return;

    const visibleCommand = options?.amountMl
      ? `/water +${Math.round(Number(options.amountMl))}ml`
      : options?.sleepHours
        ? `/sleep ${Number(options.sleepHours)}h`
        : `/${normalizedCommand}`;

    const userMessage: ChatMessage = {
      id: `user-command-${Date.now()}`,
      role: 'user',
      content: visibleCommand,
      responseMode: 'coach_advice',
      optimistic: true,
    };

    setChatInput('');
    setSelectedAttachment(null);
    setIsComposerMenuOpen(false);
    setIsSendingChat(true);
    shouldJumpToLatestRef.current = true;
    setChatMessages((current) => [...current, userMessage]);

    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token;
      if (!accessToken) throw new Error('Missing access token');

      const response = await fetch(`${API_BASE_URL}/api/ai/coach-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          command: normalizedCommand,
          amountMl: options?.amountMl,
          sleepHours: options?.sleepHours,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<CoachCommandApiResponse>;
      if (!response.ok) {
        throw new Error(payload?.reply || 'Không thể chạy lệnh AI Coach.');
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-command-${Date.now() + 1}`,
        role: 'assistant',
        content: String(payload.reply || '').trim() || 'Mình đã xử lý lệnh này.',
        intent: `coach_command:${payload.command || normalizedCommand}`,
        responseMode: payload.responseMode || 'coach_advice',
        quickActions: payload.quickActions || [],
        optimistic: true,
      };

      shouldJumpToLatestRef.current = true;
      if (payload.clearHistory) {
        setChatMessages([assistantMessage]);
      } else {
        setChatMessages((current) => [...current, assistantMessage]);
      }
      setReloadKey((value) => value + 1);
    } catch {
      const fallbackMessage: ChatMessage = {
        id: `assistant-command-${Date.now() + 1}`,
        role: 'assistant',
        content: 'Mình chưa chạy được lệnh này. Bạn thử lại sau một chút.',
        responseMode: 'coach_advice',
        optimistic: true,
      };
      shouldJumpToLatestRef.current = true;
      setChatMessages((current) => [...current, fallbackMessage]);
    } finally {
      setIsSendingChat(false);
    }
  };

  const submitChat = async (messageText?: string) => {
    const rawMessage = String(messageText ?? chatInput).trim();
    const attachmentContext = selectedAttachment
      ? `\n\n[Attached file: ${selectedAttachment.name} (${formatAttachmentSize(selectedAttachment.size)}, ${selectedAttachment.type})]`
      : '';
    const message = `${rawMessage}${attachmentContext}`.trim();
    if (!message || !selectedDay || !user?.id) return;
    if (submitLockRef.current) return;

    const now = Date.now();
    if (
      lastSubmitRef.current &&
      lastSubmitRef.current.message === message &&
      now - lastSubmitRef.current.at < 1500
    ) {
      return;
    }

    submitLockRef.current = true;
    lastSubmitRef.current = { message, at: now };
    setChatInput('');
    setSelectedAttachment(null);
    setIsComposerMenuOpen(false);
    setIsSendingChat(true);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      responseMode: 'coach_advice',
      optimistic: true,
    };

    const previousTopic = [...chatMessagesRef.current]
      .reverse()
      .map((item) => inferChatTopic(item.content))
      .find((topic): topic is 'meal' | 'workout' => topic === 'meal' || topic === 'workout') || null;
    const clientHistory = chatMessagesRef.current
      .filter((item) => (item.role === 'user' || item.role === 'assistant') && item.content.trim())
      .slice(-10)
      .map((item) => ({
        role: item.role,
        content: item.content.slice(0, 1200),
      }));

    shouldJumpToLatestRef.current = true;
    setChatMessages((current) => [...current, userMessage]);

    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token;
      if (!accessToken) throw new Error('Missing access token');
      const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message,
          selectedDayIndex: selectedDay.dayIndex,
          weekStartDate: weekStartKey,
          clientHistory,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<AIChatApiResponse>;
      if (!response.ok) {
        if (payload?.code === 'PREMIUM_REQUIRED') {
          openPremiumModal();
        }
        throw new Error(payload?.reply || 'Không thể gửi tin nhắn tới AI Coach.');
      }

      const replyContent = String(payload.reply || '').trim() || buildCoachReply(selectedDay, message, previousTopic, lifestyle);
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        content: replyContent,
        intent: payload.intent || null,
        responseMode: payload.responseMode || inferResponseMode(payload.intent, payload.actionType),
        actionRequired: !!payload.actionRequired,
        actionType: payload.actionType || null,
        actionPayload: payload.actionPayload,
        adjustmentId: payload.adjustmentId || null,
        actionStatus: 'idle',
        optimistic: true,
      };
      shouldJumpToLatestRef.current = true;
      setChatMessages((current) => [...current, assistantMessage]);
      setReloadKey((value) => value + 1);
    } catch {
      const fallbackMessage: ChatMessage = {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        content: buildCoachReply(selectedDay, message, previousTopic, lifestyle),
        responseMode: 'coach_advice',
        optimistic: true,
      };
      shouldJumpToLatestRef.current = true;
      setChatMessages((current) => [...current, fallbackMessage]);
    } finally {
      submitLockRef.current = false;
      setIsSendingChat(false);
    }
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if ((!chatInput.trim() && !selectedAttachment) || isSendingChat) return;
    void submitChat();
  };

  if (loading) return <AICoachSkeleton />;

  return (
    <div className="contents xl:flex xl:flex-col xl:gap-5">
      <div className="-mt-1 w-full space-y-4 text-sm text-text-primary">
        <section>
            <article className="ai-coach-chat-shell flex h-[calc(100dvh-8rem)] min-w-0 flex-col overflow-hidden rounded-xl border border-border-primary bg-bg-secondary text-text-primary shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
              <div className="shrink-0 border-b border-border-primary bg-bg-secondary px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-primary">
                      <Bot className="h-3.5 w-3.5" />
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg-secondary bg-ai" />
                    </div>
                    <div>
                      <p className="text-xl font-black leading-none text-text-primary">AI Coach</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-text-secondary">
                        {plan ? 'Chat, bài tập và thực đơn trong ngày' : 'Chat trước, tạo kế hoạch khi bạn sẵn sàng'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPlanSettingsOpen(true)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-xs font-black text-text-primary transition-colors hover:border-ai/40 hover:text-ai sm:w-auto sm:gap-2 sm:px-3"
                    aria-label="Cài đặt kế hoạch"
                  >
                    <Settings2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Cài đặt kế hoạch</span>
                  </button>
                </div>
              </div>

              <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-bg-tertiary px-5 py-5">
                <div ref={chatContentRef} className="space-y-4">
                  <TodayDigestBubble day={selectedDay} />

                  {chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex items-start gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {message.role === 'assistant' ? (
                        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ai/90 text-white shadow-[0_8px_18px_rgb(var(--ai-rgb)_/_0.18)]">
                          <Bot className="h-3.5 w-3.5" />
                        </div>
                      ) : null}
                      <div className={message.role === 'user' ? 'ai-chat-bubble-wrap max-w-[72%]' : 'ai-chat-bubble-wrap max-w-[76%]'}>
                        <div
                          className={`whitespace-pre-line break-words rounded-[18px] border px-4 py-3 text-sm font-normal leading-6 shadow-none ${
                            message.role === 'user'
                              ? 'border-accent bg-accent text-text-inverse'
                              : getAssistantBubbleClasses(message)
                          }`}
                        >
                          {message.role === 'assistant' ? (
                            <p className="mb-1 text-[11px] font-black uppercase tracking-[0.12em] text-ai">
                              {getAssistantModeLabel(message)}
                            </p>
                          ) : null}
                          {message.content}
                        </div>
                        {message.role === 'assistant' && message.actionRequired ? (
                          <ActionProposalCard actionType={message.actionType} actionPayload={message.actionPayload} />
                        ) : null}
                        {message.role === 'assistant' && message.actionRequired && message.adjustmentId ? (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleAdjustmentAction(message.id, message.adjustmentId as string, 'apply')}
                              disabled={message.actionStatus !== 'idle'}
                              className="rounded-full bg-accent px-3 py-1.5 text-xs font-black text-text-inverse disabled:opacity-60"
                            >
                              {message.actionStatus === 'applied' ? 'Đã áp dụng' : 'Áp dụng thay đổi'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAdjustmentAction(message.id, message.adjustmentId as string, 'reject')}
                              disabled={message.actionStatus !== 'idle'}
                              className="rounded-full border border-border-primary bg-bg-secondary px-3 py-1.5 text-xs font-black text-text-secondary disabled:opacity-60"
                            >
                              {message.actionStatus === 'rejected' ? 'Đã bỏ qua' : 'Không áp dụng'}
                            </button>
                          </div>
                        ) : null}
                        {message.role === 'assistant' && message.quickActions?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {message.quickActions.map((action, index) => (
                              <button
                                key={`${action.command}-${action.label}-${index}`}
                                type="button"
                                onClick={() => {
                                  void submitCoachCommand(action.command, {
                                    amountMl: action.amountMl,
                                    sleepHours: action.sleepHours,
                                  });
                                }}
                                disabled={isSendingChat}
                                className="rounded-full border border-border-primary bg-bg-secondary px-3 py-1.5 text-xs font-black text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-60"
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  {isSendingChat ? (
                    <div className="flex items-start gap-3 justify-start">
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ai/90 text-white shadow-[0_8px_18px_rgb(var(--ai-rgb)_/_0.18)]">
                        <Bot className="h-3.5 w-3.5" />
                      </div>
                      <div className="ai-chat-bubble-wrap max-w-[76%]">
                        <div className="rounded-[18px] border border-border-primary bg-bg-secondary/75 px-4 py-3 text-sm font-normal leading-6 text-text-secondary shadow-none">
                          <p className="mb-1 text-[11px] font-black uppercase tracking-[0.12em] text-ai">
                            AI Coach
                          </p>
                          <div className="flex h-5 items-center gap-1" aria-label="AI Coach đang soạn">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ai [animation-delay:-0.2s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ai [animation-delay:-0.1s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ai" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div ref={chatBottomRef} className="h-px w-full" />
                </div>
              </div>

              <div ref={composerRootRef} className="relative shrink-0 border-t border-border-primary bg-bg-tertiary px-3 pb-2 pt-2 sm:px-5">
                {isComposerMenuOpen ? (
                  <div className="absolute inset-x-0 bottom-full z-20 max-h-56 overflow-y-auto border-t border-border-primary bg-bg-secondary shadow-[0_-18px_42px_rgba(0,0,0,0.10)]">
                    <div className="py-1">
                      {COACH_MENU_COMMANDS.map((item) => (
                        <button
                          key={item.command}
                          type="button"
                          onClick={() => {
                            setIsComposerMenuOpen(false);
                            void submitCoachCommand(item.command);
                          }}
                          className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-tertiary"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-primary ring-1 ring-border-primary">
                            <img src="/logo.svg" alt="" className="h-5 w-5 object-contain" />
                          </span>
                          <span className="min-w-0">
                            <span className="font-mono text-sm font-black text-text-primary">{item.label}</span>
                            <span className="ml-2 text-sm font-semibold text-text-tertiary group-hover:text-text-secondary">
                              {item.description}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedAttachment ? (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl border border-border-primary bg-bg-secondary px-3 py-2 text-xs font-semibold text-text-secondary">
                    <span className="min-w-0 truncate">
                      {selectedAttachment.name} - {formatAttachmentSize(selectedAttachment.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedAttachment(null)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                      aria-label="Bo tep dinh kem"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleAttachmentChange}
                />
                <div className="ai-chat-composer flex min-h-11 items-center gap-1.5 rounded-full border border-border-primary bg-bg-secondary px-2 py-1.5 shadow-[0_8px_18px_rgba(15,23,42,0.05)] sm:gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsComposerMenuOpen((value) => !value);
                    }}
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-info px-2.5 text-[11px] font-black text-white transition-colors hover:bg-info/90 sm:px-3"
                    aria-label="Mở menu AI Coach"
                  >
                    <Menu className="h-3.5 w-3.5 sm:hidden" />
                    <span className="hidden sm:inline">Menu</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                    aria-label="Đính kèm tệp"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    rows={1}
                    placeholder="Nhắn tin cho AI Coach hôm nay..."
                    className="max-h-24 min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-sm font-semibold text-text-primary outline-none placeholder:text-text-tertiary"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (chatInput.trim() || selectedAttachment) void submitChat();
                    }}
                    onPointerDown={(event) => {
                      if (chatInput.trim() || selectedAttachment || isSendingChat) return;
                      event.preventDefault();
                      startVoiceInput();
                    }}
                    onPointerUp={() => stopVoiceInput()}
                    onPointerCancel={() => stopVoiceInput()}
                    onPointerLeave={() => stopVoiceInput()}
                    disabled={isSendingChat}
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                      chatInput.trim() || selectedAttachment || isSendingChat
                        ? 'bg-ai text-white hover:bg-ai-hover disabled:cursor-not-allowed disabled:opacity-60'
                        : isListening
                          ? 'bg-danger/10 text-danger'
                          : 'text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary'
                    }`}
                    aria-label={chatInput.trim() ? 'Gửi tin nhắn' : 'Ghi âm'}
                  >
                    {isSendingChat ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : chatInput.trim() || selectedAttachment ? (
                      <Send className="h-3.5 w-3.5" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </article>
          </section>
        {isPlanSettingsOpen ? (
          <div className="responsive-sheet-backdrop fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5">
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setIsPlanSettingsOpen(false)}
            />
            <form
              className="responsive-sheet-panel relative flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary text-text-primary shadow-[0_28px_90px_rgba(0,0,0,0.42)]"
              onSubmit={(event) => {
                event.preventDefault();
                void savePlanSettings('save');
              }}
            >
              <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border-primary bg-bg-tertiary/70 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-ai" />
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-ai">AI Coach</p>
                  </div>
                  <h2 className="mt-1 text-xl font-black text-text-primary">Cài đặt kế hoạch</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPlanSettingsOpen(false)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-secondary text-text-tertiary transition-colors hover:text-text-primary"
                  aria-label="Đóng cài đặt kế hoạch"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Số buổi/tuần</span>
                    <select
                      name="activity_level"
                      value={normalizeWorkoutFrequency(planSettings.activity_level)}
                      onChange={handlePlanSettingsChange}
                      className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
                    >
                      {WORKOUT_FREQUENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Thời lượng/buổi</span>
                    <select
                      name="workout_duration"
                      value={normalizeWorkoutDurationTag(planSettings.workout_duration)}
                      onChange={handlePlanSettingsChange}
                      className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
                    >
                      {WORKOUT_DURATION_TAGS.map((minutes) => (
                        <option key={minutes} value={String(minutes)}>
                          {minutes} phút
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Mục tiêu</span>
                    <select
                      name="fitness_goal"
                      value={planSettings.fitness_goal}
                      onChange={handlePlanSettingsChange}
                      className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
                    >
                      {PLAN_GOAL_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Trình độ</span>
                    <select
                      name="experience_level"
                      value={planSettings.experience_level}
                      onChange={handlePlanSettingsChange}
                      className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
                    >
                      {PLAN_EXPERIENCE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Nơi tập</span>
                    <select
                      name="workout_location"
                      value={planSettings.workout_location}
                      onChange={handlePlanSettingsChange}
                      className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
                    >
                      {PLAN_LOCATION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Dụng cụ</span>
                    <select
                      name="equipment_available"
                      value={planSettings.equipment_available}
                      onChange={handlePlanSettingsChange}
                      className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
                    >
                      {PLAN_EQUIPMENT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Chế độ ăn</span>
                    <select
                      name="diet_preference"
                      value={planSettings.diet_preference}
                      onChange={handlePlanSettingsChange}
                      className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
                    >
                      {PLAN_DIET_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Số bữa/ngày</span>
                    <select
                      name="meals_per_day"
                      value={planSettings.meals_per_day}
                      onChange={handlePlanSettingsChange}
                      className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
                    >
                      {PLAN_MEAL_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option} bữa
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <footer className="flex shrink-0 flex-col gap-2 border-t border-border-primary bg-bg-tertiary/70 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
                <button
                  type="button"
                  onClick={() => setIsPlanSettingsOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-border-primary bg-bg-secondary px-4 text-xs font-black text-text-secondary transition-colors hover:text-text-primary"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSavingPlanSettings}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-4 text-xs font-black text-text-primary transition-colors hover:border-ai/40 hover:text-ai disabled:opacity-60"
                >
                  {isSavingPlanSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => void savePlanSettings('regenerate')}
                  disabled={isSavingPlanSettings || isGenerating}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-ai px-4 text-xs font-black text-white transition-colors hover:bg-ai-hover disabled:opacity-60"
                >
                  {isSavingPlanSettings || isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Lưu & tạo lại
                </button>
              </footer>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
