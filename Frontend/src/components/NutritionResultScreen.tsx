import {
  ArrowRight,
  CalendarDays,
  ChefHat,
  Flame,
  Info,
  Loader2,
  Utensils,
  WalletCards,
} from 'lucide-react';

export type NutritionPlanDay = {
  day: number;
  meals: Array<{ mealType: string; name: string; quantity: number }>;
};

export type NutritionResult = {
  dietPreference: string;
  mealsPerDay: number;
  cookingAbility: string;
  budgetLevel: string;
  targetCalories: number | null;
  explanation: string;
  days: NutritionPlanDay[];
};

type IconComponent = typeof Utensils;

const days = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const mealLabels: Record<string, string> = {
  breakfast: 'Sáng',
  lunch: 'Trưa',
  dinner: 'Tối',
  snack: 'Bữa phụ',
};

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

function MetricCard({
  icon: Icon,
  value,
  label,
  caption,
  color,
  background,
}: {
  icon: IconComponent;
  value: string;
  label: string;
  caption: string;
  color: string;
  background: string;
}) {
  return (
    <Panel className="p-4 text-center">
      <span
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: background, color }}
      >
        <Icon className="h-4 w-4" strokeWidth={2.4} />
      </span>
      <p className="mt-3 text-2xl font-black leading-none" style={{ color }}>
        {value}
      </p>
      <p className="mt-1 text-[11px] font-bold text-[#cbd5e1]">{label}</p>
      <p className="mt-1 text-[9px] font-black uppercase text-[#7b8798]">{caption}</p>
    </Panel>
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
  const totalMeals = result.days.reduce((total, day) => total + day.meals.length, 0);
  const dailyCalories = result.targetCalories ? Math.round(result.targetCalories) : null;
  const caloriesPerMeal = dailyCalories ? Math.round(dailyCalories / Math.max(1, result.mealsPerDay)) : null;

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
            Thực đơn AI 7 ngày
          </h1>
          <p className="mt-1 text-xs font-semibold text-[#8390a3] sm:text-sm">
            AI đã tạo thực đơn từ lựa chọn ăn uống và mục tiêu của bạn.
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
                    7 ngày
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
                  AI đang chọn món và cân bằng thực đơn cho 7 ngày.
                </div>
              ) : error ? (
                <div className="p-4 text-sm font-semibold leading-5 text-[#fca5a5] sm:p-5">{error}</div>
              ) : (
                result.days.map((day) => (
                  <div key={day.day} className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 p-4 sm:p-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#c8ff19]/12 text-[#c8ff19]">
                      <CalendarDays className="h-4 w-4" strokeWidth={2.4} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-white">{days[day.day] || `Ngày ${day.day + 1}`}</p>
                      <div className="mt-2 space-y-2">
                        {day.meals.length > 0 ? day.meals.map((meal, index) => (
                          <p key={`${meal.mealType}-${meal.name}-${index}`} className="text-xs font-semibold leading-5 text-[#9ca8ba]">
                            <span className="mr-2 font-black uppercase text-[#5eead4]">
                              {mealLabels[meal.mealType] || meal.mealType}
                            </span>
                            {meal.name}
                            {meal.quantity !== 1 ? ` x ${meal.quantity}` : ''}
                          </p>
                        )) : (
                          <p className="text-xs font-semibold leading-5 text-[#fca5a5]">Chưa có món cho ngày này.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              icon={Flame}
              value={dailyCalories ? formatNumber(dailyCalories) : '--'}
              label="kcal/ngày"
              caption="Mục tiêu"
              color="#fb923c"
              background="rgba(251,146,60,0.13)"
            />
            <MetricCard
              icon={Utensils}
              value={formatNumber(result.mealsPerDay)}
              label="bữa/ngày"
              caption="Nhịp ăn"
              color="#2dd4bf"
              background="rgba(45,212,191,0.13)"
            />
            <MetricCard
              icon={WalletCards}
              value={caloriesPerMeal ? formatNumber(caloriesPerMeal) : '--'}
              label="kcal/bữa"
              caption="Ước tính"
              color="#60a5fa"
              background="rgba(96,165,250,0.13)"
            />
          </div>

          <Panel className="p-4 sm:p-5">
            <div className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#14b8a6]/15 text-[#2dd4bf]">
                <Info className="h-4 w-4" strokeWidth={2.4} />
              </span>
              <div>
                <h2 className="text-sm font-black text-white">Mục tiêu dinh dưỡng mỗi ngày</h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#a2adbd]">
                  {dailyCalories
                    ? `${formatNumber(dailyCalories)} kcal/ngày, chia theo ${result.mealsPerDay} bữa để dễ bám sát.`
                    : 'AI đã tạo thực đơn, mục tiêu kcal chi tiết sẽ được cập nhật trong kế hoạch.'}
                </p>
                {result.explanation ? (
                  <p className="mt-1 text-[11px] font-semibold leading-5 text-[#7d8899]">{result.explanation}</p>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel className="p-4 text-[11px] font-semibold leading-5 text-[#9ca8ba]">
            <b className="text-white">Thực đơn 7 ngày</b> được lưu vào kế hoạch của bạn. Bạn có thể xem chi tiết, tick bữa ăn hoàn thành và đổi món trong trang thực đơn.
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
