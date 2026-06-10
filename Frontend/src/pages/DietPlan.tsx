import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Droplet,
  Plus,
  Search,
  Utensils,
  X
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { SkeletonBlock, SkeletonHero, SkeletonSurface } from '../components/PageSkeleton';

interface Food {
  id: string;
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_unit: string;
  image_url: string;
}

interface PlanFood {
  tempId: string;
  weekly_food_item_id?: string | null;
  food_id: string;
  name: string;
  image_url: string;
  category: string;
  meal_type: string;
  quantity: number;
  // Stored per serving/unit. UI totals must multiply by quantity.
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  is_rest_day: boolean;
}

type MealTypeId = 'breakfast' | 'lunch' | 'snack' | 'dinner';

type DietPlanPageCache = {
  foods: Food[];
  selectedDayId: number;
  weeklyPlan: Record<number, PlanFood[]>;
  restDays: Record<number, boolean>;
  planId: string | null;
  planName: string;
  targetCalories: number;
  waterIntake: number;
  waterGoal: number;
};

const DAYS = [
  { id: 0, label: 'TH 2', full: 'Thứ 2' },
  { id: 1, label: 'TH 3', full: 'Thứ 3' },
  { id: 2, label: 'TH 4', full: 'Thứ 4' },
  { id: 3, label: 'TH 5', full: 'Thứ 5' },
  { id: 4, label: 'TH 6', full: 'Thứ 6' },
  { id: 5, label: 'TH 7', full: 'Thứ 7' },
  { id: 6, label: 'CN', full: 'Chủ nhật' }
];

const MEAL_TYPES: Array<{ id: MealTypeId; label: string; time: string }> = [
  { id: 'breakfast', label: 'BREAKFAST', time: '07:30' },
  { id: 'lunch', label: 'LUNCH', time: '12:30' },
  { id: 'dinner', label: 'DINNER', time: '19:00' },
  { id: 'snack', label: 'SNACK', time: '22:00' }
];

const MEAL_TYPE_THEME: Record<MealTypeId, {
  accent: string;
  accentSoft: string;
  accentStrong: string;
  border: string;
}> = {
  breakfast: {
    accent: '#f59e0b',
    accentSoft: 'rgba(245,158,11,0.12)',
    accentStrong: 'rgba(245,158,11,0.24)',
    border: 'rgba(245,158,11,0.20)'
  },
  lunch: {
    accent: '#22c55e',
    accentSoft: 'rgba(34,197,94,0.12)',
    accentStrong: 'rgba(34,197,94,0.24)',
    border: 'rgba(34,197,94,0.20)'
  },
  dinner: {
    accent: '#38bdf8',
    accentSoft: 'rgba(56,189,248,0.12)',
    accentStrong: 'rgba(56,189,248,0.24)',
    border: 'rgba(56,189,248,0.20)'
  },
  snack: {
    accent: '#fb7185',
    accentSoft: 'rgba(251,113,133,0.12)',
    accentStrong: 'rgba(251,113,133,0.24)',
    border: 'rgba(251,113,133,0.20)'
  }
};

const FOOD_CATEGORIES = ['Chất đạm', 'Carbs', 'Rau củ', 'Trái cây', 'Sữa', 'Bữa phụ'];
const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CALORIE_TARGET = 2400;
const DEFAULT_WATER_TARGET = 2.5;
const DEFAULT_PLAN_NAME = 'Thực đơn';

let dietPlanFoodCache: Food[] | null = null;
const dietPlanPageCache = new Map<string, DietPlanPageCache>();

const SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=320&q=80',
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=320&q=80',
  'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=320&q=80',
  'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?auto=format&fit=crop&w=320&q=80'
];

const getDatePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  return {
    year: parts.find((p) => p.type === 'year')?.value || '1970',
    month: parts.find((p) => p.type === 'month')?.value || '01',
    day: parts.find((p) => p.type === 'day')?.value || '01'
  };
};

const getVietnamDateKey = (date = new Date()): string => {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const getVietnamTodayDate = (): Date => new Date(`${getVietnamDateKey()}T00:00:00`);

const getWeekStart = (baseDate: Date): Date => {
  const date = new Date(baseDate);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  date.setHours(0, 0, 0, 0);
  return date;
};

const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getTodayDayIndex = (): number => {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: VIETNAM_TIMEZONE, weekday: 'short' }).format(new Date());
  return { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
};

const getCurrentMealType = (): MealTypeId => {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIMEZONE,
    hour: 'numeric',
    hour12: false
  }).format(new Date()));

  if (hour >= 19) return 'dinner';
  if (hour >= 16) return 'snack';
  if (hour >= 11) return 'lunch';
  return 'breakfast';
};

const pickLatestPlan = (plans: any[] | null) => {
  if (!plans?.length) return null;
  return [...plans].sort((a, b) =>
    new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
  )[0];
};

const roundMacro = (value: number) => Math.round(value * 10) / 10;

const resolveFoodImage = (food: Food | undefined, index: number) => {
  const url = String(food?.image_url || '').trim();
  return url || SAMPLE_IMAGES[index % SAMPLE_IMAGES.length];
};

const FoodImage = ({ src, alt, muted = false }: { src: string; alt: string; muted?: boolean }) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => setHasError(false), [src]);

  if (!src || hasError) {
    return (
      <div className="diet-thumb-fallback flex h-full w-full items-center justify-center">
        <Utensils className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`h-full w-full object-cover ${muted ? 'grayscale opacity-55' : ''}`}
    />
  );
};

const FoodPicker = ({
  open,
  foods,
  search,
  filterCat,
  mealType,
  onClose,
  onSearch,
  onFilterCat,
  onSelect
}: {
  open: boolean;
  foods: Food[];
  search: string;
  filterCat: string;
  mealType: MealTypeId;
  onClose: () => void;
  onSearch: (value: string) => void;
  onFilterCat: (value: string) => void;
  onSelect: (food: Food) => void;
}) => {
  if (!open) return null;

  const mealLabel = MEAL_TYPES.find((meal) => meal.id === mealType)?.label || 'bữa ăn';

  return (
    <div className="diet-picker-overlay fixed inset-0 z-50 flex items-end backdrop-blur-sm md:items-center md:justify-center" onClick={onClose}>
      <div
        className="diet-picker-panel max-h-[84vh] w-full overflow-hidden rounded-t-[28px] border md:max-w-2xl md:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border-primary px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-500">Thêm vào {mealLabel}</p>
            <h3 className="diet-title mt-1 text-lg font-black">Chọn món ăn</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="diet-control flex h-9 w-9 items-center justify-center rounded-full border"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border-primary px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Tìm món ăn..."
              className="diet-picker-input h-11 w-full rounded-2xl border pl-10 pr-4 text-sm font-semibold outline-none transition focus:border-accent"
              autoFocus
            />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => onFilterCat('all')}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] ${
                filterCat === 'all' ? 'diet-picker-filter-active' : 'diet-picker-filter'
              }`}
            >
              Tất cả
            </button>
            {FOOD_CATEGORIES.map((category) => (
              <button
                type="button"
                key={category}
                onClick={() => onFilterCat(category)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] ${
                  filterCat === category ? 'diet-picker-filter-active' : 'diet-picker-filter'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="grid max-h-[46vh] gap-2 overflow-y-auto p-4 sm:grid-cols-2">
          {foods.map((food, index) => (
            <button
              type="button"
              key={food.id}
              onClick={() => onSelect(food)}
              className="diet-picker-item flex items-center gap-3 rounded-2xl border p-2 text-left transition"
            >
              <span className="diet-empty-thumb h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                <FoodImage src={resolveFoodImage(food, index)} alt={food.name} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="diet-strong block truncate text-sm font-black">{food.name}</span>
                <span className="diet-muted mt-1 block text-xs font-semibold">
                  {Math.round(food.calories)} kcal - P {roundMacro(food.protein)}g - C {roundMacro(food.carbs)}g
                </span>
              </span>
              <Plus className="h-4 w-4 text-blue-500" />
            </button>
          ))}

          {foods.length === 0 && (
            <div className="col-span-full py-10 text-center">
              <Utensils className="diet-muted mx-auto mb-3 h-9 w-9" />
              <p className="diet-muted text-sm font-bold">Không tìm thấy món ăn phù hợp</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export function DietPlanSkeleton() {
  return (
    <div className="dashboard-page-shell diet-page-shell flex flex-col gap-4 animate-pulse pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <div className="w-full space-y-4">
        <SkeletonHero titleWidth="w-[62%] max-w-[20rem]" chips={4} />

        <div className="flex min-w-max gap-2 overflow-x-auto">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-border-primary bg-bg-secondary/60 px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.08)]">
              <div className={`h-5 rounded-md bg-bg-tertiary/75 ${index === 0 ? 'w-28' : 'w-20'}`} />
            </div>
          ))}
        </div>

        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonSurface key={index} className="p-4 md:p-5">
              <div className="flex items-start justify-between gap-4">
                {SkeletonBlock('h-5 w-28 rounded-md')}
                <div className="text-right">
                  <div className="h-8 w-10 rounded-md bg-bg-tertiary/80" />
                  <div className="mt-1 h-3 w-8 rounded bg-bg-tertiary/60" />
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
                <div className="h-[92px] w-full rounded-xl border border-border-primary/60 bg-bg-tertiary/40 md:w-[96px]" />
                <div className="min-w-0 flex-1">
                  <div className="h-6 w-52 rounded-md bg-bg-tertiary/85" />
                  <div className="mt-2 h-4 w-full max-w-[340px] rounded-md bg-bg-tertiary/60" />
                  <div className="mt-1 h-4 w-full max-w-[260px] rounded-md bg-bg-tertiary/45" />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <div className="h-10 w-32 rounded-xl bg-bg-tertiary/80" />
                <div className="h-10 w-28 rounded-xl border border-border-primary bg-bg-tertiary/35" />
              </div>
            </SkeletonSurface>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DietPlan() {
  const { user } = useAuth();
  const initialWeekStart = getWeekStart(getVietnamTodayDate());
  const initialWeekKey = toDateKey(initialWeekStart);
  const initialDietCache = user?.id ? dietPlanPageCache.get(`${user.id}:${initialWeekKey}`) || null : null;
  const dayTabContainerRef = useRef<HTMLDivElement | null>(null);
  const dayTabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [foods, setFoods] = useState<Food[]>(() => initialDietCache?.foods || dietPlanFoodCache || []);
  const [selectedDayId, setSelectedDayId] = useState(() => initialDietCache?.selectedDayId ?? getTodayDayIndex());
  const [weeklyPlan, setWeeklyPlan] = useState<Record<number, PlanFood[]>>(() => initialDietCache?.weeklyPlan || {});
  const [restDays, setRestDays] = useState<Record<number, boolean>>(() => initialDietCache?.restDays || {});
  const [planId, setPlanId] = useState<string | null>(() => initialDietCache?.planId || null);
  const [planName, setPlanName] = useState(() => initialDietCache?.planName || DEFAULT_PLAN_NAME);
  const [isLoading, setIsLoading] = useState(() => !initialDietCache);
  const [, setIsRefreshing] = useState(false);
  const [, setIsSaving] = useState(false);
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(initialWeekStart);
  const [targetCalories, setTargetCalories] = useState(() => initialDietCache?.targetCalories || DEFAULT_CALORIE_TARGET);
  const [waterIntake, setWaterIntake] = useState(() => initialDietCache?.waterIntake ?? 1.8);
  const [waterGoal, setWaterGoal] = useState(() => initialDietCache?.waterGoal || DEFAULT_WATER_TARGET);
  const [foodPickerOpen, setFoodPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [activeMealType, setActiveMealType] = useState<MealTypeId>('lunch');
  const [dayIndicatorStyle, setDayIndicatorStyle] = useState<{ x: number; y: number; width: number; height: number; visible: boolean }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false
  });

  const selectedWeekKey = useMemo(() => toDateKey(selectedWeekStart), [selectedWeekStart]);
  const todayKey = useMemo(() => getVietnamDateKey(), [selectedWeekKey]);
  const cacheKey = user?.id ? `${user.id}:${selectedWeekKey}` : null;
  const isCurrentWeek = selectedWeekKey === toDateKey(getWeekStart(getVietnamTodayDate()));

  const dayItems = weeklyPlan[selectedDayId] || [];

  const filteredFoods = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return foods.filter((food) => {
      const matchesSearch = !needle || food.name.toLowerCase().includes(needle);
      const matchesCategory = filterCat === 'all' || food.category.toLowerCase() === filterCat.toLowerCase();
      return matchesSearch && matchesCategory;
    });
  }, [foods, search, filterCat]);

  const dayNutrition = useMemo(() => {
    const totals = dayItems.reduce(
      (acc, item) => ({
        calories: acc.calories + item.calories * item.quantity,
        protein: acc.protein + item.protein * item.quantity,
        carbs: acc.carbs + item.carbs * item.quantity,
        fat: acc.fat + item.fat * item.quantity
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    return {
      calories: Math.round(totals.calories),
      protein: roundMacro(totals.protein),
      carbs: roundMacro(totals.carbs),
      fat: roundMacro(totals.fat)
    };
  }, [dayItems]);

  const macroTargets = useMemo(() => ({
    protein: Math.round(targetCalories * 0.3 / 4),
    carbs: Math.round(targetCalories * 0.4 / 4),
    fat: Math.round(targetCalories * 0.3 / 9)
  }), [targetCalories]);

  const calorieProgress = Math.min(100, Math.round((dayNutrition.calories / Math.max(1, targetCalories)) * 100));
  const waterProgress = Math.min(100, Math.round((waterIntake / Math.max(0.1, waterGoal)) * 100));
  const remainingCalories = Math.max(0, targetCalories - dayNutrition.calories);
  const remainingProtein = Math.max(0, macroTargets.protein - dayNutrition.protein);
  const selectedDayDate = useMemo(() => addDays(selectedWeekStart, selectedDayId), [selectedDayId, selectedWeekStart]);
  const selectedDayDateLabel = useMemo(
    () => selectedDayDate.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' }),
    [selectedDayDate]
  );
  const mealsWithFoodCount = useMemo(
    () => MEAL_TYPES.filter((meal) => dayItems.some((item) => item.meal_type === meal.id)).length,
    [dayItems]
  );
  const isTodaySelected = isCurrentWeek && selectedDayId === getTodayDayIndex();
  const highlightedMealId = isTodaySelected ? getCurrentMealType() : null;
  const mealSummaries = useMemo(
    () =>
      MEAL_TYPES.map((meal, mealIndex) => {
        const items = dayItems.filter((item) => item.meal_type === meal.id);
        const mealCalories = Math.round(items.reduce((sum, item) => sum + item.calories * item.quantity, 0));
        const firstItem = items[0];
        const hasItems = items.length > 0;
        const protein = roundMacro(items.reduce((sum, item) => sum + item.protein * item.quantity, 0));
        const carbs = roundMacro(items.reduce((sum, item) => sum + item.carbs * item.quantity, 0));
        const fat = roundMacro(items.reduce((sum, item) => sum + item.fat * item.quantity, 0));
        const categories = Array.from(new Set(items.map((item) => item.category).filter(Boolean)));

        return {
          ...meal,
          mealIndex,
          items,
          mealCalories,
          firstItem,
          feedbackTarget: firstItem || null,
          hasItems,
          names: hasItems ? items.map((item) => item.name).join(' + ') : 'Chưa có món cho bữa này',
          protein,
          carbs,
          fat,
          categories,
          mealDescription: hasItems ? categories.join(', ') || `${items.length} món đã chọn` : '',
          mealTheme: MEAL_TYPE_THEME[meal.id],
          isHighlighted: highlightedMealId === meal.id
        };
      }),
    [dayItems, highlightedMealId]
  );
  const featuredMeal = useMemo(
    () =>
      mealSummaries.find((meal) => meal.id === highlightedMealId && meal.hasItems) ||
      mealSummaries.find((meal) => meal.hasItems) ||
      mealSummaries[0] ||
      null,
    [highlightedMealId, mealSummaries]
  );

  useEffect(() => {
    if (isCurrentWeek) setSelectedDayId(getTodayDayIndex());
  }, [isCurrentWeek, selectedWeekKey]);

  useEffect(() => {
    const updateDayIndicator = () => {
      const container = dayTabContainerRef.current;
      const activeTab = dayTabRefs.current[selectedDayId];
      if (!container || !activeTab) return;

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeTab.getBoundingClientRect();
      setDayIndicatorStyle({
        x: activeRect.left - containerRect.left,
        y: activeRect.top - containerRect.top,
        width: activeRect.width,
        height: activeRect.height,
        visible: true
      });
    };

    const frame = window.requestAnimationFrame(updateDayIndicator);
    window.addEventListener('resize', updateDayIndicator);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateDayIndicator);
    };
  }, [selectedDayId, isCurrentWeek, selectedWeekStart]);

  useEffect(() => {
    let cancelled = false;

    async function fetchFoods() {
      if (dietPlanFoodCache) {
        setFoods(dietPlanFoodCache);
        return;
      }

      const { data, error } = await supabase.from('foods').select('*').order('name');
      if (error) {
        console.error(error);
        return;
      }

      if (!cancelled && data) {
        const normalizedFoods = data.map((food: any) => ({
          id: food.id,
          name: food.name || '',
          category: food.category || '',
          calories: Number(food.calories || 0),
          protein: Number(food.protein || 0),
          carbs: Number(food.carbs || 0),
          fat: Number(food.fat || 0),
          serving_unit: food.serving_unit || '100g',
          image_url: food.image_url || ''
        }));
        dietPlanFoodCache = normalizedFoods;
        setFoods(normalizedFoods);
      }
    }

    fetchFoods();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const userId = user.id;

    async function fetchTargets() {
      try {
        const today = getVietnamDateKey();
        const [lifestyleRes, progressRes] = await Promise.all([
          supabase.from('lifestyle_settings').select('target_calories, daily_water_goal').eq('user_id', userId).maybeSingle(),
          supabase.from('daily_progress_logs').select('water_intake_ml').eq('user_id', userId).eq('log_date', today).maybeSingle()
        ]);

        if (lifestyleRes.data?.target_calories) setTargetCalories(Number(lifestyleRes.data.target_calories));
        if (lifestyleRes.data?.daily_water_goal) setWaterGoal(Number(lifestyleRes.data.daily_water_goal));
        if (progressRes.data?.water_intake_ml !== undefined) setWaterIntake(Number(progressRes.data.water_intake_ml || 0) / 1000);
      } catch (error) {
        console.error(error);
      }
    }

    fetchTargets();
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    async function fetchWeeklyPlan() {
      const cached = cacheKey ? dietPlanPageCache.get(cacheKey) || null : null;
      if (cached) {
        setFoods(cached.foods);
        setSelectedDayId(cached.selectedDayId);
        setWeeklyPlan(cached.weeklyPlan);
        setRestDays(cached.restDays);
        setPlanId(cached.planId);
        setPlanName(cached.planName);
        setTargetCalories(cached.targetCalories);
        setWaterIntake(cached.waterIntake);
        setWaterGoal(cached.waterGoal);
      }
      setIsLoading(!cached);
      setIsRefreshing(!!cached);
      try {
        let nextPlanId: string | null = null;
        let nextPlanName = DEFAULT_PLAN_NAME;
        const nextWeek: Record<number, PlanFood[]> = {};
        const nextRestDays: Record<number, boolean> = {};

        if (user) {
          const { data: plans, error } = await supabase
            .from('weekly_food_plans')
            .select('*')
            .eq('user_id', user.id)
            .eq('week_start_date', selectedWeekKey)
            .limit(20);

          if (error) throw error;
          const plan = pickLatestPlan(plans);

          if (plan) {
            nextPlanId = plan.id;
            nextPlanName = plan.name === 'Kế hoạch ăn uống tuần' ? DEFAULT_PLAN_NAME : (plan.name || DEFAULT_PLAN_NAME);

            const { data: items, error: itemsError } = await supabase
              .from('weekly_food_items')
              .select('*, foods:food_id (name, image_url, category, calories, protein, carbs, fat, serving_unit)')
              .eq('food_plan_id', plan.id)
              .order('order_index');

            if (itemsError) throw itemsError;

            items?.forEach((item: any) => {
              const day = Number(item.day_of_week || 0);
              if (item.is_rest_day) {
                nextRestDays[day] = true;
                return;
              }

              const joinedFood = item.foods || {};
              if (!nextWeek[day]) nextWeek[day] = [];
              nextWeek[day].push({
                tempId: item.id || crypto.randomUUID(),
                weekly_food_item_id: item.id || null,
                food_id: item.food_id,
                name: joinedFood.name || 'Món ăn',
                image_url: joinedFood.image_url || '',
                category: joinedFood.category || '',
                meal_type: item.meal_type || 'breakfast',
                quantity: Number(item.quantity || 1),
                calories: Number(joinedFood.calories ?? item.calories ?? 0),
                protein: Number(joinedFood.protein ?? item.protein ?? 0),
                carbs: Number(joinedFood.carbs ?? item.carbs ?? 0),
                fat: Number(joinedFood.fat ?? item.fat ?? 0),
                is_rest_day: false
              });
            });
          }
        }

        if (!cancelled) {
          setPlanId(nextPlanId);
          setPlanName(nextPlanName);
          setWeeklyPlan(nextWeek);
          setRestDays(nextRestDays);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    fetchWeeklyPlan();
    return () => {
      cancelled = true;
    };
  }, [user, selectedWeekKey, cacheKey]);

  useEffect(() => {
    if (!cacheKey) return;
    dietPlanPageCache.set(cacheKey, {
      foods,
      selectedDayId,
      weeklyPlan,
      restDays,
      planId,
      planName,
      targetCalories,
      waterIntake,
      waterGoal
    });
  }, [cacheKey, foods, selectedDayId, weeklyPlan, restDays, planId, planName, targetCalories, waterIntake, waterGoal]);

  const addFoodToPlan = useCallback((food: Food, mealType: MealTypeId = activeMealType) => {
    setWeeklyPlan((prev) => ({
      ...prev,
      [selectedDayId]: [
        ...(prev[selectedDayId] || []),
        {
          tempId: crypto.randomUUID(),
          weekly_food_item_id: null,
          food_id: food.id,
          name: food.name,
          image_url: food.image_url,
          category: food.category,
          meal_type: mealType,
          quantity: 1,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          is_rest_day: false
        }
      ]
    }));
    setRestDays((prev) => ({ ...prev, [selectedDayId]: false }));
    setFoodPickerOpen(false);
  }, [activeMealType, selectedDayId]);

  const openFoodPicker = (mealType: MealTypeId) => {
    setActiveMealType(mealType);
    setFoodPickerOpen(true);
  };

  const quickSuggestMeal = useCallback((mealType: MealTypeId) => {
    if (foods.length === 0) {
      openFoodPicker(mealType);
      return;
    }

    const existingFoodIds = new Set(
      (weeklyPlan[selectedDayId] || [])
        .filter((item) => item.meal_type === mealType)
        .map((item) => item.food_id)
    );
    const mealIndex = Math.max(0, MEAL_TYPES.findIndex((meal) => meal.id === mealType));
    const candidate =
      foods.find((food, index) => !existingFoodIds.has(food.id) && (index + mealIndex + selectedDayId) % 2 === 0) ||
      foods.find((food) => !existingFoodIds.has(food.id)) ||
      foods[mealIndex % foods.length];

    if (!candidate) {
      openFoodPicker(mealType);
      return;
    }

    addFoodToPlan(candidate, mealType);
  }, [addFoodToPlan, foods, selectedDayId, weeklyPlan]);

  const autoCreateMenu = () => {
    if (foods.length === 0) {
      setFoodPickerOpen(true);
      return;
    }

    setWeeklyPlan((prev) => {
      const current = prev[selectedDayId] || [];
      const nextItems = [...current];

      MEAL_TYPES.forEach((meal, index) => {
        if (nextItems.some((item) => item.meal_type === meal.id)) return;
        const food = foods[index % foods.length];
        nextItems.push({
          tempId: crypto.randomUUID(),
          weekly_food_item_id: null,
          food_id: food.id,
          name: food.name,
          image_url: food.image_url,
          category: food.category,
          meal_type: meal.id,
          quantity: 1,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          is_rest_day: false
        });
      });

      return { ...prev, [selectedDayId]: nextItems };
    });
    setRestDays((prev) => ({ ...prev, [selectedDayId]: false }));
  };

  const saveWaterIntake = async (nextLiters: number) => {
    setWaterIntake(nextLiters);
    if (!user) return;

    try {
      await supabase.from('daily_progress_logs').upsert({
        user_id: user.id,
        log_date: getVietnamDateKey(),
        water_intake_ml: Math.round(nextLiters * 1000)
      }, { onConflict: 'user_id,log_date' });
      window.dispatchEvent(new CustomEvent('fitly:water-updated', { detail: { waterIntake: nextLiters } }));
    } catch (error) {
      console.error(error);
    }
  };

  const savePlan = async () => {
    if (!user) {
      alert('Vui lòng đăng nhập để lưu thực đơn.');
      return;
    }

    setIsSaving(true);
    try {
      let nextPlanId = planId;

      if (!nextPlanId) {
        const { data: existingPlans } = await supabase
          .from('weekly_food_plans')
          .select('*')
          .eq('user_id', user.id)
          .eq('week_start_date', selectedWeekKey)
          .limit(20);
        const existing = pickLatestPlan(existingPlans);
        if (existing?.id) nextPlanId = existing.id;
      }

      if (!nextPlanId) {
        const { data, error } = await supabase
          .from('weekly_food_plans')
          .insert({ user_id: user.id, name: planName, week_start_date: selectedWeekKey })
          .select('id')
          .single();
        if (error) throw error;
        nextPlanId = data.id;
      } else {
        const { error } = await supabase
          .from('weekly_food_plans')
          .update({ name: planName, week_start_date: selectedWeekKey, updated_at: new Date().toISOString() })
          .eq('id', nextPlanId);
        if (error) throw error;
      }

      if (!nextPlanId) throw new Error('Không tạo được thực đơn.');
      setPlanId(nextPlanId);

      await supabase.from('weekly_food_items').delete().eq('food_plan_id', nextPlanId);

      const rows: any[] = [];
      DAYS.forEach(({ id: dayIndex }) => {
        if (restDays[dayIndex]) {
          rows.push({ food_plan_id: nextPlanId, day_of_week: dayIndex, meal_type: 'breakfast', is_rest_day: true, order_index: 0 });
          return;
        }

        (weeklyPlan[dayIndex] || []).forEach((item, index) => {
          rows.push({
            food_plan_id: nextPlanId,
            day_of_week: dayIndex,
            meal_type: item.meal_type,
            food_id: item.food_id,
            quantity: item.quantity,
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            order_index: index
          });
        });
      });

      if (rows.length > 0) {
        const { error } = await supabase.from('weekly_food_items').insert(rows);
        if (error) throw error;
      }

      alert('Đã lưu thực đơn.');
    } catch (error: any) {
      alert(`Không thể lưu thực đơn: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const suggestAlternativeFood = (item: PlanFood): Food | null => {
    if (!foods.length) return null;
    const candidates = foods.filter((food) => food.id !== item.food_id);
    if (!candidates.length) return null;

    const score = (food: Food) => {
      const caloriesGap = Math.abs(food.calories - item.calories);
      const proteinGap = Math.abs(food.protein - item.protein);
      const sameCategoryBonus = food.category === item.category ? -20 : 0;
      return caloriesGap + proteinGap * 2 + sameCategoryBonus;
    };

    return [...candidates].sort((a, b) => score(a) - score(b))[0] || null;
  };

  const submitMealFeedback = async (
    item: PlanFood,
    feedbackType: 'liked' | 'disliked' | 'too_much' | 'not_enough' | 'hard_to_cook' | 'too_expensive'
  ) => {
    if (!user) {
      alert('Vui lòng đăng nhập để gửi feedback.');
      return;
    }

    if (!item.weekly_food_item_id) {
      alert('Bạn cần lưu thực đơn trước khi gửi feedback.');
      return;
    }

    const { error } = await supabase.from('meal_feedback').insert({
      user_id: user.id,
      weekly_food_item_id: item.weekly_food_item_id,
      feedback_type: feedbackType
    });

    if (error) {
      alert(`Không thể gửi feedback: ${error.message}`);
      return;
    }

    if (feedbackType === 'disliked') {
      const replacement = suggestAlternativeFood(item);
      if (!replacement) {
        alert('Đã ghi nhận không thích món này.');
        return;
      }

      setWeeklyPlan((prev) => {
        const nextDayItems = (prev[selectedDayId] || []).map((entry) =>
          entry.tempId === item.tempId
            ? {
                ...entry,
                weekly_food_item_id: null,
                food_id: replacement.id,
                name: replacement.name,
                image_url: replacement.image_url,
                category: replacement.category,
                calories: replacement.calories,
                protein: replacement.protein,
                carbs: replacement.carbs,
                fat: replacement.fat
              }
            : entry
        );
        return { ...prev, [selectedDayId]: nextDayItems };
      });
      alert(`Đã đổi sang món tương đương: ${replacement.name}.`);
      return;
    }

    alert('Đã ghi nhận feedback.');
  };

  if (isLoading) return <DietPlanSkeleton />;

  return (
    <div className="dashboard-page-shell diet-page-shell flex flex-col gap-4 overflow-x-hidden overflow-y-auto text-sm pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <div className="w-full space-y-4 overflow-hidden">
        <section className="diet-card rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h1 className="text-2xl font-black tracking-tight text-text-primary md:text-3xl">
                {isTodaySelected ? 'Thực đơn hôm nay' : `Thực đơn ${DAYS[selectedDayId]?.full.toLowerCase()}`}
              </h1>

              <button
                type="button"
                onClick={autoCreateMenu}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-black transition hover:bg-accent-hover"
              >
                <Bot className="h-4 w-4" />
                Tạo lại AI
              </button>
            </div>

            <div className="rounded-xl border border-border-primary bg-bg-tertiary/40 p-1">
              <div ref={dayTabContainerRef} className="relative grid min-w-[520px] grid-cols-7 gap-1 overflow-x-auto md:min-w-0">
                <span
                  className={`diet-tab-indicator pointer-events-none absolute rounded-lg transition-[transform,width,height,opacity] duration-300 ease-out ${dayIndicatorStyle.visible ? 'opacity-100' : 'opacity-0'}`}
                  style={{
                    width: `${dayIndicatorStyle.width}px`,
                    height: `${dayIndicatorStyle.height}px`,
                    transform: `translate(${dayIndicatorStyle.x}px, ${dayIndicatorStyle.y}px)`
                  }}
                />
                {DAYS.map((day) => {
                  const dayDate = addDays(selectedWeekStart, day.id);
                  const isToday = toDateKey(dayDate) === todayKey;
                  const isSelected = selectedDayId === day.id;
                  const isTodayLabel = isCurrentWeek && isToday;
                  const label = isTodayLabel ? 'Hôm nay' : day.label;

                  return (
                    <button
                      key={day.id}
                      ref={(node) => {
                        dayTabRefs.current[day.id] = node;
                      }}
                      type="button"
                      onClick={() => setSelectedDayId(day.id)}
                      className={`inline-flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-lg px-3 text-[11px] font-black uppercase tracking-[0.08em] transition ${
                        isSelected ? 'diet-tab-selected relative z-10' : 'diet-tab'
                      }`}
                      title={`${day.full} - ${dayDate.toLocaleDateString('vi-VN')}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-border-primary bg-bg-tertiary/45 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-text-secondary">Calories</p>
                <p className="mt-2 text-lg font-black text-text-primary">
                  {dayNutrition.calories.toLocaleString()} / {targetCalories.toLocaleString()}
                </p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">Còn {remainingCalories.toLocaleString()} kcal</p>
              </div>
              <div className="rounded-xl border border-border-primary bg-bg-tertiary/45 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-text-secondary">Protein</p>
                <p className="mt-2 text-lg font-black text-text-primary">{Math.round(dayNutrition.protein)} / {macroTargets.protein}g</p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">Thiếu {Math.round(remainingProtein)}g</p>
              </div>
              <div className="rounded-xl border border-border-primary bg-bg-tertiary/45 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-text-secondary">Nước</p>
                <p className="mt-2 text-lg font-black text-text-primary">{waterIntake.toFixed(1)} / {waterGoal.toFixed(1)}L</p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">{waterProgress}% mục tiêu</p>
              </div>
            </div>

            {restDays[selectedDayId] ? (
              <div className="rounded-[22px] border border-border-primary bg-[#f7f4ef] px-5 py-6 text-[#1f2937]">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#8a6d1a]">Recovery day</p>
                <h2 className="mt-2 text-2xl font-black leading-tight">Ngày nghỉ để hồi phục</h2>
                <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#4b5563]">
                  Không cần hiển thị quá nhiều chi tiết cho ngày này. Bạn có thể bật lại thực đơn hoặc để AI tạo lại menu nhẹ hơn.
                </p>
                <button
                  type="button"
                  onClick={() => setRestDays((prev) => ({ ...prev, [selectedDayId]: false }))}
                  className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-black text-black transition hover:bg-accent-hover"
                >
                  Bật lại thực đơn
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-black text-text-primary md:text-2xl">Các bữa trong ngày</h2>
              <p className="mt-1 text-sm font-semibold text-text-secondary">
                {mealsWithFoodCount}/{MEAL_TYPES.length} bữa đã có món. Mỗi card chỉ giữ trạng thái và hành động chính để dễ đọc hơn trên mobile.
              </p>
            </div>
            <div className="rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 py-2 text-sm font-bold text-text-secondary">
              {planName}
            </div>
          </div>

          <main className="mt-4 grid gap-3 md:grid-cols-2">
            {mealSummaries.map((meal) => (
              <article
                key={meal.id}
                className={`rounded-xl border p-4 transition-colors ${
                  meal.isHighlighted
                    ? 'border-accent/35 bg-accent/8'
                    : 'border-border-primary bg-bg-tertiary/20'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-black"
                      style={{
                        color: meal.mealTheme.accent,
                        borderColor: meal.mealTheme.border,
                        backgroundColor: meal.mealTheme.accentSoft
                      }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meal.mealTheme.accent }} />
                      {meal.label.charAt(0) + meal.label.slice(1).toLowerCase()} • {meal.time}
                    </p>
                    <h3 className="mt-3 line-clamp-2 text-lg font-black text-text-primary">
                      {meal.hasItems ? meal.names : 'Chưa có món cho bữa này'}
                    </h3>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-black leading-none text-text-primary">{meal.mealCalories}</p>
                    <p className="mt-1 text-[11px] font-bold text-text-tertiary">kcal</p>
                  </div>
                </div>

                <p className="mt-3 text-sm font-semibold leading-6 text-text-secondary">
                  {meal.hasItems
                    ? `${meal.items.length} món • P ${meal.protein}g • C ${meal.carbs}g • F ${meal.fat}g`
                    : 'AI có thể gợi ý món phù hợp, hoặc bạn tự chọn món cho bữa này.'}
                </p>

                {meal.hasItems ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-text-tertiary">
                    {meal.items.slice(0, 2).map((item) => (
                      <span key={item.tempId} className="rounded-full border border-border-primary bg-bg-secondary/70 px-3 py-1">
                        {item.name}
                      </span>
                    ))}
                    {meal.items.length > 2 ? (
                      <span className="rounded-full border border-border-primary bg-bg-secondary/70 px-3 py-1">
                        +{meal.items.length - 2} món
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {meal.hasItems ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (!meal.feedbackTarget) return;
                          void submitMealFeedback(meal.feedbackTarget, 'liked');
                        }}
                        className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-black text-black transition hover:bg-accent-hover"
                      >
                        Đã ăn
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!meal.feedbackTarget) return;
                          void submitMealFeedback(meal.feedbackTarget, 'disliked');
                        }}
                        className="diet-control rounded-xl border border-border-primary px-4 py-2 text-sm font-black transition"
                      >
                        Đổi món
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => quickSuggestMeal(meal.id)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-black transition hover:bg-accent-hover"
                    >
                      <Bot className="h-4 w-4" />
                      AI chọn món
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openFoodPicker(meal.id)}
                    className="diet-control rounded-xl border border-border-primary px-4 py-2 text-sm font-black transition"
                  >
                    Tự chọn món
                  </button>
                </div>
              </article>
            ))}
          </main>
        </section>
      </div>

      <FoodPicker
        open={foodPickerOpen}
        foods={filteredFoods}
        search={search}
        filterCat={filterCat}
        mealType={activeMealType}
        onClose={() => setFoodPickerOpen(false)}
        onSearch={setSearch}
        onFilterCat={setFilterCat}
        onSelect={(food) => addFoodToPlan(food)}
      />
    </div>
  );
}
