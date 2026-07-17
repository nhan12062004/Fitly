import { ArrowRight, CalendarDays, ChefHat, Loader2, Sparkles, Utensils } from 'lucide-react';

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

const days = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const mealLabels: Record<string, string> = {
  breakfast: 'Sáng', lunch: 'Trưa', dinner: 'Tối', snack: 'Bữa phụ',
};

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
  return (
    <div className="min-h-[100dvh] w-full bg-[#090d13] px-4 py-10 text-white sm:px-5">
      <main className="mx-auto w-full max-w-[760px]">
        <header className="text-center">
          <div className="mx-auto flex items-center justify-center gap-2 text-[#7dfba0]">
            <Sparkles className="h-5 w-5" />
            <span className="text-sm font-black">Fitly</span>
          </div>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-[10px] font-black uppercase text-emerald-300">
            <Utensils className="h-3.5 w-3.5" /> Phân tích dinh dưỡng
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Thực đơn AI 7 ngày</h1>
          <p className="mt-2 text-sm font-semibold text-slate-400">Được tạo từ lựa chọn ăn uống và mục tiêu của bạn.</p>
        </header>

        <section className="mt-7 grid gap-3 sm:grid-cols-4">
          {[
            ['Chế độ ăn', result.dietPreference],
            ['Số bữa', `${result.mealsPerDay} bữa/ngày`],
            ['Chuẩn bị', result.cookingAbility],
            ['Ngân sách', result.budgetLevel],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-700 bg-[#151a23] p-4">
              <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
              <p className="mt-2 text-sm font-black text-slate-100">{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-4 rounded-2xl border border-slate-700 bg-[#151a23] p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><ChefHat className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-black">Mục tiêu dinh dưỡng mỗi ngày</p>
              <p className="mt-1 text-sm font-semibold text-slate-400">
                {result.targetCalories ? `${Math.round(result.targetCalories).toLocaleString('vi-VN')} kcal/ngày` : 'AI đang tính mục tiêu năng lượng phù hợp.'}
              </p>
              {result.explanation ? <p className="mt-3 text-sm leading-6 text-slate-300">{result.explanation}</p> : null}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-slate-700 bg-[#151a23] p-5">
          <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-emerald-300" /><h2 className="font-black">Thực đơn do AI chọn</h2></div>
          {isGenerating ? (
            <div className="flex items-center gap-3 py-12 text-sm font-semibold text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-emerald-300" />AI đang chọn món và cân bằng thực đơn cho 7 ngày…</div>
          ) : error ? (
            <p className="py-8 text-sm font-semibold text-red-300">{error}</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {result.days.map((day) => (
                <article key={day.day} className="rounded-xl border border-slate-700/80 bg-[#0b1119] p-4">
                  <h3 className="font-black text-emerald-300">{days[day.day] || `Ngày ${day.day + 1}`}</h3>
                  <div className="mt-3 space-y-2">
                    {day.meals.map((meal, index) => <p key={`${meal.mealType}-${meal.name}-${index}`} className="text-sm text-slate-200"><span className="mr-2 text-xs font-black text-slate-500">{mealLabels[meal.mealType] || meal.mealType}</span>{meal.name}{meal.quantity !== 1 ? ` × ${meal.quantity}` : ''}</p>)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <button type="button" onClick={onOpenPlan} disabled={isGenerating || !!error} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 px-6 py-4 text-sm font-black text-[#071007] disabled:cursor-not-allowed disabled:opacity-60">
          Tiếp tục <ArrowRight className="h-4 w-4" />
        </button>
      </main>
    </div>
  );
}
