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
  { id: 'breakfast', label: 'BREAKFAST', time: '14:00' },
  { id: 'lunch', label: 'LUNCH', time: '19:00' },
  { id: 'dinner', label: 'DINNER', time: '02:00' },
  { id: 'snack', label: 'SNACK', time: '22:00' }
];

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
    <div className="diet-page-shell min-h-[calc(100vh-80px)] w-full animate-pulse rounded-[28px] p-4 md:p-7">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 h-10 w-64 rounded-2xl bg-bg-tertiary" />
        <div className="grid gap-7 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-5">
            <div className="h-80 rounded-[34px] bg-bg-tertiary" />
            <div className="h-24 rounded-[28px] bg-bg-tertiary" />
          </div>
          <div className="space-y-3">
            <div className="h-12 rounded-2xl bg-bg-tertiary" />
            <div className="h-32 rounded-[28px] bg-bg-tertiary" />
            <div className="h-36 rounded-[28px] bg-bg-tertiary" />
            <div className="h-32 rounded-[28px] bg-bg-tertiary" />
          </div>
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
      window.dispatchEvent(new CustomEvent('trendfit:water-updated', { detail: { waterIntake: nextLiters } }));
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
    <div className="diet-page-shell -mx-4 min-h-[calc(100vh-80px)] w-screen max-w-[100vw] flex-none overflow-x-hidden overflow-y-auto px-4 py-5 md:mx-0 md:w-full md:max-w-full md:rounded-[28px] md:px-7 md:py-6">
      <div className="mx-auto w-full max-w-6xl overflow-hidden">
        <div className="mb-6 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_488px] lg:items-start">
          <div className="min-w-0">
            <input
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
              className="diet-title w-full bg-transparent text-3xl font-black tracking-tight outline-none md:text-4xl"
              aria-label="Tên thực đơn"
            />
          </div>

          <div className="diet-tabs min-w-0 overflow-x-auto rounded-[20px] p-1">
            <div ref={dayTabContainerRef} className="relative grid min-w-[520px] grid-cols-7 gap-1 md:min-w-0">
              <span
                className={`diet-tab-indicator pointer-events-none absolute rounded-2xl transition-[transform,width,height,opacity] duration-300 ease-out ${dayIndicatorStyle.visible ? 'opacity-100' : 'opacity-0'}`}
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
                const label = isTodayLabel ? 'HÔM NAY' : day.label;

                return (
                  <button
                    key={day.id}
                    ref={(node) => {
                      dayTabRefs.current[day.id] = node;
                    }}
                    type="button"
                    onClick={() => setSelectedDayId(day.id)}
                    className={`inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-2xl font-black uppercase leading-tight transition ${
                      isTodayLabel
                        ? 'px-4 pt-[1px] text-[9px] tracking-[0.08em] sm:text-[10px]'
                        : 'px-3 text-[10px] tracking-[0.12em] sm:text-[11px]'
                    } ${
                      isSelected
                        ? 'diet-tab-selected relative z-10'
                        : 'diet-tab'
                    }`}
                    title={`${day.full} - ${dayDate.toLocaleDateString('vi-VN')}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-7 lg:grid-cols-[365px_minmax(0,1fr)] lg:items-start">
          <aside className="w-full min-w-0 max-w-full space-y-5 lg:sticky lg:top-5">
            <section className="diet-metric-card relative w-full min-w-0 max-w-full overflow-hidden rounded-[30px] border px-5 py-7 shadow-[0_18px_34px_rgba(15,23,42,0.18)] md:rounded-[34px] md:px-9 md:py-9">
              <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.38)_1px,transparent_0)] [background-size:18px_18px]" />
              <div className="relative">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-text-tertiary">Calories nạp vào</p>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-5xl font-black leading-none tracking-[-0.04em] md:text-6xl">{dayNutrition.calories.toLocaleString()}</span>
                  <span className="pb-2 text-lg font-black text-text-tertiary">/ {targetCalories.toLocaleString()}</span>
                </div>

                <div className="mt-11 space-y-6">
                  <MacroRow label="Protein" value={dayNutrition.protein} target={macroTargets.protein} color="#11d6a0" />
                  <MacroRow label="Carbs" value={dayNutrition.carbs} target={macroTargets.carbs} color="#61a7ff" />
                  <MacroRow label="Fats" value={dayNutrition.fat} target={macroTargets.fat} color="#ff9b22" />
                </div>
              </div>
            </section>

            <section className="diet-card w-full max-w-full rounded-[28px] border px-5 py-5">
              <div className="flex items-center gap-4">
                <span className="diet-water-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border">
                  <Droplet className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="diet-muted text-[11px] font-black uppercase tracking-[0.18em]">Nước uống</span>
                    <span className="text-[11px] font-black text-blue-500">
                      {waterIntake.toFixed(1)} / {waterGoal.toFixed(1)} L
                    </span>
                  </div>
                  <div className="diet-progress-track h-1 overflow-hidden rounded-full">
                    <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${waterProgress}%` }} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => saveWaterIntake(Math.min(waterGoal, roundMacro(waterIntake + 0.25)))}
                  className="diet-control flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
                  aria-label="Thêm nước"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </section>
          </aside>

          <main className="min-w-0">
            <div className="mb-7 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div>
                <h2 className="diet-title text-2xl font-black tracking-tight">Lịch trình bữa ăn</h2>
                <p className="diet-muted mt-1 text-sm font-semibold">
                  {DAYS[selectedDayId]?.full} - {dayNutrition.calories.toLocaleString()} kcal ({calorieProgress}% mục tiêu)
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveMealType(getCurrentMealType());
                  setFoodPickerOpen(true);
                }}
                className="diet-control inline-flex h-10 items-center justify-center gap-2 rounded-full border px-5 text-xs font-black transition"
              >
                <Bot className="h-4 w-4" />
                Tạo thực đơn
              </button>
            </div>

            {restDays[selectedDayId] ? (
              <div className="diet-card rounded-[28px] border px-6 py-12 text-center">
                <p className="diet-title text-lg font-black">Ngày nghỉ</p>
                <button
                  type="button"
                  onClick={() => setRestDays((prev) => ({ ...prev, [selectedDayId]: false }))}
                  className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-black text-black"
                >
                  Bắt đầu lên thực đơn
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {MEAL_TYPES.map((meal, mealIndex) => {
                  const mealItems = dayItems.filter((item) => item.meal_type === meal.id);
                  const mealCalories = Math.round(mealItems.reduce((sum, item) => sum + item.calories * item.quantity, 0));
                  const firstItem = mealItems[0];
                  const feedbackTarget = mealItems[0] || null;
                  const isActive = activeMealType === meal.id;
                  const names = mealItems.length > 0 ? mealItems.map((item) => item.name).join(' & ') : 'Chưa có món ăn';
                  const protein = roundMacro(mealItems.reduce((sum, item) => sum + item.protein * item.quantity, 0));
                  const carbs = roundMacro(mealItems.reduce((sum, item) => sum + item.carbs * item.quantity, 0));
                  const fat = roundMacro(mealItems.reduce((sum, item) => sum + item.fat * item.quantity, 0));

                  return (
                    <article
                      key={meal.id}
                      onClick={() => openFoodPicker(meal.id)}
                      className={`group min-w-0 cursor-pointer rounded-[28px] border transition ${
                        isActive
                          ? 'diet-meal-card-active'
                          : 'diet-meal-card'
                      }`}
                    >
                      <div className="flex min-h-[122px] items-center gap-4 px-4 py-4 sm:min-h-[138px] sm:gap-5 sm:px-5">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openFoodPicker(meal.id);
                          }}
                          className={`h-[92px] w-[92px] shrink-0 overflow-hidden rounded-xl sm:h-[100px] sm:w-[100px] ${
                            mealItems.length === 0 ? 'diet-empty-thumb border border-dashed' : ''
                          }`}
                          aria-label={`Thêm món cho ${meal.label}`}
                        >
                          {mealItems.length > 0 ? (
                            <FoodImage src={resolveFoodImage(firstItem as unknown as Food, mealIndex)} alt={firstItem.name} muted={!isActive && mealIndex >= 2} />
                          ) : (
                            <span className="diet-empty-thumb flex h-full w-full flex-col items-center justify-center gap-1">
                              <Plus className="h-5 w-5" />
                            </span>
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className={`mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] sm:text-[11px] ${isActive ? 'text-accent-hover' : 'diet-meal-meta'}`}>
                            {meal.label} + {meal.time}
                          </div>
                          <h3 className={`line-clamp-2 text-[15px] font-black leading-5 sm:text-base ${isActive ? 'text-accent-hover' : mealIndex >= 2 ? 'diet-meal-muted-name' : 'diet-strong'}`}>{names}</h3>
                          <div className={`mt-3 inline-flex items-center overflow-hidden rounded-xl border text-xs font-black ${
                            isActive ? 'border-accent/25 bg-accent/10 text-accent-muted' : 'diet-macro-pill'
                          }`}>
                            <span className="px-3 py-2">P: {protein}g</span>
                            <span className={`h-4 w-px ${isActive ? 'bg-border-primary' : 'diet-macro-separator'}`} />
                            <span className="px-3 py-2">C: {carbs}g</span>
                            <span className={`h-4 w-px ${isActive ? 'bg-border-primary' : 'diet-macro-separator'}`} />
                            <span className="px-3 py-2">F: {fat}g</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {[
                              { type: 'liked', label: 'Đã ăn' },
                              { type: 'disliked', label: 'Không thích' },
                              { type: 'not_enough', label: 'Không đủ no' },
                              { type: 'hard_to_cook', label: 'Khó nấu' },
                              { type: 'too_expensive', label: 'Đổi món' }
                            ].map((fb) => (
                              <button
                                key={fb.type}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (!feedbackTarget) return;
                                  void submitMealFeedback(
                                    feedbackTarget,
                                    fb.type as 'liked' | 'disliked' | 'too_much' | 'not_enough' | 'hard_to_cook' | 'too_expensive'
                                  );
                                }}
                                disabled={!feedbackTarget}
                                className="rounded-full border border-border-primary bg-bg-primary/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-accent/30 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {fb.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-start self-start pt-1 text-right sm:pt-2">
                          <div className="text-right">
                            <span className={`text-2xl font-black leading-none sm:text-[24px] ${isActive ? 'text-accent-hover' : mealIndex >= 2 ? 'diet-meal-muted-value' : 'diet-strong'}`}>
                              {mealCalories}
                            </span>
                            <span className={`ml-1 text-[10px] font-black ${isActive ? 'text-accent-muted' : 'diet-meal-meta'}`}>kcal</span>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </main>
        </div>
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
