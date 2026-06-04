import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Bot,
  Dumbbell,
  Loader2,
  Send,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { API_BASE_URL } from '../lib/Api';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
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
};

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
  actionRequired?: boolean;
  actionType?: string | null;
  actionPayload?: unknown;
  adjustmentId?: string | null;
  actionStatus?: 'idle' | 'applied' | 'rejected';
};

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
  actionRequired: boolean;
  actionType: string | null;
  actionPayload: unknown;
  confidence: number;
  adjustmentId?: string | null;
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

const getVietnamDayUtcRange = (date = new Date()) => {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  const startUtc = new Date(`${year}-${month}-${day}T00:00:00+07:00`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
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
    normalized.includes('bua an') ||
    normalized.includes('bua toi') ||
    normalized.includes('bua trua') ||
    normalized.includes('thuc don') ||
    normalized.includes('goi y mon') ||
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

const getDayHeadline = (day: DayPlan) => {
  if (day.exercises.length > 0) {
    return day.exercises[0]?.exercises?.body_part || day.exercises[0]?.exercises?.target_muscle || 'Buổi tập hôm nay';
  }
  return 'Chưa có lịch hôm nay';
};

const buildCoachOpening = (day: DayPlan) => {
  if (day.exercises.length > 0 && day.meals.length > 0) {
    return `Mình đã mở sẵn workout và meal plan của ${day.label}. Bạn có thể nhắn để đổi món, giảm độ nặng, hoặc tối ưu lại theo mục tiêu hôm nay.`;
  }
  if (day.meals.length > 0) {
    return `${day.label} đang có meal plan sẵn. Nếu cần, mình sẽ gợi ý thêm vận động nhẹ hoặc đổi món cho sát mục tiêu hơn.`;
  }
  if (day.exercises.length > 0) {
    return `${day.label} đang có workout sẵn. Nếu cần, mình sẽ làm buổi tập gọn hơn, nhẹ hơn, hoặc đổi bài cho phù hợp thể trạng hôm nay.`;
  }
  return `${day.label} hiện chưa có đủ dữ liệu. Bạn có thể tạo lại kế hoạch hoặc nói rõ tình trạng hôm nay để mình gợi ý cách bổ sung workout và meal plan.`;
};

const buildMealDigest = (day: DayPlan) => {
  if (day.meals.length === 0) {
    return 'Meal plan hôm nay chưa có món nào.';
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

  return `Meal plan hôm nay có ${day.meals.length} món, ${calories} kcal và ${protein}g protein.\n${lines.join('\n')}`;
};

const buildCoachReply = (day: DayPlan, question: string, previousTopic?: 'meal' | 'workout' | null) => {
  const normalizedQuestion = question.toLowerCase();
  const normalizedIntent = normalizeVietnameseClient(question);
  const inferredTopic = inferChatTopic(question) || previousTopic || null;
  const firstExercise = day.exercises[0];
  const firstMeal = day.meals[0];
  const calories = Math.round(sumMealMetric(day.meals, 'calories'));
  const protein = Math.round(sumMealMetric(day.meals, 'protein'));

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
      : `${day.label} chưa có thực đơn chi tiết. Nên ưu tiên 1 nguồn đạm nạc, 1 phần rau lớn và tinh bột vừa phải quanh buổi tập.`;
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
    return `Cho ${day.label}, mình ưu tiên ${getDayHeadline(day).toLowerCase()}. Bắt đầu bằng ${firstExercise?.exercises?.name || 'bài chính'}, giữ ${firstExercise?.sets || 3} hiệp x ${firstExercise?.reps || '8-12'} reps rồi theo dõi cảm giác để tăng hoặc giảm tải.`;
  }

  if (firstMeal?.foods?.name) {
    return `${day.label} hiện nghiêng về dinh dưỡng nhiều hơn vận động. Bạn có thể giữ meal plan hiện tại và thêm cardio nhẹ hoặc đi bộ sau bữa chính.`;
  }

  return `Mình đang bám theo dữ liệu của ${day.label}. Hãy hỏi cụ thể hơn về bài tập hoặc thực đơn để mình gợi ý sát hơn.`;
};

const shouldPreferLocalReply = (question: string, payload: Partial<AIChatApiResponse>) => {
  const normalized = normalizeVietnameseClient(question);
  const normalizedReply = normalizeVietnameseClient(String(payload.reply || ''));
  const asksMeal =
    normalized.includes('an gi') ||
    normalized.includes('toi nay an') ||
    normalized.includes('trua nay an') ||
    normalized.includes('sang nay an') ||
    normalized.includes('thuc don') ||
    normalized.includes('meal');
  const asksWorkout =
    normalized.includes('bai tap') ||
    normalized.includes('tap chan') ||
    normalized.includes('tap lung') ||
    normalized.includes('tap nguc') ||
    normalized.includes('workout');
  const isGenericBackendReply =
    normalizedReply.includes('neu ban muon minh co the') ||
    normalizedReply.includes('hien co') ||
    normalizedReply.includes('toi uu theo muc tieu');

  return (
    !payload.actionRequired &&
    ((asksMeal || asksWorkout) || isGenericBackendReply)
  );
};

function AICoachSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className="h-[780px] rounded-[24px] border border-border-primary bg-bg-secondary" />
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
      <div className="ai-surface mt-2 rounded-2xl border p-3 text-sm text-text-primary">
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
    <div className="ai-surface mt-2 rounded-2xl border p-3 text-sm text-text-primary">
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
            <div key={`${exercise.exercise_id || 'exercise'}-${index}`} className="flex items-center gap-3 rounded-2xl border border-border-primary/80 bg-bg-primary/35 px-3 py-3">
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
      <div className="max-w-[88%] rounded-[26px] border border-border-primary bg-bg-secondary px-4 py-4 text-[15px] leading-7 text-text-primary shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
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
      <div className="space-y-4">
        <p>{buildCoachOpening(day)}</p>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-ai">
            <Dumbbell className="h-4 w-4" />
            <span>Workout hôm nay</span>
          </div>
          {day.exercises.length === 0 ? (
            <p>Workout hôm nay chưa có bài tập nào.</p>
          ) : (
            <>
              <p className="font-semibold">
                Workout hôm nay có {day.exercises.length} bài tập và {totalSets} sets.
              </p>
              <div className="space-y-2">
                {day.exercises.slice(0, 4).map((item, index) => {
                  const imageUrl = item.exercises?.image_url || item.exercises?.gif_url || '';
                  return (
                    <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-border-primary/80 bg-bg-primary/35 px-3 py-3">
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

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-ai">
            <Utensils className="h-4 w-4" />
            <span>Meal plan hôm nay</span>
          </div>
          <p className="whitespace-pre-line">{mealDigest}</p>
        </div>
      </div>
    </SummaryBubble>
  );
}

export default function AICoach() {
  const { user, isLoggedIn, refreshTick, profile, isPremium, refreshProfile, openPremiumModal } = useAuth();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [items, setItems] = useState<PlanExercise[]>([]);
  const [foodItems, setFoodItems] = useState<FoodPlanItem[]>([]);
  const [lifestyle, setLifestyle] = useState<LifestyleSummary | null>(null);
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const submitLockRef = useRef(false);
  const lastSubmitRef = useRef<{ message: string; at: number } | null>(null);
  const hasHydratedPlanRef = useRef(false);
  const chatMessagesRef = useRef<ChatMessage[]>([]);

  const todayDateKey = useMemo(() => getVietnamDateKey(), []);
  const todayChatRange = useMemo(() => getVietnamDayUtcRange(), []);
  const weekStartKey = useMemo(() => getWeekStartKey(new Date(`${todayDateKey}T00:00:00`)), [todayDateKey]);
  const profileCreatedAt = profile?.created_at ? new Date(profile.created_at) : null;
  const freeUsedAt = profile?.ai_coach_free_used_at ? new Date(profile.ai_coach_free_used_at) : null;
  const trialEndsAt = profileCreatedAt ? new Date(profileCreatedAt.getTime() + 7 * 24 * 60 * 60 * 1000) : null;
  const isTrialActive = !!trialEndsAt && trialEndsAt.getTime() >= Date.now();
  const canGenerateCoachPlan = isPremium || (!!profileCreatedAt && !freeUsedAt && isTrialActive);

  useEffect(() => {
    const loadPlan = async () => {
      if (!user?.id) {
        setPlan(null);
        setItems([]);
        setFoodItems([]);
        setLifestyle(null);
        setLoading(false);
        return;
      }

      if (!hasHydratedPlanRef.current) {
        setLoading(true);
      }
      setError('');

      try {
        const lifestyleResult = await supabase
          .from('lifestyle_settings')
          .select('weekly_workouts')
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
        setError(err?.message || 'Không thể tải kế hoạch từ AI Coach.');
      } finally {
        hasHydratedPlanRef.current = true;
        setLoading(false);
      }
    };

    void loadPlan();
  }, [user?.id, refreshTick, weekStartKey, reloadKey]);

  const generateCoachPlan = async () => {
    if (!user?.id) return;
    setIsGenerating(true);
    setError('');

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
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAction = () => {
    if (!isLoggedIn) return;
    if (canGenerateCoachPlan) {
      void generateCoachPlan();
      return;
    }
    openPremiumModal();
  };

  const days = useMemo<DayPlan[]>(
    () =>
      DAY_LABELS.map((label, dayIndex) => ({
        label,
        dayIndex,
        exercises: items.filter((item) => item.day_of_week === dayIndex && !item.is_rest_day),
        meals: foodItems.filter((item) => item.day_of_week === dayIndex && !item.is_rest_day),
      })),
    [items, foodItems],
  );

  const todayDayIndex = useMemo(() => {
    const today = new Date(`${todayDateKey}T00:00:00`);
    const day = today.getDay();
    return day === 0 ? 6 : day - 1;
  }, [todayDateKey]);

  const selectedDay = days[todayDayIndex] || days[0];
  useEffect(() => {
    const fetchChat = async () => {
      if (!user?.id) {
        setChatMessages([]);
        return;
      }

      const chatRes = await supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', todayChatRange.startIso)
        .lt('created_at', todayChatRange.endIso)
        .order('created_at', { ascending: true });

      if (chatRes.error || !chatRes.data || chatRes.data.length === 0) {
        setChatMessages([]);
        return;
      }

      const chatIds = chatRes.data.map((item: any) => String(item.id || '')).filter(Boolean);
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

      setChatMessages(
        (chatRes.data as any[]).map((item) => {
          const linkedAdjustment = adjustmentByChatId.get(String(item.id || ''));
          return {
            id: String(item.id || ''),
            role: item.role,
            content: String(item.content || ''),
            actionRequired: !!item.action_type,
            actionType: item.action_type || null,
            actionPayload: item.action_payload,
            adjustmentId: linkedAdjustment?.id || null,
            actionStatus: linkedAdjustment?.status || 'idle',
          } as ChatMessage;
        }),
      );
    };

    void fetchChat();
  }, [user?.id, todayChatRange.startIso, todayChatRange.endIso, reloadKey]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, [chatMessages, selectedDay.dayIndex]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

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
      setReloadKey((value) => value + 1);
    } catch {
      setError('Không thể cập nhật đề xuất lúc này. Vui lòng thử lại.');
    }
  };

  const submitChat = async (messageText?: string) => {
    const message = String(messageText ?? chatInput).trim();
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
    setIsSendingChat(true);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
    };

    const previousTopic = [...chatMessagesRef.current]
      .reverse()
      .map((item) => inferChatTopic(item.content))
      .find((topic): topic is 'meal' | 'workout' => topic === 'meal' || topic === 'workout') || null;

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
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<AIChatApiResponse>;
      if (!response.ok) {
        if (payload?.code === 'PREMIUM_REQUIRED') {
          openPremiumModal();
        }
        throw new Error(payload?.reply || 'Không thể gửi tin nhắn tới AI Coach.');
      }

      const replyContent = shouldPreferLocalReply(message, payload)
        ? buildCoachReply(selectedDay, message, previousTopic)
        : String(payload.reply || '').trim() || buildCoachReply(selectedDay, message, previousTopic);
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        content: replyContent,
        actionRequired: !!payload.actionRequired,
        actionType: payload.actionType || null,
        actionPayload: payload.actionPayload,
        adjustmentId: payload.adjustmentId || null,
        actionStatus: 'idle',
      };
      setChatMessages((current) => [...current, assistantMessage]);
    } catch {
      const fallbackMessage: ChatMessage = {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        content: buildCoachReply(selectedDay, message, previousTopic),
      };
      setChatMessages((current) => [...current, fallbackMessage]);
    } finally {
      submitLockRef.current = false;
      setIsSendingChat(false);
    }
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (!chatInput.trim() || isSendingChat) return;
    void submitChat();
  };

  if (loading) return <AICoachSkeleton />;

  return (
    <div className="contents xl:flex xl:flex-col xl:gap-5">
      <div className="-mt-1 w-full space-y-4 text-sm text-text-primary">
        {error ? (
          <div className="flex items-center gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        {!isLoggedIn || !plan ? (
          <section className="rounded-[24px] border border-border-primary bg-bg-secondary px-6 py-12 text-center shadow-[0_18px_50px_rgba(0,0,0,0.12)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-ai/12 text-ai">
              <Sparkles className="h-8 w-8" />
            </div>
            <h2 className="mt-6 text-3xl font-black text-text-primary">Chưa có kế hoạch từ AI Coach</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
              Hoàn tất hồ sơ sức khỏe và thói quen tập luyện để AI Coach tạo lịch tập, thực đơn và gợi ý điều chỉnh theo dữ liệu thật của bạn.
            </p>
            {isLoggedIn ? (
              <button
                type="button"
                onClick={handleGenerateAction}
                disabled={isGenerating}
                className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-6 text-sm font-black text-black hover:bg-accent-hover disabled:opacity-60"
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isGenerating ? 'Đang tạo kế hoạch...' : 'Tạo kế hoạch từ dữ liệu của tôi'}
              </button>
            ) : null}
          </section>
        ) : (
          <section>
            <article className="flex h-[calc(100vh-8rem)] min-w-0 flex-col overflow-hidden rounded-[24px] border border-border-primary bg-bg-secondary text-text-primary shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
              <div className="shrink-0 border-b border-border-primary bg-bg-secondary px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-primary">
                    <Bot className="h-4 w-4" />
                    <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-bg-secondary bg-ai" />
                  </div>
                  <div>
                    <p className="text-2xl font-black leading-none text-text-primary">AI Coach</p>
                    <p className="mt-1 text-xs font-semibold text-text-secondary">
                      Chat, workout và meal plan trong ngày
                    </p>
                  </div>
                </div>

              </div>

              <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-bg-tertiary px-5 py-5">
                <div className="space-y-4">
                  {chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex items-start gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {message.role === 'assistant' ? (
                        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ai text-white shadow-[0_10px_24px_rgb(var(--ai-rgb)_/_0.22)]">
                          <Bot className="h-4 w-4" />
                        </div>
                      ) : null}
                      <div className="max-w-[88%]">
                        <div
                          className={`rounded-[26px] border px-4 py-4 text-[15px] leading-8 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ${
                            message.role === 'user'
                              ? 'border-accent bg-accent text-black'
                              : 'border-border-primary bg-bg-secondary text-text-primary'
                          }`}
                        >
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
                              className="rounded-full bg-accent px-3 py-1.5 text-xs font-black text-black disabled:opacity-60"
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
                      </div>
                    </div>
                  ))}

                  {chatMessages.length === 0 ? <TodayDigestBubble day={selectedDay} /> : null}
                </div>
              </div>

              <div className="shrink-0 border-t border-border-primary bg-bg-tertiary px-5 pb-4 pt-4">
                <div className="flex items-center gap-3 rounded-[20px] border border-border-primary bg-bg-secondary px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    rows={1}
                    placeholder="Nhắn tin cho AI Coach hôm nay..."
                    className="max-h-28 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm font-semibold text-text-primary outline-none placeholder:text-text-tertiary"
                  />
                  <button
                    type="button"
                    onClick={() => submitChat()}
                    disabled={!chatInput.trim() || isSendingChat}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-ai text-white transition-colors hover:bg-ai-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSendingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </article>
          </section>
        )}
      </div>
    </div>
  );
}
