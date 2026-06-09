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

const MacroRow = ({ label, value, target, color }: { label: string; value: number; target: number; color: string }) => {
  const width = Math.min(100, Math.round((value / Math.max(1, target)) * 100));

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[11px] font-black text-text-secondary">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="text-[11px] font-black text-text-primary">
          {Math.round(value)} <span className="text-text-tertiary">/{target}g</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
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
        <div className="rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
          <div className="h-40 rounded-xl bg-bg-tertiary" />
        </div>
        <div className="grid gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className={`rounded-xl border border-border-primary bg-bg-secondary p-4 ${index === 0 ? 'lg:col-span-2' : ''}`}>
              <div className="h-16 rounded-lg bg-bg-tertiary" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
              <div className="h-36 rounded-lg bg-bg-tertiary" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DietPlan() {
  const { user } = useAuth();
  const dayTabContainerRef = useRef<HTMLDivElement | null>(null);
  const dayTabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [foods, setFoods] = useState<Food[]>([]);
  const [selectedDayId, setSelectedDayId] = useState(getTodayDayIndex());
  const [weeklyPlan, setWeeklyPlan] = useState<Record<number, PlanFood[]>>({});
  const [restDays, setRestDays] = useState<Record<number, boolean>>({});
  const [planId, setPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState(DEFAULT_PLAN_NAME);
  const [isLoading, setIsLoading] = useState(true);
  const [, setIsSaving] = useState(false);
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(() => getWeekStart(getVietnamTodayDate()));
  const [targetCalories, setTargetCalories] = useState(DEFAULT_CALORIE_TARGET);
  const [waterIntake, setWaterIntake] = useState(1.8);
  const [waterGoal, setWaterGoal] = useState(DEFAULT_WATER_TARGET);
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
  const summaryChips = useMemo(() => ([
    {
      label: 'Kcal',
      value: `${dayNutrition.calories.toLocaleString()}/${targetCalories.toLocaleString()}`,
      color: '#f8fafc',
      bg: 'rgba(255,255,255,0.06)',
      border: 'rgba(255,255,255,0.10)'
    },
    {
      label: 'P',
      value: `${Math.round(dayNutrition.protein)}/${macroTargets.protein}`,
      color: '#22c55e',
      bg: 'rgba(34,197,94,0.12)',
      border: 'rgba(34,197,94,0.20)'
    },
    {
      label: 'C',
      value: `${Math.round(dayNutrition.carbs)}/${macroTargets.carbs}`,
      color: '#38bdf8',
      bg: 'rgba(56,189,248,0.12)',
      border: 'rgba(56,189,248,0.20)'
    },
    {
      label: 'F',
      value: `${Math.round(dayNutrition.fat)}/${macroTargets.fat}`,
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(245,158,11,0.20)'
    },
    {
      label: 'Nước',
      value: `${waterIntake.toFixed(1)}/${waterGoal.toFixed(1)}L`,
      color: '#60a5fa',
      bg: 'rgba(96,165,250,0.12)',
      border: 'rgba(96,165,250,0.20)'
    }
  ]), [dayNutrition.calories, dayNutrition.carbs, dayNutrition.fat, dayNutrition.protein, macroTargets.carbs, macroTargets.fat, macroTargets.protein, targetCalories, waterGoal, waterIntake]);

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
      const { data, error } = await supabase.from('foods').select('*').order('name');
      if (error) {
        console.error(error);
        return;
      }

      if (!cancelled && data) {
        setFoods(data.map((food: any) => ({
          id: food.id,
          name: food.name || '',
          category: food.category || '',
          calories: Number(food.calories || 0),
          protein: Number(food.protein || 0),
          carbs: Number(food.carbs || 0),
          fat: Number(food.fat || 0),
          serving_unit: food.serving_unit || '100g',
          image_url: food.image_url || ''
        })));
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
      setIsLoading(true);
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
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchWeeklyPlan();
    return () => {
      cancelled = true;
    };
  }, [user, selectedWeekKey]);

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
        <section
          className="diet-card relative overflow-hidden rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5"
          style={{
            backgroundImage:
              'radial-gradient(circle at top left, rgba(34,197,94,0.10), transparent 26%), radial-gradient(circle at top right, rgba(56,189,248,0.08), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))'
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,rgba(34,197,94,0.0),rgba(34,197,94,0.35),rgba(56,189,248,0.25),rgba(34,197,94,0.0))]" />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="diet-title text-2xl font-black tracking-tight md:text-4xl">
                {isTodaySelected ? 'Thực đơn hôm nay' : `Thực đơn ${DAYS[selectedDayId]?.full.toLowerCase()}`}
              </h1>
              <p className="diet-muted mt-2 text-sm font-semibold leading-6">
                <span className="text-text-primary">{dayNutrition.calories.toLocaleString()} / {targetCalories.toLocaleString()} kcal</span>
                {' • '}còn <span className="text-text-primary">{remainingCalories.toLocaleString()} kcal</span>
                {' • '}thiếu <span className="text-warning">{Math.round(remainingProtein)}g protein</span>
                {' • '}nước <span className="text-info">{waterIntake.toFixed(1)} / {waterGoal.toFixed(1)}L</span>
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <div className="diet-tabs min-w-0 overflow-x-auto rounded-xl p-1">
                <div ref={dayTabContainerRef} className="relative grid min-w-[520px] grid-cols-7 gap-1 md:min-w-0">
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

              <button
                type="button"
                onClick={autoCreateMenu}
                className="diet-control inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border-primary px-4 text-sm font-black transition"
              >
                <Bot className="h-4 w-4" />
                Tạo lại AI
              </button>
            </div>
          </div>
        </section>

        <section className="overflow-x-auto">
          <div className="flex min-w-max gap-2">
            {summaryChips.map((chip) => (
              <div
                key={chip.label}
                className="diet-card rounded-lg border px-3 py-2 text-sm font-black text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                style={{ backgroundColor: chip.bg, borderColor: chip.border }}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chip.color }} />
                  <span className="text-text-secondary">{chip.label}</span>
                  <span className="text-text-primary">{chip.value}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <main className="min-w-0 space-y-4">
          {restDays[selectedDayId] ? (
            <div className="diet-card rounded-xl border border-border-primary bg-bg-secondary px-6 py-12 text-center">
              <p className="diet-title text-lg font-black">Ngày nghỉ</p>
              <button
                type="button"
                onClick={() => setRestDays((prev) => ({ ...prev, [selectedDayId]: false }))}
                className="mt-4 rounded-xl bg-accent px-5 py-2.5 text-sm font-black text-black"
              >
                Bật lại thực đơn
              </button>
            </div>
          ) : (
            MEAL_TYPES.map((meal, mealIndex) => {
              const mealItems = dayItems.filter((item) => item.meal_type === meal.id);
              const mealCalories = Math.round(mealItems.reduce((sum, item) => sum + item.calories * item.quantity, 0));
              const firstItem = mealItems[0];
              const feedbackTarget = mealItems[0] || null;
              const hasItems = mealItems.length > 0;
              const names = hasItems ? mealItems.map((item) => item.name).join(' + ') : 'Chưa có món cho bữa này';
              const protein = roundMacro(mealItems.reduce((sum, item) => sum + item.protein * item.quantity, 0));
              const carbs = roundMacro(mealItems.reduce((sum, item) => sum + item.carbs * item.quantity, 0));
              const fat = roundMacro(mealItems.reduce((sum, item) => sum + item.fat * item.quantity, 0));
              const categories = Array.from(new Set(mealItems.map((item) => item.category).filter(Boolean)));
              const mealDescription = hasItems
                ? categories.join(', ') || `${mealItems.length} món đã chọn`
                : '';
              const mealTheme = MEAL_TYPE_THEME[meal.id];

              return (
                <article
                  key={meal.id}
                  className="diet-card relative overflow-hidden rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.01)), radial-gradient(circle at top right, ${mealTheme.accentSoft}, transparent 30%)`
                  }}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${mealTheme.accentStrong}, transparent 72%)` }} />
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-black"
                        style={{
                          color: mealTheme.accent,
                          borderColor: mealTheme.border,
                          backgroundColor: mealTheme.accentSoft
                        }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: mealTheme.accent }} />
                        {meal.label.charAt(0) + meal.label.slice(1).toLowerCase()} • {meal.time}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-[2rem] font-black leading-none text-text-primary">{mealCalories}</p>
                      <p className="text-[11px] font-black text-text-tertiary">kcal</p>
                    </div>
                  </div>

                  {hasItems ? (
                    <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start">
                      <button
                        type="button"
                        onClick={() => openFoodPicker(meal.id)}
                        className="h-[92px] w-full shrink-0 overflow-hidden rounded-xl border border-border-primary bg-bg-tertiary md:w-[96px]"
                        aria-label={`Chọn lại món cho ${meal.label}`}
                      >
                        <FoodImage src={resolveFoodImage(firstItem as unknown as Food, mealIndex)} alt={firstItem.name} />
                      </button>

                      <div className="min-w-0 flex-1">
                        <h3 className="diet-title text-[22px] font-black leading-tight text-text-primary">{names}</h3>
                        {mealDescription && (
                          <p className="diet-muted mt-1 text-sm font-semibold leading-6">{mealDescription}</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2.5 text-sm font-black text-text-primary">
                          <span className="rounded-full border border-[rgba(34,197,94,0.18)] bg-[rgba(34,197,94,0.10)] px-3 py-1 text-[#b9f5cf]">P:{protein}g</span>
                          <span className="rounded-full border border-[rgba(56,189,248,0.18)] bg-[rgba(56,189,248,0.10)] px-3 py-1 text-[#c5ebff]">C:{carbs}g</span>
                          <span className="rounded-full border border-[rgba(245,158,11,0.18)] bg-[rgba(245,158,11,0.10)] px-3 py-1 text-[#ffd9a8]">F:{fat}g</span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!feedbackTarget) return;
                              void submitMealFeedback(feedbackTarget, 'liked');
                            }}
                            className="diet-control rounded-xl border border-border-primary px-4 py-2 text-sm font-black transition"
                          >
                            Đã ăn
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!feedbackTarget) return;
                              void submitMealFeedback(feedbackTarget, 'disliked');
                            }}
                            className="diet-control rounded-xl border border-border-primary px-4 py-2 text-sm font-black transition"
                          >
                            Đổi món
                          </button>
                          <button
                            type="button"
                            onClick={() => openFoodPicker(meal.id)}
                            className="diet-control rounded-xl border border-border-primary px-4 py-2 text-sm font-black transition"
                          >
                            ...
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
                      <div
                        className="flex h-[92px] w-full shrink-0 items-center justify-center rounded-xl border md:w-[96px]"
                        style={{ borderColor: mealTheme.border, backgroundColor: mealTheme.accentSoft }}
                      >
                        <Utensils className="h-7 w-7" style={{ color: mealTheme.accent }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-bold text-text-primary">Chưa có món cho bữa này</p>
                        <p className="diet-muted mt-1 text-sm font-semibold leading-6">
                          AI có thể gợi ý món phù hợp với mục tiêu calories và protein của hôm nay.
                        </p>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 md:mt-0">
                        <button
                          type="button"
                          onClick={() => quickSuggestMeal(meal.id)}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-black transition hover:bg-accent-hover"
                        >
                          <Bot className="h-4 w-4" />
                          AI chọn món
                        </button>
                        <button
                          type="button"
                          onClick={() => openFoodPicker(meal.id)}
                          className="diet-control rounded-xl border border-border-primary px-4 py-2 text-sm font-black transition"
                        >
                          Tự chọn món
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </main>
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
