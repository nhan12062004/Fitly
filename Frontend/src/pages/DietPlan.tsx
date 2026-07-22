import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Coffee,
  Flame,
  Moon,
  Plus,
  Search,
  RefreshCw,
  Sun,
  Trash2,
  Utensils,
  X
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { SkeletonBlock, SkeletonHero, SkeletonSurface } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';
import { fetchWithAuth } from '../lib/Api';
import { RecipeDetailModal } from '../components/RecipeDetailModal';

interface Food {
  id: string;
  catalog_type?: 'food' | 'recipe';
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_unit: string;
  image_url: string;
  meal_type?: string[];
}

interface RecipeIngredient {
  ingredient_name: string;
  amount: number | null;
  unit: string | null;
  preparation_note?: string | null;
  food?: {
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
    serving_unit?: string | null;
  } | null;
}

interface PlanFood {
  tempId: string;
  weekly_food_item_id?: string | null;
  food_id: string | null;
  recipe_id?: string | null;
  name: string;
  image_url: string;
  category: string;
  meal_type: string;
  quantity: number;
  serving_unit: string;
  // Stored per serving/unit. UI totals must multiply by quantity.
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  estimated_cost_min_vnd?: number | null;
  ingredients?: RecipeIngredient[];
  is_rest_day: boolean;
}

interface CompletedMealLog {
  id: string;
  weekly_food_item_id: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  quantity: number | null;
}

type MealTypeId = 'breakfast' | 'lunch' | 'snack' | 'dinner';

type DietPlanPageCache = {
  foods: Food[];
  selectedDayId: number;
  weeklyPlan: Record<number, PlanFood[]>;
  restDays: Record<number, boolean>;
  planId: string | null;
  planName: string;
  mealsPerDay: number;
  targetCalories: number;
  waterIntake: number;
  waterGoal: number;
  waterLogDate: string;
};

type SavePlanOptions = {
  weeklyPlanOverride?: Record<number, PlanFood[]>;
  restDaysOverride?: Record<number, boolean>;
  showSuccess?: boolean;
  successMessage?: string;
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

const resolveMealsPerDay = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(2, Math.min(5, Math.round(parsed)));
};

const getMealTypesForCount = (countValue: unknown) => {
  const count = resolveMealsPerDay(countValue);
  const ids: MealTypeId[] =
    count <= 2
      ? ['breakfast', 'dinner']
      : count === 3
        ? ['breakfast', 'lunch', 'dinner']
        : ['breakfast', 'lunch', 'dinner', 'snack'];
  const allowed = new Set(ids);
  return MEAL_TYPES.filter((meal) => allowed.has(meal.id));
};

const MEAL_TYPE_THEME: Record<MealTypeId, {
  accent: string;
  accentSoft: string;
  accentStrong: string;
  border: string;
}> = {
  breakfast: {
    accent: '#38bdf8',
    accentSoft: 'rgba(56,189,248,0.12)',
    accentStrong: 'rgba(56,189,248,0.24)',
    border: 'rgba(56,189,248,0.20)'
  },
  lunch: {
    accent: '#38bdf8',
    accentSoft: 'rgba(56,189,248,0.12)',
    accentStrong: 'rgba(56,189,248,0.24)',
    border: 'rgba(56,189,248,0.20)'
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

const FOOD_CATEGORIES = [
  'Bữa sáng',
  'Bữa trưa',
  'Bữa tối',
  'Bữa phụ',
  'Phở & Bún',
  'Cơm & Nui',
  'Bánh mì',
  'Cháo & Súp'
];

const getRecipeCategory = (name: string, mealType: string[]): string => {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('cơm') || nameLower.includes('nui') || nameLower.includes('xôi')) {
    return 'Cơm & Nui';
  }
  if (nameLower.includes('phở') || nameLower.includes('bún') || nameLower.includes('miến') || nameLower.includes('bánh đa')) {
    return 'Phở & Bún';
  }
  if (nameLower.includes('bánh mì')) {
    return 'Bánh mì';
  }
  if (nameLower.includes('cháo') || nameLower.includes('súp')) {
    return 'Cháo & Súp';
  }
  if (
    nameLower.includes('sữa chua') || nameLower.includes('yến mạch') || nameLower.includes('chuối') ||
    nameLower.includes('táo') || nameLower.includes('phô mai') || nameLower.includes('khoai') ||
    nameLower.includes('ngô') || nameLower.includes('trứng luộc') || mealType.includes('snack')
  ) {
    return 'Bữa phụ';
  }
  return 'Món chính';
};
const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CALORIE_TARGET = 2400;
const DEFAULT_WATER_TARGET = 2.5;
const DEFAULT_PLAN_NAME = 'Thực đơn';

const normalizeFoodText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

const formatFoodQuantity = (item: Pick<PlanFood, 'quantity' | 'serving_unit'>) => {
  const unit = item.serving_unit || '100g';
  const quantity = Number(item.quantity || 1);
  const normalizedUnit = normalizeFoodText(unit);
  if (normalizedUnit.includes('100g') || normalizedUnit.includes('100 g')) {
    return `${Math.round(quantity * 100)}g`;
  }
  if (Math.abs(quantity - 1) < 0.01) return unit;
  return `${roundMacro(quantity)} x ${unit}`;
};

const formatIngredientAmount = (ingredient: RecipeIngredient) => {
  if (ingredient.amount === null || ingredient.amount === undefined) return ingredient.unit || 'Vừa đủ';
  return `${roundMacro(ingredient.amount)}${ingredient.unit ? ` ${ingredient.unit}` : ''}`;
};

const formatVnd = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.max(0, Math.round(value)))}đ`;

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

// Manual additions are intentionally neutral. Portion and meal-balance rules
// belong to Backend/services/mealPlanningService.ts, never to this page.
const createPlanFood = (food: Food, mealType: MealTypeId, quantity = 1): PlanFood => ({
  tempId: crypto.randomUUID(),
  weekly_food_item_id: null,
  food_id: food.catalog_type === 'recipe' ? null : food.id,
  recipe_id: food.catalog_type === 'recipe' ? food.id : null,
  name: food.name,
  image_url: food.image_url,
  category: food.category || (food.catalog_type === 'recipe' ? 'Món ăn' : ''),
  meal_type: mealType,
  quantity,
  serving_unit: food.serving_unit,
  calories: food.calories,
  protein: food.protein,
  carbs: food.carbs,
  fat: food.fat,
  is_rest_day: false
});

const resolveFoodImage = (food: Pick<Food, 'image_url'> | undefined, index: number) => {
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
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-green-500">Thêm vào {mealLabel}</p>
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
              <Plus className="h-4 w-4 text-green-500" />
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
  const toast = useToast();
  const alert = (message: unknown) => {
    const text = String(message || '');
    if (/lỗi|loi|không thể|khong the|vui lòng|vui long|bạn cần|ban can/i.test(text)) {
      toast.error(text);
      return;
    }
    toast.success(text);
  };
  const initialWeekStart = getWeekStart(getVietnamTodayDate());
  const initialWeekKey = toDateKey(initialWeekStart);
  const initialTodayKey = getVietnamDateKey();
  const initialDietCache = user?.id ? dietPlanPageCache.get(`${user.id}:${initialWeekKey}`) || null : null;
  const initialWaterIntake = initialDietCache?.waterLogDate === initialTodayKey ? initialDietCache.waterIntake : 0;
  const dayTabContainerRef = useRef<HTMLDivElement | null>(null);
  const dayTabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [foods, setFoods] = useState<Food[]>(() => initialDietCache?.foods || dietPlanFoodCache || []);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState(() => initialDietCache?.selectedDayId ?? getTodayDayIndex());
  const [weeklyPlan, setWeeklyPlan] = useState<Record<number, PlanFood[]>>(() => initialDietCache?.weeklyPlan || {});
  const [restDays, setRestDays] = useState<Record<number, boolean>>(() => initialDietCache?.restDays || {});
  const [planId, setPlanId] = useState<string | null>(() => initialDietCache?.planId || null);
  const [planName, setPlanName] = useState(() => initialDietCache?.planName || DEFAULT_PLAN_NAME);
  const [isLoading, setIsLoading] = useState(() => !initialDietCache);
  const [, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [replacingFoodId, setReplacingFoodId] = useState<string | null>(null);
  const [completingFoodId, setCompletingFoodId] = useState<string | null>(null);
  const [completedMealLogs, setCompletedMealLogs] = useState<CompletedMealLog[]>([]);
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(initialWeekStart);
  const [mealsPerDay, setMealsPerDay] = useState(() => initialDietCache?.mealsPerDay || 3);
  const [targetCalories, setTargetCalories] = useState(() => initialDietCache?.targetCalories || DEFAULT_CALORIE_TARGET);
  const [waterIntake, setWaterIntake] = useState(() => initialWaterIntake);
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
  const selectedDayDate = useMemo(() => addDays(selectedWeekStart, selectedDayId), [selectedDayId, selectedWeekStart]);
  const selectedDayKey = useMemo(() => toDateKey(selectedDayDate), [selectedDayDate]);
  const cacheKey = user?.id ? `${user.id}:${selectedWeekKey}` : null;
  const isCurrentWeek = selectedWeekKey === toDateKey(getWeekStart(getVietnamTodayDate()));

  const dayItems = weeklyPlan[selectedDayId] || [];
  const activeMealTypes = useMemo(() => getMealTypesForCount(mealsPerDay), [mealsPerDay]);
  const activeMealTypeIds = useMemo(() => new Set(activeMealTypes.map((meal) => meal.id)), [activeMealTypes]);
  const scopedDayItems = useMemo(
    () => dayItems.filter((item) => activeMealTypeIds.has(item.meal_type as MealTypeId)),
    [dayItems, activeMealTypeIds]
  );

  useEffect(() => {
    if (!activeMealTypeIds.has(activeMealType)) {
      setActiveMealType(activeMealTypes[0]?.id || 'breakfast');
    }
  }, [activeMealType, activeMealTypeIds, activeMealTypes]);

  const filteredFoods = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return foods.filter((food) => {
      const matchesSearch = !needle || food.name.toLowerCase().includes(needle);
      if (!matchesSearch) return false;
      if (filterCat === 'all') return true;

      const catLower = filterCat.toLowerCase();
      const foodCatLower = (food.category || '').toLowerCase();
      const foodNameLower = (food.name || '').toLowerCase();
      const foodMealTypes = food.meal_type || [];

      if (catLower === 'bữa sáng') return foodMealTypes.includes('breakfast') || foodCatLower === 'bữa sáng';
      if (catLower === 'bữa trưa') return foodMealTypes.includes('lunch') || foodCatLower === 'bữa trưa';
      if (catLower === 'bữa tối') return foodMealTypes.includes('dinner') || foodCatLower === 'bữa tối';
      if (catLower === 'bữa phụ') {
        return foodMealTypes.includes('snack') || foodMealTypes.includes('pre_workout') || foodMealTypes.includes('post_workout') || foodCatLower === 'bữa phụ';
      }

      if (catLower.includes('phở') || catLower.includes('bún')) {
        return (
          foodCatLower.includes('phở') || foodCatLower.includes('bún') ||
          foodNameLower.includes('phở') || foodNameLower.includes('bún') || foodNameLower.includes('miến') || foodNameLower.includes('bánh đa')
        );
      }

      if (catLower.includes('cơm') || catLower.includes('nui')) {
        return (
          foodCatLower.includes('cơm') || foodCatLower.includes('nui') ||
          foodNameLower.includes('cơm') || foodNameLower.includes('nui') || foodNameLower.includes('xôi')
        );
      }

      if (catLower.includes('bánh mì')) {
        return foodCatLower.includes('bánh mì') || foodNameLower.includes('bánh mì');
      }

      if (catLower.includes('cháo') || catLower.includes('súp')) {
        return foodCatLower.includes('cháo') || foodCatLower.includes('súp') || foodNameLower.includes('cháo') || foodNameLower.includes('súp');
      }

      return foodCatLower === catLower || foodCatLower.includes(catLower);
    });
  }, [foods, search, filterCat]);

  const dayNutrition = useMemo(() => {
    const totals = scopedDayItems.reduce(
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
  }, [scopedDayItems]);

  const completedNutrition = useMemo(() => {
    const totals = completedMealLogs.reduce(
      (sum, log) => {
        const quantity = Math.max(0, Number(log.quantity || 1));
        sum.calories += Number(log.calories || 0) * quantity;
        sum.protein += Number(log.protein || 0) * quantity;
        sum.carbs += Number(log.carbs || 0) * quantity;
        sum.fat += Number(log.fat || 0) * quantity;
        return sum;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    return {
      calories: Math.round(totals.calories),
      protein: roundMacro(totals.protein),
      carbs: roundMacro(totals.carbs),
      fat: roundMacro(totals.fat)
    };
  }, [completedMealLogs]);

  const completedWeeklyItemIds = useMemo(
    () => new Set(completedMealLogs.map((log) => log.weekly_food_item_id).filter((id): id is string => Boolean(id))),
    [completedMealLogs]
  );
  const getProgress = (completed: number, planned: number) =>
    Math.min(100, Math.round((completed / Math.max(1, planned)) * 100));
  const calorieProgress = getProgress(completedNutrition.calories, dayNutrition.calories);
  const proteinProgress = getProgress(completedNutrition.protein, dayNutrition.protein);
  const carbProgress = getProgress(completedNutrition.carbs, dayNutrition.carbs);
  const fatProgress = getProgress(completedNutrition.fat, dayNutrition.fat);
  const remainingCalories = Math.max(0, dayNutrition.calories - completedNutrition.calories);
  const remainingProtein = Math.max(0, dayNutrition.protein - completedNutrition.protein);
  const remainingCarbs = Math.max(0, dayNutrition.carbs - completedNutrition.carbs);
  const remainingFat = Math.max(0, dayNutrition.fat - completedNutrition.fat);
  const isTodaySelected = toDateKey(selectedDayDate) === todayKey;
  const currentMealType = getCurrentMealType();
  const highlightedMealId = isTodaySelected && activeMealTypeIds.has(currentMealType) ? currentMealType : null;
  const mealSummaries = useMemo(
    () =>
      activeMealTypes.map((meal, mealIndex) => {
        const items = scopedDayItems.filter((item) => item.meal_type === meal.id);
        const mealCalories = Math.round(items.reduce((sum, item) => sum + item.calories * item.quantity, 0));
        const firstItem = items[0];
        const hasItems = items.length > 0;
        const protein = roundMacro(items.reduce((sum, item) => sum + item.protein * item.quantity, 0));
        const carbs = roundMacro(items.reduce((sum, item) => sum + item.carbs * item.quantity, 0));
        const fat = roundMacro(items.reduce((sum, item) => sum + item.fat * item.quantity, 0));
        const categories = Array.from(new Set(items.map((item) => item.category).filter(Boolean)));
        const completedItemCount = items.filter(
          (item) => Boolean(item.weekly_food_item_id && completedWeeklyItemIds.has(item.weekly_food_item_id))
        ).length;

        return {
          ...meal,
          mealIndex,
          items,
          completedItemCount,
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
    [activeMealTypes, scopedDayItems, highlightedMealId, completedWeeklyItemIds]
  );
  const visibleMealSummaries = useMemo(() => mealSummaries.filter((meal) => meal.hasItems), [mealSummaries]);
  const hasMenuForSelectedDay = visibleMealSummaries.length > 0;

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
      if (dietPlanFoodCache?.some((item) => item.catalog_type === 'recipe' && item.category !== 'Món ăn')) {
        setFoods(dietPlanFoodCache);
        return;
      }

      const [foodsResult, recipesResult] = await Promise.all([
        supabase.from('foods').select('*').order('name'),
        supabase.from('recipes').select('id, name, image_url, calories, protein, carbs, fat, serving_unit, meal_type').eq('is_active', true).order('name')
      ]);
      if (foodsResult.error || recipesResult.error) {
        console.error(foodsResult.error || recipesResult.error);
        return;
      }

      if (!cancelled) {
        const normalizedFoods = (foodsResult.data || []).map((food: any) => ({
          id: food.id,
          catalog_type: 'food' as const,
          name: food.name || '',
          category: food.category || '',
          calories: Number(food.calories || 0),
          protein: Number(food.protein || 0),
          carbs: Number(food.carbs || 0),
          fat: Number(food.fat || 0),
          serving_unit: food.serving_unit || '100g',
          image_url: food.image_url || '',
          meal_type: Array.isArray(food.meal_type)
            ? food.meal_type.map((item: unknown) => String(item || '').toLowerCase()).filter(Boolean)
            : []
        }));
        const normalizedRecipes = (recipesResult.data || []).map((recipe: any) => {
          const mealType = Array.isArray(recipe.meal_type)
            ? recipe.meal_type.map((item: unknown) => String(item || '').toLowerCase()).filter(Boolean)
            : [];
          return {
            id: recipe.id,
            catalog_type: 'recipe' as const,
            name: recipe.name || '',
            category: getRecipeCategory(recipe.name || '', mealType),
            calories: Number(recipe.calories || 0),
            protein: Number(recipe.protein || 0),
            carbs: Number(recipe.carbs || 0),
            fat: Number(recipe.fat || 0),
            serving_unit: recipe.serving_unit || 'phần',
            image_url: recipe.image_url || '',
            meal_type: mealType
          };
        });
        const catalog = [...normalizedRecipes, ...normalizedFoods];
        dietPlanFoodCache = catalog;
        setFoods(catalog);
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
          supabase.from('lifestyle_settings').select('target_calories, daily_water_goal, meals_per_day').eq('user_id', userId).maybeSingle(),
          supabase.from('daily_progress_logs').select('water_intake_ml').eq('user_id', userId).eq('log_date', today).maybeSingle()
        ]);

        if (lifestyleRes.data?.target_calories) setTargetCalories(Number(lifestyleRes.data.target_calories));
        if (lifestyleRes.data?.daily_water_goal) setWaterGoal(Number(lifestyleRes.data.daily_water_goal));
        setMealsPerDay(resolveMealsPerDay(lifestyleRes.data?.meals_per_day));
        setWaterIntake(Number(progressRes.data?.water_intake_ml || 0) / 1000);
      } catch (error) {
        console.error(error);
      }
    }

    fetchTargets();
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    async function fetchCompletedMeals() {
      if (!user) {
        setCompletedMealLogs([]);
        return;
      }

      const { data, error } = await supabase
        .from('daily_meal_logs')
        .select('id, weekly_food_item_id, calories, protein, carbs, fat, quantity')
        .eq('user_id', user.id)
        .eq('log_date', selectedDayKey)
        .eq('is_completed', true);

      if (error) {
        console.error(error);
        return;
      }

      if (!cancelled) setCompletedMealLogs((data || []) as CompletedMealLog[]);
    }

    void fetchCompletedMeals();
    return () => {
      cancelled = true;
    };
  }, [selectedDayKey, user]);

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
        setMealsPerDay(cached.mealsPerDay || 3);
        setTargetCalories(cached.targetCalories);
        setWaterIntake(cached.waterLogDate === getVietnamDateKey() ? cached.waterIntake : 0);
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
            .gte('week_start_date', toDateKey(addDays(selectedWeekStart, -6)))
            .lte('week_start_date', toDateKey(addDays(selectedWeekStart, 6)))
            .eq('plan_status', 'active')
            .order('week_start_date', { ascending: false })
            .limit(20);

          if (error) throw error;
          const todayPlanStartKey = toDateKey(addDays(getVietnamTodayDate(), -6));
          const todayKey = getVietnamDateKey();
          const plan = [...(plans || [])]
            .filter((item: any) => {
              const startKey = String(item.week_start_date || '');
              return startKey >= todayPlanStartKey && startKey <= todayKey;
            })
            .sort((a: any, b: any) => String(b.week_start_date || '').localeCompare(String(a.week_start_date || '')))[0]
            || pickLatestPlan(plans);

          if (plan) {
            const planStartKey = String(plan.week_start_date || '');
            if (planStartKey && planStartKey !== selectedWeekKey) {
              const planStartDate = new Date(`${planStartKey}T00:00:00`);
              const todayOffset = Math.max(0, Math.min(6, Math.round((getVietnamTodayDate().getTime() - planStartDate.getTime()) / (24 * 60 * 60 * 1000))));
              if (!cancelled) {
                setSelectedWeekStart(planStartDate);
                setSelectedDayId(todayOffset);
              }
              return;
            }
            nextPlanId = plan.id;
            nextPlanName = plan.name === 'Kế hoạch ăn uống tuần' ? DEFAULT_PLAN_NAME : (plan.name || DEFAULT_PLAN_NAME);

            const { data: items, error: itemsError } = await supabase
              .from('weekly_food_items')
              .select('*, foods:food_id (name, image_url, category, calories, protein, carbs, fat, serving_unit), recipes:recipe_id (name, image_url, calories, protein, carbs, fat, estimated_cost_min_vnd, serving_unit, recipe_ingredients(ingredient_name, amount, unit, preparation_note, foods:food_id(calories, protein, carbs, fat, serving_unit)))')
              .eq('food_plan_id', plan.id)
              .order('order_index');

            if (itemsError) throw itemsError;

            items?.forEach((item: any) => {
              const day = Number(item.day_of_week || 0);
              if (item.is_rest_day) {
                nextRestDays[day] = true;
                return;
              }

              const joinedFood = item.recipe_id ? (item.recipes || {}) : (item.foods || {});
              if (!nextWeek[day]) nextWeek[day] = [];
              nextWeek[day].push({
                tempId: item.id || crypto.randomUUID(),
                weekly_food_item_id: item.id || null,
                food_id: item.food_id,
                recipe_id: item.recipe_id || null,
                name: joinedFood.name || 'Món ăn',
                image_url: joinedFood.image_url || '',
                category: joinedFood.category || '',
                meal_type: item.meal_type || 'breakfast',
                quantity: Number(item.quantity || 1),
                serving_unit: joinedFood.serving_unit || '100g',
                calories: Number(joinedFood.calories ?? item.calories ?? 0),
                protein: Number(joinedFood.protein ?? item.protein ?? 0),
                carbs: Number(joinedFood.carbs ?? item.carbs ?? 0),
                fat: Number(joinedFood.fat ?? item.fat ?? 0),
                estimated_cost_min_vnd: joinedFood.estimated_cost_min_vnd === null || joinedFood.estimated_cost_min_vnd === undefined ? null : Number(joinedFood.estimated_cost_min_vnd),
                ingredients: item.recipe_id ? (joinedFood.recipe_ingredients || []).map((ingredient: any) => ({
                  ingredient_name: String(ingredient.ingredient_name || 'Nguyên liệu'),
                  amount: ingredient.amount === null || ingredient.amount === undefined ? null : Number(ingredient.amount),
                  unit: ingredient.unit || null,
                  preparation_note: ingredient.preparation_note || null,
                  food: ingredient.foods || null
                })) : [],
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
    // Do not cache the initial empty state while Supabase is still loading.
    // Otherwise a subsequent visit treats that placeholder as real data and
    // briefly renders every nutrition total as zero.
    if (!cacheKey || isLoading) return;
    dietPlanPageCache.set(cacheKey, {
      foods,
      selectedDayId,
      weeklyPlan,
      restDays,
      planId,
      planName,
      mealsPerDay,
      targetCalories,
      waterIntake,
      waterGoal,
      waterLogDate: getVietnamDateKey()
    });
  }, [cacheKey, isLoading, foods, selectedDayId, weeklyPlan, restDays, planId, planName, mealsPerDay, targetCalories, waterIntake, waterGoal]);

  const addFoodToPlan = useCallback((food: Food, mealType: MealTypeId = activeMealType) => {
    const nextWeeklyPlan = {
      ...weeklyPlan,
      [selectedDayId]: [
        ...(weeklyPlan[selectedDayId] || []),
        createPlanFood(food, mealType)
      ]
    };
    const nextRestDays = { ...restDays, [selectedDayId]: false };

    setWeeklyPlan(nextWeeklyPlan);
    setRestDays(nextRestDays);
    setFoodPickerOpen(false);
    void savePlan({
      weeklyPlanOverride: nextWeeklyPlan,
      restDaysOverride: nextRestDays,
      showSuccess: false
    });
  }, [activeMealType, restDays, selectedDayId, weeklyPlan]);

  const openFoodPicker = (mealType: MealTypeId) => {
    setActiveMealType(mealType);
    setSearch('');
    setFilterCat('all');
    setFoodPickerOpen(true);
  };

  const autoCreateMenu = async () => {
    if (!user?.id) {
      toast.error('Vui lòng đăng nhập để tạo thực đơn AI.');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetchWithAuth('/api/ai-coach/generate-meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'day',
          weekStartDate: selectedWeekKey,
          dayIndex: selectedDayId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Không thể tạo thực đơn AI cho ngày này.');

      const generatedItems = Array.isArray(payload?.data?.mealItems) ? payload.data.mealItems : [];
      const nextItems: PlanFood[] = generatedItems
        .filter((item: any) => Number(item?.day_of_week) === selectedDayId)
        .map((item: any) => ({
          tempId: crypto.randomUUID(),
          weekly_food_item_id: null,
          food_id: item.recipe_id ? null : (String(item.food_id || '') || null),
          recipe_id: String(item.recipe_id || '') || null,
          name: String(item.name || 'Món ăn AI chọn'),
          image_url: String(item.image_url || ''),
          category: String(item.category || ''),
          meal_type: String(item.meal_type || 'lunch'),
          quantity: Number(item.quantity || 1),
          serving_unit: String(item.serving_unit || '100g'),
          calories: Number(item.calories || 0),
          protein: Number(item.protein || 0),
          carbs: Number(item.carbs || 0),
          fat: Number(item.fat || 0),
          is_rest_day: false,
        }));
      if (!nextItems.length) throw new Error('AI chưa trả về món hợp lệ cho ngày này.');

      const nextWeeklyPlan = { ...weeklyPlan, [selectedDayId]: nextItems };
      const nextRestDays = { ...restDays, [selectedDayId]: false };
      setWeeklyPlan(nextWeeklyPlan);
      setRestDays(nextRestDays);
      await savePlan({
        weeklyPlanOverride: nextWeeklyPlan,
        restDaysOverride: nextRestDays,
        showSuccess: false,
      });
      toast.success('Đã tạo thực đơn AI cho ngày đang chọn.');
    } catch (error: any) {
      toast.error(error?.message || 'Không thể tạo thực đơn AI cho ngày này.');
    } finally {
      setIsSaving(false);
    }
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

  const savePlan = async (options: SavePlanOptions = {}) => {
    if (!user) {
      alert('Vui lòng đăng nhập để lưu thực đơn.');
      return false;
    }

    const planToSave = options.weeklyPlanOverride || weeklyPlan;
    const restDaysToSave = options.restDaysOverride || restDays;
    const showSuccess = options.showSuccess ?? true;

    setIsSaving(true);
    try {
      const foodIds = Object.values(planToSave).flatMap((items) => items.map((item) => item.food_id).filter((id): id is string => Boolean(id)));
      const recipeIds = Object.values(planToSave).flatMap((items) => items.map((item) => item.recipe_id).filter((id): id is string => Boolean(id)));
      const validationResponse = await fetchWithAuth('/api/meal-plans/validate-foods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food_ids: foodIds, recipe_ids: recipeIds }),
      });
      if (!validationResponse.ok) {
        const payload = await validationResponse.json().catch(() => ({}));
        throw new Error(payload?.error || 'Một số món không phù hợp với hồ sơ ăn uống của bạn.');
      }
      let nextPlanId = planId;

      if (!nextPlanId) {
        const { data: existingPlans } = await supabase
          .from('weekly_food_plans')
          .select('*')
          .eq('user_id', user.id)
          .eq('week_start_date', selectedWeekKey)
          .eq('plan_status', 'active')
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
        if (restDaysToSave[dayIndex]) {
          rows.push({ food_plan_id: nextPlanId, day_of_week: dayIndex, meal_type: 'breakfast', is_rest_day: true, order_index: 0 });
          return;
        }

        (planToSave[dayIndex] || [])
          .filter((item) => activeMealTypeIds.has(item.meal_type as MealTypeId))
          .forEach((item, index) => {
          rows.push({
            food_plan_id: nextPlanId,
            day_of_week: dayIndex,
            meal_type: item.meal_type,
            food_id: item.food_id,
            recipe_id: item.recipe_id || null,
            quantity: item.quantity,
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            order_index: index
          });
        });
      });

      let insertedItems: Array<{ id: string; day_of_week: number; order_index: number }> = [];
      if (rows.length > 0) {
        const { data, error } = await supabase
          .from('weekly_food_items')
          .insert(rows)
          .select('id, day_of_week, order_index');
        if (error) throw error;
        insertedItems = data || [];
      }

      const insertedIdByDayAndOrder = new Map(
        insertedItems.map((item) => [`${Number(item.day_of_week)}:${Number(item.order_index)}`, String(item.id)])
      );
      const planWithSavedIds = DAYS.reduce<Record<number, PlanFood[]>>((acc, { id: dayIndex }) => {
        acc[dayIndex] = (planToSave[dayIndex] || [])
          .filter((item) => activeMealTypeIds.has(item.meal_type as MealTypeId))
          .map((item, index) => ({
            ...item,
            weekly_food_item_id: insertedIdByDayAndOrder.get(`${dayIndex}:${index}`) || item.weekly_food_item_id || null
          }));
        return acc;
      }, {});

      setWeeklyPlan(planWithSavedIds);
      setRestDays(restDaysToSave);

      if (showSuccess) alert(options.successMessage || 'Đã lưu thực đơn.');
      return true;
    } catch (error: any) {
      alert(`Không thể lưu thực đơn: ${error.message}`);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const removeFoodFromPlan = async (item: PlanFood) => {
    const nextWeeklyPlan = {
      ...weeklyPlan,
      [selectedDayId]: (weeklyPlan[selectedDayId] || []).filter((entry) => entry.tempId !== item.tempId)
    };
    const nextRestDays = { ...restDays, [selectedDayId]: false };

    setWeeklyPlan(nextWeeklyPlan);
    setRestDays(nextRestDays);

    await savePlan({
      weeklyPlanOverride: nextWeeklyPlan,
      restDaysOverride: nextRestDays,
      showSuccess: false
    });
  };

  const suggestAlternativeFood = (item: PlanFood): Food | null => {
    if (!foods.length) return null;
    const currentCatalogId = item.recipe_id || item.food_id;
    const candidates = foods.filter((food) => {
      const supportsMeal = !food.meal_type?.length || food.meal_type.includes(item.meal_type);
      return food.id !== currentCatalogId && supportsMeal;
    });
    if (!candidates.length) return null;

    const score = (food: Food) => {
      const caloriesGap = Math.abs(food.calories - item.calories);
      const proteinGap = Math.abs(food.protein - item.protein);
      const sameCategoryBonus = food.category === item.category ? -20 : 0;
      return caloriesGap + proteinGap * 2 + sameCategoryBonus;
    };

    return [...candidates].sort((a, b) => score(a) - score(b))[0] || null;
  };

  const replaceFoodInPlan = async (item: PlanFood) => {
    if (isSaving || replacingFoodId) return;

    const replacement = suggestAlternativeFood(item);
    if (!replacement) {
      toast.error('Chưa tìm được món thay thế phù hợp cho bữa này.');
      return;
    }

    const nextDayItems = (weeklyPlan[selectedDayId] || []).map((entry) =>
      entry.tempId === item.tempId
        ? {
            ...createPlanFood(replacement, item.meal_type as MealTypeId, item.quantity),
            tempId: entry.tempId,
            weekly_food_item_id: null
          }
        : entry
    );
    const nextWeeklyPlan = { ...weeklyPlan, [selectedDayId]: nextDayItems };

    setReplacingFoodId(item.tempId);
    setWeeklyPlan(nextWeeklyPlan);
    const saved = await savePlan({
      weeklyPlanOverride: nextWeeklyPlan,
      restDaysOverride: restDays,
      showSuccess: false
    });
    if (saved) {
      toast.success(`Đã đổi ${item.name} sang ${replacement.name}.`);
    } else {
      setWeeklyPlan(weeklyPlan);
    }
    setReplacingFoodId(null);
  };

  const completeMealItem = async (item: PlanFood) => {
    if (!user) {
      toast.error('Vui lòng đăng nhập để ghi nhận bữa ăn.');
      return;
    }

    if (!item.weekly_food_item_id) {
      toast.error('Bạn cần lưu thực đơn trước khi ghi nhận bữa ăn.');
      return;
    }

    if (completedWeeklyItemIds.has(item.weekly_food_item_id)) return;

    setCompletingFoodId(item.tempId);
    const payload = {
      user_id: user.id,
      weekly_food_item_id: item.weekly_food_item_id,
      food_id: item.food_id,
      log_date: selectedDayKey,
      meal_type: item.meal_type,
      quantity: item.quantity,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
      is_completed: true,
      eaten_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('daily_meal_logs')
      .insert(payload)
      .select('id, weekly_food_item_id, calories, protein, carbs, fat, quantity')
      .single();

    if (error) {
      toast.error(`Không thể ghi nhận bữa ăn: ${error.message}`);
      setCompletingFoodId(null);
      return;
    }

    setCompletedMealLogs((previous) => [...previous, data as CompletedMealLog]);
    setCompletingFoodId(null);
    toast.success(`Đã ghi nhận ${item.name}.`);
  };

  const toggleMealItemCompletion = async (item: PlanFood) => {
    if (!item.weekly_food_item_id || !completedWeeklyItemIds.has(item.weekly_food_item_id)) {
      await completeMealItem(item);
      return;
    }

    const logsToRemove = completedMealLogs.filter((log) => log.weekly_food_item_id === item.weekly_food_item_id);
    if (logsToRemove.length === 0) return;

    setCompletingFoodId(item.tempId);
    const { error } = await supabase
      .from('daily_meal_logs')
      .delete()
      .in('id', logsToRemove.map((log) => log.id));

    if (error) {
      toast.error(`Không thể hoàn tác bữa ăn: ${error.message}`);
      setCompletingFoodId(null);
      return;
    }

    const logIdsToRemove = new Set(logsToRemove.map((log) => log.id));
    setCompletedMealLogs((previous) => previous.filter((log) => !logIdsToRemove.has(log.id)));
    setCompletingFoodId(null);
    toast.success(`Đã hoàn tác ghi nhận ${item.name}.`);
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

      const nextDayItems = (weeklyPlan[selectedDayId] || []).map((entry) =>
        entry.tempId === item.tempId
          ? {
              ...entry,
              weekly_food_item_id: null,
              food_id: replacement.id,
              name: replacement.name,
              image_url: replacement.image_url,
              category: replacement.category,
              serving_unit: replacement.serving_unit,
              calories: replacement.calories,
              protein: replacement.protein,
              carbs: replacement.carbs,
              fat: replacement.fat
            }
          : entry
      );
      const nextWeeklyPlan = { ...weeklyPlan, [selectedDayId]: nextDayItems };
      setWeeklyPlan(nextWeeklyPlan);
      await savePlan({
        weeklyPlanOverride: nextWeeklyPlan,
        restDaysOverride: restDays,
        showSuccess: false
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
        <section className="diet-card diet-today-shell rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
          <div className="flex flex-col gap-4">
            <div className="diet-day-tabs diet-week-calendar overflow-visible px-1 py-2">
              <div ref={dayTabContainerRef} className="grid min-w-0 grid-cols-7 gap-1.5 sm:gap-2">
                {DAYS.map((day) => {
                  const dayDate = addDays(selectedWeekStart, day.id);
                  const isToday = toDateKey(dayDate) === todayKey;
                  const isSelected = selectedDayId === day.id;
                  const isTodayLabel = isCurrentWeek && isToday;
                  const compactWeekdayLabel = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][day.id];

                  return (
                    <button
                      key={day.id}
                      ref={(node) => {
                        dayTabRefs.current[day.id] = node;
                      }}
                      type="button"
                      onClick={() => setSelectedDayId(day.id)}
                      className={`diet-week-day relative inline-flex min-h-[66px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl border px-1 font-black transition sm:min-h-[68px] ${
                        isSelected ? 'diet-week-day-selected' : isTodayLabel ? 'diet-week-day-today' : 'diet-week-day-default'
                      }`}
                      title={dayDate.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' })}
                    >
                      {isTodayLabel ? <span className="diet-week-today-label">NAY</span> : null}
                      <span className="text-[11px] leading-none sm:text-xs">{compactWeekdayLabel}</span>
                      <span className="text-base leading-none sm:text-lg">{dayDate.getDate()}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="diet-macro-grid grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="diet-today-calories diet-macro-card rounded-xl border px-3 py-2.5 md:px-4 md:py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="diet-macro-card-label text-[11px] font-black uppercase tracking-[0.12em]">Calories</p>
                  <span className="diet-macro-card-label text-xs font-black">{calorieProgress}%</span>
                </div>
                <p className="mt-2 text-base font-black text-text-primary md:text-lg">
                  {completedNutrition.calories.toLocaleString()} / {dayNutrition.calories.toLocaleString()}
                </p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">Còn {remainingCalories.toLocaleString()} kcal</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                  <div className="diet-macro-card-fill h-full rounded-full transition-all" style={{ width: `${calorieProgress}%` }} />
                </div>
              </div>
              <div className="diet-today-protein diet-macro-card rounded-xl border px-3 py-2.5 md:px-4 md:py-3">
                <p className="diet-macro-card-label text-[11px] font-black uppercase tracking-[0.12em]">Protein</p>
                <p className="mt-2 text-base font-black text-text-primary md:text-lg">{Math.round(completedNutrition.protein)} / {Math.round(dayNutrition.protein)}g</p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">Thiếu {Math.round(remainingProtein)}g</p>
                <div className="mt-3 flex gap-1">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-1.5 flex-1 rounded-full ${index < Math.ceil((proteinProgress / 100) * 4) ? 'diet-macro-card-fill' : 'bg-bg-tertiary'}`}
                    />
                  ))}
                </div>
              </div>
              <div className="diet-today-fat diet-macro-card rounded-xl border px-3 py-2.5 md:px-4 md:py-3">
                <p className="diet-macro-card-label text-[11px] font-black uppercase tracking-[0.12em]">Fat</p>
                <p className="mt-2 text-base font-black text-text-primary md:text-lg">{Math.round(completedNutrition.fat)} / {Math.round(dayNutrition.fat)}g</p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">Thiếu {Math.round(remainingFat)}g</p>
                <div className="mt-3 flex gap-1">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-1.5 flex-1 rounded-full ${index < Math.ceil((fatProgress / 100) * 4) ? 'diet-macro-card-fill' : 'bg-bg-tertiary'}`}
                    />
                  ))}
                </div>
              </div>
              <div className="diet-today-carbs diet-macro-card rounded-xl border px-3 py-2.5 md:px-4 md:py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="diet-macro-card-label text-[11px] font-black uppercase tracking-[0.12em]">Bữa</p>
                  <span className="diet-macro-card-label text-xs font-black">{carbProgress}%</span>
                </div>
                <p className="mt-2 text-base font-black text-text-primary md:text-lg">{Math.round(completedNutrition.carbs)} / {Math.round(dayNutrition.carbs)}g</p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">Thiếu {Math.round(remainingCarbs)}g</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                  <div className="diet-macro-card-fill h-full rounded-full transition-all" style={{ width: `${carbProgress}%` }} />
                </div>
              </div>
            </div>

            {restDays[selectedDayId] ? (
              <div className="themed-subtle-panel rounded-[22px] border px-5 py-6 text-text-primary">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-warning">Recovery day</p>
                <h2 className="mt-2 text-2xl font-black leading-tight">Ngày nghỉ để hồi phục</h2>
                <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-text-secondary">
                  Không cần hiển thị quá nhiều chi tiết cho ngày này. Bạn có thể bật lại thực đơn hoặc để AI tạo lại menu nhẹ hơn.
                </p>
                <button
                  type="button"
                  onClick={() => setRestDays((prev) => ({ ...prev, [selectedDayId]: false }))}
                  className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition hover:bg-accent-hover"
                >
                  Bật lại thực đơn
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="diet-card diet-meals-shell min-w-0 overflow-hidden rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="diet-schedule-heading">
              <Utensils />
              <h2>Lịch ăn hôm nay</h2>
            </div>
          </div>

          <main className="diet-meal-list mt-4 space-y-5">
            {!restDays[selectedDayId] && !hasMenuForSelectedDay ? (
              <div className="diet-empty-state col-span-full rounded-xl border px-5 py-8 text-center">
                <Utensils className="mx-auto h-9 w-9 text-info" />
                <h3 className="mt-4 text-lg font-black text-text-primary">Chưa có thực đơn cho ngày này</h3>
                <p className="mx-auto mt-2 max-w-xl text-sm font-semibold leading-6 text-text-secondary">
                  Tạo thực đơn AI hoặc tự chọn món để bắt đầu theo dõi macro trong ngày.
                </p>
                <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={autoCreateMenu}
                    disabled={isSaving}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Bot className="h-4 w-4" />
                    {isSaving ? 'Đang tạo...' : 'Tạo thực đơn AI'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openFoodPicker('breakfast')}
                    className="diet-control rounded-xl border border-border-primary px-4 py-2 text-sm font-black transition"
                  >
                    Tự chọn món
                  </button>
                </div>
              </div>
            ) : null}

            {visibleMealSummaries.map((meal) => {
              const progress = Math.min(100, Math.round((meal.mealCalories / Math.max(1, targetCalories)) * 100));
              const MealIcon = meal.id === 'breakfast' ? Coffee : meal.id === 'lunch' ? Sun : meal.id === 'dinner' ? Moon : Utensils;

              return (
                <section
                  key={meal.id}
                  className={`diet-meal-group ${meal.isHighlighted ? 'diet-meal-group-active' : ''}`}
                  style={{
                    '--meal-accent': meal.mealTheme.accent,
                    '--meal-accent-soft': meal.mealTheme.accentSoft,
                    '--meal-border': meal.mealTheme.border
                  } as CSSProperties}
                >
                  <header className="diet-meal-group-header">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="diet-meal-icon"><MealIcon /></span>
                      <h3>{{ breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }[meal.id]}</h3>
                      <span className="diet-meal-time">{meal.time}</span>
                    </div>
                    <p className="diet-meal-total">{meal.mealCalories} kcal · {progress}% · {meal.completedItemCount}/{meal.items.length}</p>
                  </header>

                  <div className="mt-2.5 space-y-2.5">
                    {meal.items.map((item, itemIndex) => {
                      const isCompleted = Boolean(item.weekly_food_item_id && completedWeeklyItemIds.has(item.weekly_food_item_id));

                      return (
                      <article
                        key={item.tempId}
                        className={`diet-food-card ${isCompleted ? 'diet-food-card-completed' : ''} ${item.recipe_id ? 'diet-food-card-clickable' : ''}`}
                        tabIndex={item.recipe_id ? 0 : undefined}
                        onClick={(event) => {
                          if (!item.recipe_id || (event.target as HTMLElement).closest('button')) return;
                          setSelectedRecipeId(item.recipe_id);
                        }}
                        onKeyDown={(event) => {
                          if (!item.recipe_id || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                          event.preventDefault();
                          setSelectedRecipeId(item.recipe_id);
                        }}
                      >
                        <div className="flex items-center gap-3 p-3">
                          <span className="diet-food-thumb h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                            <FoodImage src={resolveFoodImage(item, itemIndex + meal.mealIndex)} alt={item.name} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <h4 className={`truncate text-[15px] font-black text-text-primary ${isCompleted ? 'diet-food-name-completed' : ''}`}>{item.name}</h4>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-text-tertiary">
                              <span className="inline-flex items-center gap-1 font-black text-[var(--meal-accent)]"><Flame className="h-3.5 w-3.5" />{Math.round(item.calories * item.quantity)} kcal</span>
                              <span>{roundMacro(item.protein * item.quantity)}g protein</span>
                              <span>{roundMacro(item.carbs * item.quantity)}g carb</span>
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void replaceFoodInPlan(item)}
                              disabled={isSaving || Boolean(replacingFoodId)}
                              className="diet-food-action diet-food-swap"
                              aria-label={`Đổi món ${item.name}`}
                              title="Đổi sang món tương đương"
                            >
                              <RefreshCw className={replacingFoodId === item.tempId ? 'animate-spin' : ''} />
                            </button>
                            {!isCompleted && (
                              <button
                                type="button"
                                onClick={() => void removeFoodFromPlan(item)}
                              disabled={isSaving || Boolean(replacingFoodId)}
                              className="diet-food-action diet-food-delete"
                              aria-label={`Xóa ${item.name}`}
                              title="Xóa món"
                            >
                                <Trash2 />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void toggleMealItemCompletion(item)}
                              disabled={completingFoodId === item.tempId}
                              className={`diet-food-action diet-food-complete ${isCompleted ? 'diet-food-complete-done' : ''}`}
                              aria-label={`Đánh dấu đã ăn ${item.name}`}
                              title={isCompleted ? 'Hoàn tác đã ăn' : 'Đã ăn'}
                            >
                              <Check />
                            </button>
                          </div>
                        </div>

                        {item.recipe_id && item.ingredients?.length ? (
                          <div className="diet-recipe-ingredients" aria-label={`Nguyên liệu của ${item.name}`}>
                            {item.ingredients.map((ingredient, ingredientIndex) => {
                              const totalAmount = item.ingredients?.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount || 0)), 0) || 0;
                              const share = totalAmount > 0 ? Math.max(0, Number(ingredient.amount || 0)) / totalAmount : 1 / Math.max(1, item.ingredients?.length || 1);
                              const ingredientCalories = Math.round(item.calories * item.quantity * share);
                              const ingredientCost = item.estimated_cost_min_vnd ? item.estimated_cost_min_vnd * item.quantity * share : 0;
                              return (
                                <div className="diet-recipe-ingredient-row" key={`${ingredient.ingredient_name}-${ingredientIndex}`}>
                                  <span className="truncate">{ingredient.ingredient_name}</span>
                                  <span>{formatIngredientAmount(ingredient)}</span>
                                  <strong>{ingredientCalories} kcal</strong>
                                  <span>{ingredientCost ? formatVnd(ingredientCost) : '—'}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="diet-food-detail-row">
                            <span className="truncate">{item.category || 'Khẩu phần'}</span>
                            <span>{formatFoodQuantity(item)}</span>
                            <strong>{Math.round(item.calories * item.quantity)} kcal</strong>
                            <span>{roundMacro(item.protein * item.quantity)}g protein</span>
                          </div>
                        )}
                      </article>
                      );
                    })}
                  </div>

                  <button type="button" onClick={() => openFoodPicker(meal.id)} className="diet-add-food">
                    <Plus /> Thêm món vào bữa này
                  </button>
                </section>
              );
            })}
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
      <RecipeDetailModal recipeId={selectedRecipeId} onClose={() => setSelectedRecipeId(null)} />
    </div>
  );
}
