import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Zap } from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';

type Choice = {
  value: string;
  label: string;
  description: string;
};

export type MealSurveySelection = {
  dietPreference: string;
  mealsPerDay: number;
  cookingAbility: string;
  budgetLevel: string;
};

const DIET_OPTIONS: Choice[] = [
  { value: 'Bình thường', label: 'Ăn cân bằng', description: 'Đa dạng món ăn, dễ áp dụng hằng ngày.' },
  { value: 'Ăn chay', label: 'Ăn chay', description: 'Ưu tiên nguồn đạm và thực phẩm từ thực vật.' },
  { value: 'Ăn nhiều đạm (High Protein)', label: 'Nhiều đạm', description: 'Hỗ trợ tăng cơ và phục hồi sau tập.' },
  { value: 'Keto / Low Carb', label: 'Low Carb', description: 'Giảm tinh bột, ưu tiên đạm và chất béo tốt.' },
  { value: 'Eat Clean', label: 'Eat Clean', description: 'Món ăn đơn giản, ít chế biến.' },
];

const MEAL_OPTIONS: Choice[] = [
  { value: '2', label: '2 bữa/ngày', description: 'Gọn nhẹ, phù hợp lịch bận rộn.' },
  { value: '3', label: '3 bữa/ngày', description: 'Nhịp ăn uống cân bằng, dễ duy trì.' },
  { value: '4', label: '4 bữa/ngày', description: 'Thêm một bữa phụ để chia nhỏ năng lượng.' },
  { value: '5', label: '5 bữa nhỏ/ngày', description: 'Phù hợp khi cần nạp năng lượng đều hơn.' },
];

const COOKING_OPTIONS: Choice[] = [
  { value: 'Tự nấu 100%', label: 'Tự nấu', description: 'Có thể chuẩn bị phần lớn bữa ăn tại nhà.' },
  { value: 'Ăn trưa ở ngoài, tối tự nấu', label: 'Kết hợp', description: 'Ăn ngoài vào ban ngày, tự nấu khi có thời gian.' },
  { value: 'Chủ yếu ăn ngoài', label: 'Ăn ngoài', description: 'Ưu tiên món phổ biến, tiện chọn khi ra ngoài.' },
  { value: 'Ít thời gian nấu', label: 'Nấu nhanh', description: 'Ưu tiên món ít bước và dễ chuẩn bị.' },
];

const BUDGET_OPTIONS: Choice[] = [
  { value: 'Tiết kiệm', label: 'Tiết kiệm', description: 'Ưu tiên nguyên liệu phổ biến, chi phí hợp lý.' },
  { value: 'Trung bình', label: 'Cân bằng', description: 'Đa dạng thực phẩm trong ngân sách vừa phải.' },
  { value: 'Thoải mái', label: 'Thoải mái', description: 'Linh hoạt hơn về nguyên liệu và lựa chọn món.' },
];

function ChoiceGrid({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={`flex min-h-[72px] cursor-pointer flex-col justify-between rounded-2xl border px-3.5 py-3 text-left transition-colors sm:px-4 ${
              selected
                ? 'border-accent/50 bg-accent/10 text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'border-border-primary bg-bg-primary/65 text-text-secondary hover:border-accent/30 hover:bg-bg-primary'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span>
              <span className="block text-sm font-black text-text-primary">{option.label}</span>
              <span className="mt-1 block text-xs font-semibold leading-5 text-text-tertiary">{option.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

interface MealSurveyFormProps {
  onComplete: (selection: MealSurveySelection) => void | Promise<void>;
  onBack: () => void;
}

export default function MealSurveyForm({ onComplete, onBack }: MealSurveyFormProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [dietPreference, setDietPreference] = useState('Bình thường');
  const [mealsPerDay, setMealsPerDay] = useState('3');
  const [cookingAbility, setCookingAbility] = useState('Tự nấu 100%');
  const [budgetLevel, setBudgetLevel] = useState('Trung bình');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!user?.id) {
      setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const { error: saveError } = await supabase.from('lifestyle_settings').upsert({
        user_id: user.id,
        diet_preference: dietPreference,
        meals_per_day: Number(mealsPerDay),
        cooking_ability: cookingAbility,
        budget_level: budgetLevel,
        updated_at: new Date().toISOString(),
      });
      if (saveError) throw saveError;
      await onComplete({
        dietPreference,
        mealsPerDay: Number(mealsPerDay),
        cookingAbility,
        budgetLevel,
      });
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu lựa chọn thực đơn. Vui lòng thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  const content = [
    {
      eyebrow: 'Bước 1: Sở thích ăn uống',
      title: 'Bạn muốn ăn theo phong cách nào?',
      description: 'Fitly sẽ ưu tiên các món phù hợp với lựa chọn này trong thực đơn.',
      body: <ChoiceGrid name="diet-preference" value={dietPreference} options={DIET_OPTIONS} onChange={setDietPreference} />,
    },
    {
      eyebrow: 'Bước 2: Nhịp bữa ăn',
      title: 'Bạn muốn ăn mấy bữa mỗi ngày?',
      description: 'Chọn nhịp bữa ăn gần nhất với lịch sinh hoạt của bạn.',
      body: <ChoiceGrid name="meals-per-day" value={mealsPerDay} options={MEAL_OPTIONS} onChange={setMealsPerDay} />,
    },
    {
      eyebrow: 'Bước 3: Chuẩn bị món ăn',
      title: 'Bạn thường chuẩn bị bữa ăn như thế nào?',
      description: 'Lựa chọn này giúp thực đơn thực tế hơn với thời gian và ngân sách của bạn.',
      body: (
        <div className="space-y-6">
          <ChoiceGrid name="cooking-ability" value={cookingAbility} options={COOKING_OPTIONS} onChange={setCookingAbility} />
          <div>
            <p className="mb-3 text-xs font-black text-text-primary">Ngân sách thực phẩm</p>
            <ChoiceGrid name="budget-level" value={budgetLevel} options={BUDGET_OPTIONS} onChange={setBudgetLevel} />
          </div>
        </div>
      ),
    },
  ][step - 1];

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-bg-primary px-3 py-3 text-text-primary sm:px-5 sm:py-5">
      <main className="custom-scrollbar max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-border-primary bg-bg-primary px-5 py-7 shadow-[0_22px_60px_rgba(0,0,0,0.38)] sm:max-h-[calc(100dvh-2.5rem)] sm:px-9 sm:py-9">
        <div className="flex items-center justify-between gap-4 text-xs font-semibold">
          <p className="text-accent">{content.eyebrow}</p>
          <p className="text-text-secondary">{step} / 3</p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
          <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${(step / 3) * 100}%` }} />
        </div>

        <div className="mt-9">
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">{content.title}</h1>
          <p className="mt-3 text-sm font-medium leading-6 text-text-secondary">{content.description}</p>
          <div className="mt-8">{content.body}</div>
          {error ? <p className="mt-5 text-sm font-semibold text-red-400">{error}</p> : null}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border-primary pt-5 sm:mt-6 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={step === 1 ? onBack : () => setStep((current) => current - 1)}
            disabled={isSaving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border-primary px-7 text-sm font-black text-accent transition-colors hover:border-accent/45 hover:bg-bg-secondary disabled:opacity-60"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={3} />
            Quay lại
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((current) => current + 1)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-7 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
            >
              Tiếp tục
              <ChevronRight className="h-4 w-4" strokeWidth={3} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={isSaving}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-7 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSaving ? 'Đang tạo thực đơn...' : 'TẠO THỰC ĐƠN'}
              {!isSaving ? <Zap className="h-4 w-4 text-text-inverse" strokeWidth={3} /> : null}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
