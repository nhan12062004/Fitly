import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Apple,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  Loader2,
  Moon,
  Ruler,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  DEFAULT_MOTIVATION,
  MOTIVATION_OPTIONS,
  normalizeMotivation,
} from '../lib/MotivationOptions';
import { useToast } from './ToastProvider';

type ProfileSupplementModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type ProfileSupplementFormData = {
  target_weight: string;
  body_fat: string;
  waist: string;
  hips: string;
  neck: string;
  current_diet: string;
  cooking_ability: string;
  budget_level: string;
  workout_time: string;
  daily_water_goal: string;
  sleep_hours: string;
  sleep_quality: string;
  stress_level: string;
  health_condition: string;
  injuries: string;
  allergies: string;
  medications: string;
  expectations: string;
  motivation: string;
};

type QuestionField = keyof ProfileSupplementFormData;

type SupplementQuestion = {
  field: QuestionField;
  eyebrow: string;
  title: string;
  description: string;
  type: 'number' | 'text' | 'textarea' | 'choice';
  icon: LucideIcon;
  options?: readonly string[];
  placeholder?: string;
  rows?: number;
  unit?: string;
};

const DEFAULT_FORM_DATA: ProfileSupplementFormData = {
  target_weight: '',
  body_fat: '',
  waist: '',
  hips: '',
  neck: '',
  current_diet: '',
  cooking_ability: 'Tự nấu 100%',
  budget_level: 'Trung bình',
  workout_time: 'Sáng sớm',
  daily_water_goal: '2',
  sleep_hours: '7',
  sleep_quality: 'Tốt',
  stress_level: 'Thấp - Cuộc sống thoải mái',
  health_condition: '',
  injuries: '',
  allergies: '',
  medications: 'Không sử dụng thuốc',
  expectations: '',
  motivation: DEFAULT_MOTIVATION,
};

const SUPPLEMENT_QUESTIONS: SupplementQuestion[] = [
  {
    field: 'target_weight',
    eyebrow: 'Mục tiêu',
    title: 'Cân nặng mục tiêu?',
    description: '',
    type: 'number',
    icon: Ruler,
    unit: 'kg',
    placeholder: 'Ví dụ: 62',
  },
  {
    field: 'workout_time',
    eyebrow: 'Lịch tập',
    title: 'Bạn dễ tập lúc nào?',
    description: '',
    type: 'choice',
    icon: HeartPulse,
    options: ['Sáng sớm', 'Buổi trưa', 'Chiều tối', 'Linh hoạt'],
  },
  {
    field: 'cooking_ability',
    eyebrow: 'Ăn uống',
    title: 'Bạn thường ăn uống kiểu nào?',
    description: '',
    type: 'choice',
    icon: Apple,
    options: ['Tự nấu 100%', 'Ăn trưa ở ngoài, tối tự nấu', 'Chủ yếu ăn ngoài', 'Ít thời gian nấu'],
  },
  {
    field: 'sleep_hours',
    eyebrow: 'Phục hồi',
    title: 'Bạn ngủ khoảng mấy giờ?',
    description: '',
    type: 'choice',
    icon: Moon,
    options: ['4', '6', '7', '8', '9'],
  },
  {
    field: 'injuries',
    eyebrow: 'Sức khỏe',
    title: 'Có chấn thương cần tránh?',
    description: '',
    type: 'textarea',
    icon: HeartPulse,
    placeholder: 'Ví dụ: đau gối, lưng dưới yếu...',
  },
  {
    field: 'allergies',
    eyebrow: 'Ăn uống',
    title: 'Có món nào cần tránh?',
    description: '',
    type: 'textarea',
    icon: Apple,
    placeholder: 'Ví dụ: hải sản, sữa, đậu phộng...',
  },
  {
    field: 'motivation',
    eyebrow: 'Động lực',
    title: 'Điều gì kéo bạn đi tiếp?',
    description: '',
    type: 'choice',
    icon: Sparkles,
    options: MOTIVATION_OPTIONS,
  },
  {
    field: 'expectations',
    eyebrow: 'Ghi chú',
    title: 'Bạn muốn AI nhớ điều gì?',
    description: '',
    type: 'textarea',
    icon: Sparkles,
    rows: 4,
    placeholder: 'Ví dụ: không thích burpee, thích món Việt dễ nấu...',
  },
];

const parseNumberOrNull = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toInputValue = (value: unknown) => {
  if (value === null || value === undefined || value === 0) return '';
  return String(value);
};

const filled = (value: string) => value.trim().length > 0;

export default function ProfileSupplementModal({ isOpen, onClose }: ProfileSupplementModalProps) {
  const { user, refreshProfile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [baseBody, setBaseBody] = useState<{ weight: number | null; height: number | null }>({
    weight: null,
    height: null,
  });
  const [formData, setFormData] = useState<ProfileSupplementFormData>(DEFAULT_FORM_DATA);

  useEffect(() => {
    if (isOpen) {
      setCurrentQuestionIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !user?.id) return;

    const userId = user.id;
    let cancelled = false;
    async function loadCurrentData() {
      setLoading(true);
      setError('');
      try {
        const [bodyRes, lifestyleRes, healthRes] = await Promise.all([
          supabase
            .from('body_metrics')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('lifestyle_settings')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(),
          supabase
            .from('health_conditions')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(),
        ]);

        const firstError = [bodyRes.error, lifestyleRes.error, healthRes.error].find(Boolean);
        if (firstError) throw firstError;
        if (cancelled) return;

        const body = bodyRes.data || {};
        const lifestyle = lifestyleRes.data || {};
        const health = healthRes.data || {};

        setBaseBody({
          weight: Number(body.weight) || null,
          height: Number(body.height) || null,
        });
        setFormData((prev) => ({
          ...prev,
          target_weight: toInputValue(body.target_weight),
          body_fat: toInputValue(body.body_fat || body.body_fat_percentage),
          waist: toInputValue(body.waist),
          hips: toInputValue(body.hips),
          neck: toInputValue(body.neck),
          current_diet: lifestyle.current_diet || '',
          cooking_ability: lifestyle.cooking_ability || prev.cooking_ability,
          budget_level: lifestyle.budget_level || prev.budget_level,
          workout_time: lifestyle.workout_time || prev.workout_time,
          daily_water_goal: toInputValue(lifestyle.daily_water_goal) || prev.daily_water_goal,
          motivation: normalizeMotivation(lifestyle.motivation),
          expectations: lifestyle.expectations || '',
          sleep_hours: toInputValue(health.sleep_hours) || prev.sleep_hours,
          sleep_quality: health.sleep_quality || prev.sleep_quality,
          stress_level: health.stress_level || prev.stress_level,
          health_condition: health.health_condition || '',
          injuries: health.injuries || '',
          allergies: health.medical_history || '',
          medications: health.medications || prev.medications,
        }));
      } catch (err: any) {
        setError(err?.message || 'Không thể tải hồ sơ AI.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCurrentData();
    return () => {
      cancelled = true;
    };
  }, [isOpen, user?.id]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const updateField = (field: QuestionField, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const goToPreviousQuestion = () => {
    setCurrentQuestionIndex((prev) => Math.max(prev - 1, 0));
  };

  const goToNextQuestion = () => {
    setCurrentQuestionIndex((prev) => Math.min(prev + 1, SUPPLEMENT_QUESTIONS.length - 1));
  };

  const handleSave = async () => {
    if (!user?.id) return;

    setSaving(true);
    setError('');
    try {
      const bodyPayload = {
        user_id: user.id,
        weight: baseBody.weight,
        height: baseBody.height,
        target_weight: parseNumberOrNull(formData.target_weight),
        body_fat: parseNumberOrNull(formData.body_fat),
        waist: parseNumberOrNull(formData.waist),
        hips: parseNumberOrNull(formData.hips),
        neck: parseNumberOrNull(formData.neck),
      };

      const [bodyRes, lifestyleRes, healthRes] = await Promise.all([
        supabase.from('body_metrics').insert(bodyPayload),
        supabase.from('lifestyle_settings').upsert({
          user_id: user.id,
          current_diet: formData.current_diet.trim(),
          cooking_ability: formData.cooking_ability,
          budget_level: formData.budget_level,
          workout_time: formData.workout_time,
          daily_water_goal: parseNumberOrNull(formData.daily_water_goal) || 2,
          motivation: formData.motivation,
          expectations: formData.expectations.trim(),
          updated_at: new Date().toISOString(),
        }),
        supabase.from('health_conditions').upsert({
          user_id: user.id,
          health_condition: formData.health_condition.trim(),
          injuries: formData.injuries.trim(),
          medical_history: formData.allergies.trim(),
          medications: formData.medications.trim(),
          sleep_hours: parseNumberOrNull(formData.sleep_hours) || 7,
          sleep_quality: formData.sleep_quality,
          stress_level: formData.stress_level,
          updated_at: new Date().toISOString(),
        }),
      ]);

      const firstError = [bodyRes.error, lifestyleRes.error, healthRes.error].find(Boolean);
      if (firstError) throw firstError;

      await refreshProfile();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu hồ sơ AI.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuestionSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (currentQuestionIndex >= SUPPLEMENT_QUESTIONS.length - 1) {
      void handleSave();
      return;
    }

    goToNextQuestion();
  };

  if (!isOpen) return null;

  const currentQuestion = SUPPLEMENT_QUESTIONS[currentQuestionIndex];
  const currentValue = formData[currentQuestion.field];
  const questionProgress = Math.round(((currentQuestionIndex + 1) / SUPPLEMENT_QUESTIONS.length) * 100);
  const isLastQuestion = currentQuestionIndex === SUPPLEMENT_QUESTIONS.length - 1;
  const hasCurrentAnswer = filled(currentValue);
  const CurrentQuestionIcon = currentQuestion.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />

      <section className="relative flex h-[100dvh] w-full flex-col overflow-hidden border border-border-primary bg-bg-secondary text-text-primary shadow-[0_28px_90px_rgba(0,0,0,0.42)] sm:h-auto sm:max-h-[88dvh] sm:max-w-2xl sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-primary bg-bg-tertiary/55 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ai/12 text-ai">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-ai">Hồ sơ AI</p>
              <h2 className="truncate text-lg font-black text-text-primary sm:text-xl">Bổ sung nhanh</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
            aria-label="Đóng hồ sơ AI"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {loading ? (
          <div className="flex min-h-[28rem] flex-1 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-ai" />
          </div>
        ) : (
          <form onSubmit={handleQuestionSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
              <div className="mb-7 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                <div className="h-full rounded-full bg-ai transition-all" style={{ width: `${questionProgress}%` }} />
              </div>

              <section className="mx-auto max-w-xl">
                <div className="mb-7 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-tertiary text-ai">
                      <CurrentQuestionIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-ai">
                        {currentQuestion.eyebrow}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-text-tertiary">
                        Câu {currentQuestionIndex + 1}/{SUPPLEMENT_QUESTIONS.length}
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-black leading-tight text-text-primary sm:text-[28px]">
                  {currentQuestion.title}
                </h3>
                {currentQuestion.description ? (
                  <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                    {currentQuestion.description}
                  </p>
                ) : null}

                <div className="mt-6">
                  <QuestionInput
                    question={currentQuestion}
                    value={currentValue}
                    onChange={handleChange}
                    onChoice={(value) => updateField(currentQuestion.field, value)}
                  />
                </div>
              </section>
            </div>

            <footer className="shrink-0 border-t border-border-primary bg-bg-tertiary/65 px-4 py-4 sm:px-6">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={currentQuestionIndex === 0 ? onClose : goToPreviousQuestion}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary"
                >
                  {currentQuestionIndex === 0 ? (
                    'Để sau'
                  ) : (
                    <>
                      <ChevronLeft className="h-4 w-4" />
                      Quay lại
                    </>
                  )}
                </button>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {!isLastQuestion && !hasCurrentAnswer ? (
                    <button
                      type="button"
                      onClick={goToNextQuestion}
                      className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-black text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary"
                    >
                      Bỏ qua
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ai px-5 text-sm font-black text-white transition-colors hover:bg-ai-hover disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isLastQuestion ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    {isLastQuestion ? 'Lưu hồ sơ AI' : 'Tiếp theo'}
                  </button>
                </div>
              </div>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
  onChoice,
}: {
  question: SupplementQuestion;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onChoice: (value: string) => void;
}) {
  if (question.type === 'choice') {
    return (
      <ChoiceField
        field={question.field}
        value={value}
        options={question.options || []}
        onChoice={onChoice}
      />
    );
  }

  if (question.type === 'textarea') {
    return (
      <TextArea
        name={question.field}
        value={value}
        onChange={onChange}
        placeholder={question.placeholder}
        rows={question.rows}
      />
    );
  }

  return (
    <Field
      name={question.field}
      value={value}
      onChange={onChange}
      type={question.type}
      placeholder={question.placeholder}
      unit={question.unit}
    />
  );
}

function ChoiceField({
  field,
  value,
  options,
  onChoice,
}: {
  field: QuestionField;
  value: string;
  options: readonly string[];
  onChoice: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = value === option;
        const label = field === 'sleep_hours' ? `${option} giờ` : option;

        return (
          <button
            key={option}
            type="button"
            onClick={() => onChoice(option)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-black transition-colors ${
              active
                ? 'border-ai/50 bg-ai/12 text-text-primary'
                : 'border-border-primary bg-bg-tertiary text-text-secondary hover:border-ai/35 hover:bg-bg-secondary'
            }`}
          >
            {active ? <CheckCircle2 className="h-4 w-4 text-ai" /> : null}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Field({
  name,
  value,
  onChange,
  type,
  placeholder,
  unit,
}: {
  name: QuestionField;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  type: 'number' | 'text';
  placeholder?: string;
  unit?: string;
}) {
  return (
    <label className="block">
      <span className="sr-only">Câu trả lời</span>
      <span className="relative block">
        <input
          name={name}
          value={value}
          onChange={onChange}
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          step={type === 'number' ? '0.1' : undefined}
          placeholder={placeholder}
          className={`h-12 w-full rounded-xl border border-border-primary bg-bg-tertiary px-4 text-base font-black text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-ai ${
            unit ? 'pr-28' : ''
          }`}
        />
        {unit ? (
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-black text-text-tertiary">
            {unit}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function TextArea({
  name,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  name: QuestionField;
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="sr-only">Câu trả lời</span>
      <textarea
        name={name}
        value={value}
        onChange={onChange}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-border-primary bg-bg-tertiary px-4 py-3 text-sm font-semibold leading-6 text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-ai"
      />
    </label>
  );
}
