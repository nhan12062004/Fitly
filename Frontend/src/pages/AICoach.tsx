import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Bot,
  ChevronRight,
  Dumbbell,
  Loader2,
  Send,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const API_BASE_URL = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || 'https://trendfit.onrender.com';
const DAY_TAB_LABELS = ['TH 2', 'TH 3', 'TH 4', 'TH 5', 'TH 6', 'TH 7', 'CN'];
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
    image_url?: string | null;
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

const isWeekStartColumnError = (error: any) =>
  String(error?.message || '').includes('week_start_date') ||
  String(error?.details || '').includes('week_start_date') ||
  String(error?.hint || '').includes('week_start_date');

const getMealTypeLabel = (value: string) => {
  const key = String(value || '').toLowerCase();
  if (key === 'breakfast') return 'BÃ¡Â»Â¯a sÃƒÂ¡ng';
  if (key === 'lunch') return 'BÃ¡Â»Â¯a trÃ†Â°a';
  if (key === 'dinner') return 'BÃ¡Â»Â¯a tÃ¡Â»â€˜i';
  if (key === 'snack') return 'BÃ¡Â»Â¯a phÃ¡Â»Â¥';
  return value || 'BÃ¡Â»Â¯a Ã„Æ’n';
};

const formatDateLabel = (dateKey?: string | null) => {
  if (!dateKey) return 'TuÃ¡ÂºÂ§n hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i';
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const sumMealMetric = (meals: FoodPlanItem[], field: 'calories' | 'protein' | 'carbs' | 'fat') =>
  meals.reduce((sum, meal) => sum + Number(meal[field] || 0) * Number(meal.quantity || 1), 0);

const getDayHeadline = (day: DayPlan) => {
  if (day.exercises.length > 0) {
    return day.exercises[0]?.exercises?.body_part || day.exercises[0]?.exercises?.target_muscle || 'BuÃ¡Â»â€¢i tÃ¡ÂºÂ­p trong ngÃƒÂ y';
  }
  return 'ChÃ†Â°a cÃƒÂ³ lÃ¡Â»â€¹ch cho ngÃƒÂ y nÃƒÂ y';
};

const buildCoachOpening = (day: DayPlan) => {
  if (day.exercises.length > 0 && day.meals.length > 0) {
    return `MÃƒÂ¬nh Ã„â€˜ang theo dÃƒÂµi ${day.label}. HÃƒÂ´m nay cÃƒÂ³ ${day.exercises.length} bÃƒÂ i tÃ¡ÂºÂ­p vÃƒÂ  ${day.meals.length} mÃƒÂ³n trong thÃ¡Â»Â±c Ã„â€˜Ã†Â¡n. BÃ¡ÂºÂ¡n cÃƒÂ³ thÃ¡Â»Æ’ hÃ¡Â»Âi Ã„â€˜Ã¡Â»Æ’ chÃ¡Â»â€°nh cÃ†Â°Ã¡Â»Âng Ã„â€˜Ã¡Â»â„¢ tÃ¡ÂºÂ­p, Ã„â€˜Ã¡Â»â€¢i mÃƒÂ³n hoÃ¡ÂºÂ·c tÃ¡Â»â€˜i Ã†Â°u macro cho ngÃƒÂ y nÃƒÂ y.`;
  }
  if (day.meals.length > 0) {
    return `${day.label} hiÃ¡Â»â€¡n cÃƒÂ³ thÃ¡Â»Â±c Ã„â€˜Ã†Â¡n nhÃ†Â°ng chÃ†Â°a cÃƒÂ³ nhiÃ¡Â»Âu bÃƒÂ i tÃ¡ÂºÂ­p. BÃ¡ÂºÂ¡n cÃƒÂ³ thÃ¡Â»Æ’ hÃ¡Â»Âi mÃƒÂ¬nh cÃƒÂ¡ch sÃ¡ÂºÂ¯p xÃ¡ÂºÂ¿p vÃ¡ÂºÂ­n Ã„â€˜Ã¡Â»â„¢ng nhÃ¡ÂºÂ¹ hoÃ¡ÂºÂ·c Ã„â€˜Ã¡Â»â€¢i mÃƒÂ³n cho phÃƒÂ¹ hÃ¡Â»Â£p mÃ¡Â»Â¥c tiÃƒÂªu.`;
  }
  return `${day.label} hiÃ¡Â»â€¡n chÃ†Â°a cÃƒÂ³ Ã„â€˜Ã¡Â»Â§ dÃ¡Â»Â¯ liÃ¡Â»â€¡u. BÃ¡ÂºÂ¡n cÃƒÂ³ thÃ¡Â»Æ’ tÃ¡ÂºÂ¡o lÃ¡ÂºÂ¡i kÃ¡ÂºÂ¿ hoÃ¡ÂºÂ¡ch hoÃ¡ÂºÂ·c hÃ¡Â»Âi mÃƒÂ¬nh cÃƒÂ¡ch bÃ¡Â»â€¢ sung lÃ¡Â»â€¹ch tÃ¡ÂºÂ­p vÃƒÂ  thÃ¡Â»Â±c Ã„â€˜Ã†Â¡n cho ngÃƒÂ y nÃƒÂ y.`;
};

const buildCoachReply = (day: DayPlan, question: string) => {
  const normalizedQuestion = question.toLowerCase();
  const firstExercise = day.exercises[0];
  const firstMeal = day.meals[0];
  const calories = Math.round(sumMealMetric(day.meals, 'calories'));
  const protein = Math.round(sumMealMetric(day.meals, 'protein'));

  if (normalizedQuestion.includes('Ã„Æ’n') || normalizedQuestion.includes('thÃ¡Â»Â±c Ã„â€˜Ã†Â¡n') || normalizedQuestion.includes('meal')) {
    return day.meals.length > 0
      ? `${day.label} Ã„â€˜ang cÃƒÂ³ ${day.meals.length} mÃƒÂ³n, tÃ¡Â»â€¢ng khoÃ¡ÂºÂ£ng ${calories || 0} kcal vÃƒÂ  ${protein || 0}g protein. NÃ¡ÂºÂ¿u muÃ¡Â»â€˜n siÃ¡ÂºÂ¿t mÃ¡Â»Â¡ hÃ†Â¡n, hÃƒÂ£y giÃ¡Â»Â¯ nguyÃƒÂªn protein vÃƒÂ  cÃ¡ÂºÂ¯t bÃ¡Â»â€ºt mÃƒÂ³n phÃ¡Â»Â¥ hoÃ¡ÂºÂ·c tinh bÃ¡Â»â„¢t Ã¡Â»Å¸ bÃ¡Â»Â¯a tÃ¡Â»â€˜i.`
      : `${day.label} chÃ†Â°a cÃƒÂ³ thÃ¡Â»Â±c Ã„â€˜Ã†Â¡n chi tiÃ¡ÂºÂ¿t. NÃƒÂªn Ã†Â°u tiÃƒÂªn 1 nguÃ¡Â»â€œn Ã„â€˜Ã¡ÂºÂ¡m nÃ¡ÂºÂ¡c, 1 phÃ¡ÂºÂ§n rau lÃ¡Â»â€ºn vÃƒÂ  tinh bÃ¡Â»â„¢t vÃ¡Â»Â«a phÃ¡ÂºÂ£i quanh buÃ¡Â»â€¢i tÃ¡ÂºÂ­p Ã„â€˜Ã¡Â»Æ’ dÃ¡Â»â€¦ bÃƒÂ¡m mÃ¡Â»Â¥c tiÃƒÂªu hÃ†Â¡n.`;
  }

  if (normalizedQuestion.includes('nhÃ¡ÂºÂ¹') || normalizedQuestion.includes('mÃ¡Â»â€¡t')) {
    return day.exercises.length > 0
      ? `NÃ¡ÂºÂ¿u thÃ¡ÂºÂ¥y mÃ¡Â»â€¡t Ã¡Â»Å¸ ${day.label}, hÃƒÂ£y giÃ¡ÂºÂ£m 1 hiÃ¡Â»â€¡p Ã¡Â»Å¸ mÃ¡Â»â€”i bÃƒÂ i, giÃ¡Â»Â¯ kÃ¡Â»Â¹ thuÃ¡ÂºÂ­t sÃ¡ÂºÂ¡ch vÃƒÂ  kÃƒÂ©o nghÃ¡Â»â€° lÃƒÂªn ${Math.max(75, Number(firstExercise?.rest_seconds || 60))} giÃƒÂ¢y. VÃ¡ÂºÂ«n Ã„â€˜Ã¡Â»Â§ kÃƒÂ­ch thÃƒÂ­ch nhÃ†Â°ng bÃ¡Â»â€ºt quÃƒÂ¡ tÃ¡ÂºÂ£i.`
      : `NgÃƒÂ y nÃƒÂ y chÃ†Â°a cÃƒÂ³ bÃƒÂ i tÃ¡ÂºÂ­p. BÃ¡ÂºÂ¡n cÃƒÂ³ thÃ¡Â»Æ’ tÃ¡ÂºÂ¡o lÃ¡ÂºÂ¡i TrÃ¡Â»Â£ lÃƒÂ½ cÃƒÂ¡ nhÃƒÂ¢n hoÃ¡ÂºÂ·c thÃƒÂªm bÃƒÂ i trong thÃ†Â° viÃ¡Â»â€¡n Ã„â€˜Ã¡Â»Æ’ hoÃƒÂ n thiÃ¡Â»â€¡n lÃ¡Â»â€¹ch.`;
  }

  if (day.exercises.length > 0) {
    return `Cho ${day.label}, mÃƒÂ¬nh sÃ¡ÂºÂ½ Ã†Â°u tiÃƒÂªn ${getDayHeadline(day).toLowerCase()}. BÃ¡ÂºÂ¯t Ã„â€˜Ã¡ÂºÂ§u bÃ¡ÂºÂ±ng ${firstExercise?.exercises?.name || 'bÃƒÂ i chÃƒÂ­nh'}, giÃ¡Â»Â¯ ${firstExercise?.sets || 3} hiÃ¡Â»â€¡p x ${firstExercise?.reps || '8-12'} reps, rÃ¡Â»â€œi theo dÃƒÂµi cÃ¡ÂºÂ£m giÃƒÂ¡c Ã„â€˜Ã¡Â»Æ’ tÃ„Æ’ng hoÃ¡ÂºÂ·c giÃ¡ÂºÂ£m tÃ¡ÂºÂ£i.`;
  }

  if (firstMeal?.foods?.name) {
    return `${day.label} hiÃ¡Â»â€¡n nghiÃƒÂªng vÃ¡Â»Â dinh dÃ†Â°Ã¡Â»Â¡ng nhiÃ¡Â»Âu hÃ†Â¡n vÃ¡ÂºÂ­n Ã„â€˜Ã¡Â»â„¢ng. BÃ¡ÂºÂ¡n cÃƒÂ³ thÃ¡Â»Æ’ giÃ¡Â»Â¯ thÃ¡Â»Â±c Ã„â€˜Ã†Â¡n hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i vÃƒÂ  thÃƒÂªm mÃ¡Â»â„¢t buÃ¡Â»â€¢i cardio nhÃ¡ÂºÂ¹ hoÃ¡ÂºÂ·c Ã„â€˜i bÃ¡Â»â„¢ sau bÃ¡Â»Â¯a chÃƒÂ­nh Ã„â€˜Ã¡Â»Æ’ hÃ¡Â»â€” trÃ¡Â»Â£ mÃ¡Â»Â¥c tiÃƒÂªu tÃ¡Â»â€˜t hÃ†Â¡n.`;
  }

  return `MÃƒÂ¬nh Ã„â€˜ang bÃƒÂ¡m theo dÃ¡Â»Â¯ liÃ¡Â»â€¡u cÃ¡Â»Â§a ${day.label}. HÃƒÂ£y hÃ¡Â»Âi cÃ¡Â»Â¥ thÃ¡Â»Æ’ hÃ†Â¡n vÃ¡Â»Â bÃƒÂ i tÃ¡ÂºÂ­p hoÃ¡ÂºÂ·c thÃ¡Â»Â±c Ã„â€˜Ã†Â¡n Ã„â€˜Ã¡Â»Æ’ mÃƒÂ¬nh gÃ¡Â»Â£i ÃƒÂ½ sÃƒÂ¡t vÃ¡Â»â€ºi ngÃƒÂ y bÃ¡ÂºÂ¡n Ã„â€˜ang chÃ¡Â»Ân.`;
};

function AICoachSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="h-[780px] rounded-[24px] border border-border-primary bg-bg-secondary" />
        <div className="h-[780px] rounded-[24px] border border-border-primary bg-bg-secondary" />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`rounded-[24px] border border-border-primary bg-bg-secondary p-4 shadow-[0_18px_50px_rgba(0,0,0,0.12)] md:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-text-primary">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs font-semibold text-text-secondary">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </article>
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
    const payload = actionPayload as WorkoutProposalPayload;
    const exercises = Array.isArray(payload?.exercises) ? payload.exercises : [];
    return (
      <div className="ai-surface mt-2 rounded-2xl border p-3 text-sm text-text-primary">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-ai">De xuat moi</p>
        <p className="mt-2 font-black">{Number(payload?.duration_minutes || 0)} phut, {exercises.length} bai tap</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">Giam set, tang nghi de phuc hoi nhung van giu nhip tap.</p>
        <div className="mt-2 space-y-1">
          {exercises.slice(0, 3).map((exercise, index) => (
            <p key={`${exercise.exercise_id || 'exercise'}-${index}`} className="text-xs text-text-secondary">
              {index + 1}. {exercise.name || exercise.exercise_id || 'Exercise'} - {exercise.sets || 0} sets x {exercise.reps || '-'}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (actionType === 'replace_today_meal') {
    const payload = actionPayload as MealProposalPayload;
    return (
      <div className="ai-surface mt-2 rounded-2xl border p-3 text-sm text-text-primary">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-ai">De xuat doi mon</p>
        <p className="mt-2 font-black">{payload?.old_food_name || 'Mon cu'}{' -> '}{payload?.new_food_name || 'Mon moi'}</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">
          {getMealTypeLabel(String(payload?.meal_type || 'meal'))} Ã¢â‚¬Â¢ {Math.round(Number(payload?.calories || 0))} kcal Ã¢â‚¬Â¢ {Math.round(Number(payload?.protein || 0))}g protein
        </p>
        {payload?.notes ? <p className="mt-1 text-xs text-text-secondary">{payload.notes}</p> : null}
      </div>
    );
  }

  return null;
}

export default function AICoach() {
  const { user, isLoggedIn, refreshTick, profile, isPremium, refreshProfile, openPremiumModal } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [items, setItems] = useState<PlanExercise[]>([]);
  const [foodItems, setFoodItems] = useState<FoodPlanItem[]>([]);
  const [lifestyle, setLifestyle] = useState<LifestyleSummary | null>(null);
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [dbHasMessages, setDbHasMessages] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const dayTabContainerRef = useRef<HTMLDivElement | null>(null);
  const dayTabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [dayIndicatorStyle, setDayIndicatorStyle] = useState({ x: 0, y: 0, width: 0, height: 0, visible: false });

  const weekStartKey = useMemo(() => getWeekStartKey(new Date(`${getVietnamDateKey()}T00:00:00`)), []);
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

      setLoading(true);
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
            .select('*, foods:food_id (name, category, image_url, serving_unit)')
            .eq('food_plan_id', latestFoodPlan.id)
            .order('day_of_week', { ascending: true })
            .order('order_index', { ascending: true });

          if (foodPlanItems.error) throw foodPlanItems.error;
          setFoodItems((foodPlanItems.data || []) as FoodPlanItem[]);
        }
      } catch (err: any) {
        setError(err?.message || 'KhÃƒÂ´ng thÃ¡Â»Æ’ tÃ¡ÂºÂ£i kÃ¡ÂºÂ¿ hoÃ¡ÂºÂ¡ch tÃ¡Â»Â« TrÃ¡Â»Â£ lÃƒÂ½ cÃƒÂ¡ nhÃƒÂ¢n.');
      } finally {
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
        throw new Error(payload?.error || 'KhÃƒÂ´ng thÃ¡Â»Æ’ tÃ¡ÂºÂ¡o kÃ¡ÂºÂ¿ hoÃ¡ÂºÂ¡ch tÃ¡Â»Â« TrÃ¡Â»Â£ lÃƒÂ½ cÃƒÂ¡ nhÃƒÂ¢n.');
      }
      await refreshProfile();
      setReloadKey((value) => value + 1);
    } catch (err: any) {
      const message =
        err instanceof TypeError
          ? 'KhÃƒÂ´ng thÃ¡Â»Æ’ kÃ¡ÂºÂ¿t nÃ¡Â»â€˜i tÃ¡Â»â€ºi TrÃ¡Â»Â£ lÃƒÂ½ cÃƒÂ¡ nhÃƒÂ¢n. KiÃ¡Â»Æ’m tra backend, VITE_API_URL hoÃ¡ÂºÂ·c CORS.'
          : err?.message || 'KhÃƒÂ´ng thÃ¡Â»Æ’ tÃ¡ÂºÂ¡o kÃ¡ÂºÂ¿ hoÃ¡ÂºÂ¡ch tÃ¡Â»Â« TrÃ¡Â»Â£ lÃƒÂ½ cÃƒÂ¡ nhÃƒÂ¢n.';
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
    const today = new Date(`${getVietnamDateKey()}T00:00:00`);
    const day = today.getDay();
    return day === 0 ? 6 : day - 1;
  }, []);

  useEffect(() => {
    setSelectedDayIndex(todayDayIndex);
  }, [todayDayIndex, plan?.id]);

  useEffect(() => {
    const updateIndicator = () => {
      const container = dayTabContainerRef.current;
      const activeTab = dayTabRefs.current[selectedDayIndex];
      if (!container || !activeTab) {
        setDayIndicatorStyle((current) => ({ ...current, visible: false }));
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeTab.getBoundingClientRect();
      setDayIndicatorStyle({
        x: activeRect.left - containerRect.left + container.scrollLeft,
        y: activeRect.top - containerRect.top,
        width: activeRect.width,
        height: activeRect.height,
        visible: true,
      });
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [selectedDayIndex, days.length]);

  const selectedDay = days[selectedDayIndex] || days[todayDayIndex] || days[0];
  const trainingDays = days.filter((day) => day.exercises.length > 0).length;
  const targetWorkouts = Number(lifestyle?.weekly_workouts || trainingDays || 0);
  const selectedMealCalories = Math.round(sumMealMetric(selectedDay.meals, 'calories'));
  const selectedMealProtein = Math.round(sumMealMetric(selectedDay.meals, 'protein'));
  const selectedWorkoutSets = selectedDay.exercises.reduce((sum, item) => sum + Number(item.sets || 0), 0);

  const quickPrompts = [
    `Điều chỉnh ${selectedDay?.label || 'hôm nay'} nhẹ hơn`,
    `Đổi thực đơn ${selectedDay?.label || 'hôm nay'} gọn hơn`,
    'Gợi ý bữa phụ nhiều protein',
    'Tôi nên tập gì nếu hơi mệt?',
  ];

  useEffect(() => {
    const fetchChat = async () => {
      if (!user?.id) return;
      const [{ data: chatData }, { data: adjustmentData }] = await Promise.all([
        supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true }),
        supabase
          .from('ai_plan_adjustments')
          .select('id, chat_message_id, status')
          .eq('user_id', user.id)
          .eq('source_type', 'chat'),
      ]);

      if (chatData && chatData.length > 0) {
        const adjustmentByChatId = new Map(
          (adjustmentData || []).map((item: any) => [
            String(item.chat_message_id || ''),
            {
              id: String(item.id || ''),
              status: item.status === 'applied' || item.status === 'rejected' ? item.status : 'idle',
            },
          ]),
        );

        setChatMessages(
          (chatData as any[]).map((item) => {
            const linkedAdjustment = adjustmentByChatId.get(String(item.id || ''));
            return {
              id: String(item.id),
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
        setDbHasMessages(true);
      } else {
        setDbHasMessages(false);
      }
    };
    fetchChat();
  }, [user?.id]);

  useEffect(() => {
    if (!selectedDay) return;
    if (!dbHasMessages) {
      setChatMessages([
        {
          id: `assistant-welcome-${selectedDay.dayIndex}`,
          role: 'assistant',
          content: buildCoachOpening(selectedDay),
        },
      ]);
    }
  }, [selectedDay, dbHasMessages]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, [chatMessages, selectedDay.dayIndex]);

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
      setError('KhÃƒÂ´ng thÃ¡Â»Æ’ cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t Ã„â€˜Ã¡Â»Â xuÃ¡ÂºÂ¥t lÃƒÂºc nÃƒÂ y. Vui lÃƒÂ²ng thÃ¡Â»Â­ lÃ¡ÂºÂ¡i.');
    }
  };

  const submitChat = async (messageText?: string) => {
    const message = String(messageText ?? chatInput).trim();
    if (!message || !selectedDay || !user?.id) return;

    setChatInput('');
    setIsSendingChat(true);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
    };

    // Optimistic update
    setChatMessages((current) => {
      // Remove the unsaved welcome message if it's the only one
      const prev = dbHasMessages ? current : [];
      return [...prev, userMessage];
    });
    setDbHasMessages(true);

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
        throw new Error(payload?.reply || 'Khong the gui tin nhan toi AI Coach.');
      }

      const replyContent = String(payload.reply || '').trim() || buildCoachReply(selectedDay, message);
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
        content: buildCoachReply(selectedDay, message),
      };
      setChatMessages((current) => [...current, fallbackMessage]);
    } finally {
      setIsSendingChat(false);
    }
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
            <h2 className="mt-6 text-3xl font-black text-text-primary">Chưa có kế hoạch từ Trợ lý cá nhân</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
              Hoàn tất hồ sơ sức khỏe và thói quen tập luyện để Trợ lý cá nhân tạo lịch tập, thực đơn và gợi ý điều chỉnh theo dữ liệu thật của bạn.
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
          <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_420px]">
            <div className="grid gap-4">
              <SectionCard
                title="Lịch theo tuần"
                subtitle={`Chọn từng thứ để xem bài tập và thực đơn tương ứng`}
                action={
                  <div className="hidden min-w-[116px] rounded-2xl border border-border-primary bg-bg-primary/50 px-3 py-2 text-left shadow-[0_12px_30px_rgba(0,0,0,0.08)] sm:block">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Đang xem</p>
                    <p className="text-sm font-black text-text-primary">{selectedDay.label}</p>
                  </div>
                }
              >
                <div className="diet-tabs min-w-0 overflow-x-auto rounded-[20px] p-1">
                  <div ref={dayTabContainerRef} className="relative grid min-w-[520px] grid-cols-7 gap-1 md:min-w-0">
                    <span
                      className={`diet-tab-indicator pointer-events-none absolute rounded-2xl transition-[transform,width,height,opacity] duration-300 ease-out ${dayIndicatorStyle.visible ? 'opacity-100' : 'opacity-0'}`}
                      style={{
                        width: `${dayIndicatorStyle.width}px`,
                        height: `${dayIndicatorStyle.height}px`,
                        transform: `translate(${dayIndicatorStyle.x}px, ${dayIndicatorStyle.y}px)`,
                      }}
                    />
                  {days.map((day) => {
                    const isActive = day.dayIndex === selectedDay.dayIndex;
                    return (
                      <button
                        key={day.dayIndex}
                        ref={(node) => {
                          dayTabRefs.current[day.dayIndex] = node;
                        }}
                        type="button"
                        onClick={() => setSelectedDayIndex(day.dayIndex)}
                        className={`relative inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-2xl px-3 text-[10px] font-black uppercase leading-tight tracking-[0.12em] transition sm:text-[11px] ${
                          isActive ? 'diet-tab-selected z-10' : 'diet-tab'
                        }`}
                        title={day.label}
                      >
                        {day.dayIndex === todayDayIndex ? (
                          <span
                            aria-label="Hôm nay"
                            className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent"
                          />
                        ) : null}
                        <div className="hidden">
                          <div>
                            <p className="text-lg font-black leading-none text-text-primary">{day.exercises.length || 0}</p>
                            <p className="mt-1 text-[11px] font-semibold text-text-tertiary">bÃ i táº­p</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-black leading-none text-text-primary">{day.meals.length || 0}</p>
                            <p className="mt-1 text-[11px] font-semibold text-text-tertiary">mÃ³n</p>
                          </div>
                        </div>
                        <span>{day.dayIndex === todayDayIndex ? 'HÔM NAY' : DAY_TAB_LABELS[day.dayIndex]}</span>
                      </button>
                    );
                  })}
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title={selectedDay.label}
                action={<p className="pt-1 text-sm font-bold text-text-secondary">{getDayHeadline(selectedDay)}</p>}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="min-w-0 overflow-hidden rounded-[20px] border border-border-primary bg-bg-primary/35">
                    <div className="flex items-start justify-between gap-3 border-b border-border-primary px-4 py-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Bài tập</p>
                        <p className="mt-1 text-xl font-black text-text-primary">{selectedDay.exercises.length} mục</p>
                        <p className="mt-1 text-xs font-semibold text-text-tertiary">{selectedWorkoutSets || 0} sets trong ngày</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate('/exercises')}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border-primary bg-bg-secondary px-3 text-xs font-black text-text-primary hover:border-ai/30 hover:text-ai"
                      >
                        Thư viện bài tập
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="divide-y divide-border-primary/70">
                      {selectedDay.exercises.length > 0 ? (
                        selectedDay.exercises.map((item) => {
                          const imageUrl = normalizeMediaUrl(item.exercises?.gif_url || item.exercises?.image_url || '');
                          return (
                            <div key={item.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-bg-secondary/55">
                              <div className="h-14 w-[66px] shrink-0 overflow-hidden rounded-lg border border-border-primary bg-bg-tertiary">
                                {imageUrl ? (
                                  <img src={imageUrl} alt={item.exercises?.name || "Bài tập"} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-accent">
                                    <Dumbbell className="h-5 w-5" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-base font-black text-text-primary">{item.exercises?.name || "Bài tập"}</p>
                                <p className="mt-1 text-xs font-semibold text-text-secondary">
                                  {item.exercises?.body_part || item.exercises?.target_muscle || "Strength"} • {item.sets || 3} sets • {item.reps || "8-12"} reps
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.12em]">
                                  <span className="rounded-full bg-bg-tertiary px-2.5 py-1 text-text-secondary">
                                    Nghỉ {item.rest_seconds || 60}s
                                  </span>
                                  {Number(item.weight_kg || 0) > 0 ? (
                                    <span className="rounded-full bg-ai/10 px-2.5 py-1 text-ai">
                                      {item.weight_kg} kg
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="px-4 py-10 text-center">
                          <p className="text-sm font-black text-text-primary">Chưa có bài tập cho ngày này</p>
                          <p className="mt-1 text-xs font-semibold text-text-tertiary">
                            Tạo lại Trợ lý cá nhân để đồng bộ lịch tập mới cho ngày này.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 overflow-hidden rounded-[20px] border border-border-primary bg-bg-primary/35">
                    <div className="flex items-start justify-between gap-3 border-b border-border-primary px-4 py-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Thực đơn</p>
                        <p className="mt-1 text-xl font-black text-text-primary">{selectedDay.meals.length} món</p>
                        <p className="mt-1 text-xs font-semibold text-text-tertiary">{selectedMealCalories} kcal · {selectedMealProtein}g protein</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate('/diet-plan')}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border-primary bg-bg-secondary px-3 text-xs font-black text-text-primary hover:border-ai/30 hover:text-ai"
                      >
                        Meal plan
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="divide-y divide-border-primary/70">
                      {selectedDay.meals.length > 0 ? (
                        selectedDay.meals.map((meal) => {
                          const foodImage = normalizeMediaUrl(meal.foods?.image_url || '');
                          return (
                            <div key={meal.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-bg-secondary/55">
                              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border-primary bg-bg-tertiary">
                                {foodImage ? (
                                  <img src={foodImage} alt={meal.foods?.name || "Món ăn"} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-accent">
                                    <Utensils className="h-4 w-4" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-black text-text-primary">{meal.foods?.name || "Món ăn"}</p>
                                  <span className="shrink-0 rounded-full bg-ai/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-ai">
                                    {getMealTypeLabel(meal.meal_type)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs font-semibold text-text-secondary">
                                  {Math.round(Number(meal.calories || 0) * Number(meal.quantity || 1))} kcal •{" "}
                                  {Math.round(Number(meal.protein || 0) * Number(meal.quantity || 1))}g protein
                                </p>
                                <p className="mt-1 text-[11px] font-medium text-text-tertiary">
                                  x{Number(meal.quantity || 1)} {meal.foods?.serving_unit || 'serving'}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="px-4 py-10 text-center">
                          <p className="text-sm font-black text-text-primary">Chưa có thực đơn cho ngày này</p>
                          <p className="mt-1 text-xs font-semibold text-text-tertiary">
                            Tạo lại Trợ lý cá nhân hoặc mở Thực đơn để cập nhật bữa ăn.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>

            <article className="sticky top-5 flex h-[680px] min-w-0 self-start flex-col overflow-hidden rounded-[24px] border border-border-primary bg-bg-secondary text-text-primary shadow-[0_24px_70px_rgba(0,0,0,0.18)] md:h-[760px] xl:h-[calc(100vh-7rem)] xl:max-h-[860px]">
              <div className="flex items-center gap-3 border-b border-border-primary bg-bg-secondary px-5 py-5">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-primary">
                  <Bot className="h-5 w-5" />
                  <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-bg-secondary bg-ai" />
                </div>
                <div>
                  <p className="text-[28px] font-black leading-none text-text-primary">Trợ lý cá nhân</p>
                  <p className="mt-1 text-sm font-semibold text-text-secondary">
                    Lịch tập, thực đơn và tiến độ của bạn
                  </p>
                </div>
              </div>

              <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-bg-tertiary px-5 py-6">
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
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border-primary bg-bg-tertiary px-5 pt-3">
                {quickPrompts.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => submitChat(text)}
                    className="rounded-full border border-border-primary bg-bg-secondary px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-ai/30 hover:text-ai"
                  >
                    {text}
                  </button>
                ))}
              </div>

              <div className="bg-bg-tertiary px-5 pb-5 pt-4">
                <div className="flex items-center gap-3 rounded-[20px] border border-border-primary bg-bg-secondary px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    rows={1}
                    placeholder="Nhắn tin cho Trợ lý cá nhân..."
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
