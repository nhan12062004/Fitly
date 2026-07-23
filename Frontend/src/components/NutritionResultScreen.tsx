import {
  Apple,
  ArrowRight,
  CalendarDays,
  ChefHat,
  Coffee,
  Loader2,
  Moon,
  Sun,
  Utensils,
} from 'lucide-react';

export type NutritionPlanDay = {
  day: number;
  meals: Array<{ mealType: string; name: string; quantity: number }>;
};

export type NutritionMacroTargets = {
  calorieTarget: number;
  summary: string;
  protein: { grams: number; calories: number; percentage: number };
  carbs: { grams: number; calories: number; percentage: number };
  fat: { grams: number; calories: number; percentage: number };
};

export type NutritionResult = {
  dietPreference: string;
  mealsPerDay: number;
  cookingAbility: string;
  budgetLevel: string;
  targetCalories: number | null;
  explanation: string;
  days: NutritionPlanDay[];
  macroTargets: NutritionMacroTargets | null;
};

const mealLabels: Record<string, string> = {
  breakfast: 'Sáng',
  lunch: 'Trưa',
  dinner: 'Tối',
  snack: 'Bữa phụ',
};

const mealPresentation = {
  breakfast: { label: 'Bữa sáng', icon: Coffee, color: '#fbbf24', background: 'rgba(251,191,36,0.12)' },
  lunch: { label: 'Bữa trưa', icon: Sun, color: '#5eead4', background: 'rgba(45,212,191,0.12)' },
  dinner: { label: 'Bữa tối', icon: Moon, color: '#a78bfa', background: 'rgba(167,139,250,0.12)' },
  snack: { label: 'Bữa phụ', icon: Apple, color: '#fb923c', background: 'rgba(251,146,60,0.12)' },
} as const;

const mealTypeOrder = ['breakfast', 'lunch', 'dinner', 'snack'];

const formatNumber = (value: number) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);

function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[18px] border border-[#2a3340] bg-[#151a23] shadow-[0_18px_42px_rgba(0,0,0,0.24)] ${className}`}>
      {children}
    </section>
  );
}

export default function NutritionResultScreen({
  result,
  isGenerating,
  error,
  onOpenPlan,
}: {
  result: NutritionResult;
  isGenerating: boolean;
  error: string;
  onOpenPlan: () => void;
}) {
  const todayPlan = result.days.find((day) => day.day === 0) || { day: 0, meals: [] };
  const totalMeals = todayPlan.meals.length;
  const mealsByType = todayPlan.meals.reduce<Record<string, NutritionPlanDay['meals']>>((groups, meal) => {
    const mealType = meal.mealType || 'other';
    (groups[mealType] ||= []).push(meal);
    return groups;
  }, {});
  const todayMealGroups = [
    ...mealTypeOrder.filter((mealType) => mealsByType[mealType]?.length),
    ...Object.keys(mealsByType).filter((mealType) => !mealTypeOrder.includes(mealType)),
  ].map((mealType) => ({ mealType, meals: mealsByType[mealType] }));
  const targetCalories = result.targetCalories || result.macroTargets?.calorieTarget || 1800;
  const macroTargets = result.macroTargets || {
    calorieTarget: targetCalories,
    summary: 'Mục tiêu dinh dưỡng cân bằng',
    protein: { grams: Math.round((targetCalories * 0.3) / 4), calories: Math.round(targetCalories * 0.3), percentage: 30 },
    carbs: { grams: Math.round((targetCalories * 0.5) / 4), calories: Math.round(targetCalories * 0.5), percentage: 50 },
    fat: { grams: Math.round((targetCalories * 0.2) / 9), calories: Math.round(targetCalories * 0.2), percentage: 20 },
  };
  const displayedCalories = macroTargets.calorieTarget;
  const macroDistribution = [
    {
      label: 'Protein',
      description: 'Xây cơ & phục hồi',
      percentage: macroTargets.protein.percentage,
      grams: macroTargets.protein.grams,
      color: '#60a5fa',
    },
    {
      label: 'Carbs',
      description: 'Năng lượng tập',
      percentage: macroTargets.carbs.percentage,
      grams: macroTargets.carbs.grams,
      color: '#a3e635',
    },
    {
      label: 'Chất béo',
      description: 'Hormone & vitamin',
      percentage: macroTargets.fat.percentage,
      grams: macroTargets.fat.grams,
      color: '#fb923c',
    },
  ];
  let donutOffset = 0;
  const donutGradient = macroTargets
    ? `conic-gradient(${macroDistribution.map((macro) => {
        const start = donutOffset;
        donutOffset += macro.percentage;
        return `${macro.color} ${start}% ${donutOffset}%`;
      }).join(', ')})`
    : '#273140';

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#090d13] px-4 py-10 text-white sm:px-5">
      <div className="mx-auto w-full max-w-[640px]">
        <header className="text-center">
          <div className="mx-auto flex items-center justify-center gap-1.5">
            <img src="/logo.png" alt="Fitly" className="h-7 w-7 object-contain" />
            <span className="text-sm font-black text-[#7dfba0]">Fitly</span>
          </div>

          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#0c766d] bg-[#062b2d] px-4 py-1.5 text-[10px] font-black uppercase text-[#5eead4] shadow-[0_0_22px_rgba(20,184,166,0.15)]">
            <Utensils className="h-3.5 w-3.5" strokeWidth={2.5} />
            Phân tích dinh dưỡng
          </div>

          <h1 className="mt-5 text-[28px] font-black leading-tight tracking-tight text-white sm:text-[32px]">
            Thực đơn hôm nay
          </h1>
          <p className="mt-1 text-xs font-semibold text-[#8390a3] sm:text-sm">
            AI đã chuẩn bị các bữa ăn phù hợp với lựa chọn và mục tiêu của bạn.
          </p>
        </header>

        <main className="mt-6 flex flex-col gap-4">
          <Panel className="overflow-hidden">
            <div className="border-b border-[#273140] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase text-[#8c98aa]">Tổng quan thực đơn</p>
                  <h2 className="mt-1 text-xl font-black text-white">{result.dietPreference}</h2>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#9ca8ba]">
                    {result.mealsPerDay} bữa/ngày · {result.cookingAbility} · {result.budgetLevel}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-black text-[#cbd5e1] sm:min-w-[190px]">
                  <span className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0b1119] px-3 py-2">
                    <CalendarDays className="h-3.5 w-3.5 text-[#c8ff19]" />
                    Hôm nay
                  </span>
                  <span className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0b1119] px-3 py-2">
                    <ChefHat className="h-3.5 w-3.5 text-[#2dd4bf]" />
                    {totalMeals} món
                  </span>
                </div>
              </div>
            </div>

            <div className="divide-y divide-[#273140]">
              {isGenerating ? (
                <div className="flex items-center gap-3 p-4 text-sm font-semibold text-[#9ca8ba] sm:p-5">
                  <Loader2 className="h-5 w-5 animate-spin text-[#c8ff19]" />
                  AI đang chọn món và cân bằng thực đơn cho hôm nay.
                </div>
              ) : error ? (
                <div className="p-4 text-sm font-semibold leading-5 text-[#fca5a5] sm:p-5">{error}</div>
              ) : (
                <div className="p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#c8ff19]/12 text-[#c8ff19]">
                        <CalendarDays className="h-4 w-4" strokeWidth={2.4} />
                      </span>
                      <div>
                        <p className="text-sm font-black text-white">Thực đơn hôm nay</p>
                        <p className="mt-0.5 text-[11px] font-semibold text-[#7d8899]">Được AI sắp xếp theo từng bữa</p>
                      </div>
                    </div>
                    <span className="rounded-full border border-[#2a3340] bg-[#0b1119] px-2.5 py-1 text-[10px] font-black text-[#cbd5e1]">
                      {totalMeals} món
                    </span>
                  </div>

                  {todayMealGroups.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {todayMealGroups.map(({ mealType, meals }) => {
                        const presentation = mealPresentation[mealType as keyof typeof mealPresentation] || {
                          label: mealLabels[mealType] || mealType,
                          icon: Utensils,
                          color: '#94a3b8',
                          background: 'rgba(148,163,184,0.12)',
                        };
                        const Icon = presentation.icon;

                        return (
                          <section key={mealType} className="overflow-hidden rounded-[14px] border border-[#273140] bg-[#0b1119]/70">
                            <div className="flex items-center justify-between gap-3 border-b border-[#273140] px-3.5 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <span
                                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                                  style={{ backgroundColor: presentation.background, color: presentation.color }}
                                >
                                  <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                                </span>
                                <p className="text-xs font-black text-white">{presentation.label}</p>
                              </div>
                              <span className="text-[10px] font-bold text-[#7d8899]">{meals.length} món</span>
                            </div>
                            <ul className="divide-y divide-[#202a38] px-3.5">
                              {meals.map((meal, index) => (
                                <li key={`${mealType}-${meal.name}-${index}`} className="flex items-center justify-between gap-3 py-2.5">
                                  <span className="min-w-0 text-xs font-semibold leading-5 text-[#cbd5e1]">{meal.name}</span>
                                  {meal.quantity !== 1 ? (
                                    <span className="shrink-0 rounded-md bg-[#151a23] px-1.5 py-0.5 text-[10px] font-black text-[#8c98aa]">x{meal.quantity}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs font-semibold leading-5 text-[#fca5a5]">Chưa có món cho hôm nay.</p>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <Panel className="p-4 sm:p-5">
            <div>
              <h2 className="text-base font-black text-white">Phân bổ dinh dưỡng</h2>
              <p className="mt-0.5 text-[11px] font-semibold text-[#8c98aa]">
                {macroTargets?.summary || 'Đang chờ mục tiêu dinh dưỡng từ hệ thống'}
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
              <div
                className="relative mx-auto flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-full sm:mx-0"
                style={{
                  background: donutGradient,
                }}
                aria-label={displayedCalories ? `${formatNumber(displayedCalories)} kcal từ thực đơn hôm nay` : 'Chưa có dữ liệu dinh dưỡng'}
                role="img"
              >
                <div className="flex h-[74px] w-[74px] flex-col items-center justify-center rounded-full bg-[#151a23] text-center">
                  <span className="text-[15px] font-black leading-none text-white">
                    {displayedCalories ? formatNumber(displayedCalories) : '--'}
                  </span>
                  <span className="mt-1 text-[8px] font-bold text-[#8c98aa]">kcal thực đơn</span>
                </div>
              </div>

              <div className="min-w-0 flex-1 space-y-3.5">
                {macroDistribution.map((macro) => (
                  <div key={macro.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 text-xs font-black text-white">
                        {macro.label}
                        <span className="ml-1.5 text-[9px] font-semibold text-[#7d8899]">{macro.description}</span>
                      </p>
                      <p className="shrink-0 text-right text-sm font-black" style={{ color: macro.color }}>
                        {macro.grams ? `${formatNumber(macro.grams)}g` : '--'}
                        <span className="ml-1 text-[9px] font-bold text-[#7d8899]">{Math.round(macro.percentage)}%</span>
                      </p>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-[#080d14]">
                      <div
                        className="h-full rounded-full"
                        style={{ backgroundColor: macro.color, width: `${macro.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <button
            type="button"
            onClick={onOpenPlan}
            disabled={isGenerating || !!error}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#c8ff19] px-6 py-4 text-sm font-black text-[#071007] shadow-[0_16px_36px_rgba(200,255,25,0.22)] transition-colors hover:bg-[#b9f40f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Tiếp tục
            <ArrowRight className="h-4 w-4" strokeWidth={3} />
          </button>

          <p className="pb-6 text-center text-xs font-semibold text-[#7b8798]">
            Tiếp theo: mở dashboard để bắt đầu theo dõi bài tập và thực đơn hôm nay.
          </p>
        </main>
      </div>
    </div>
  );
}
