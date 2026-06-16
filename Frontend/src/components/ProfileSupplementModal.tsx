import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Apple,
  CheckCircle2,
  HeartPulse,
  Loader2,
  Moon,
  Ruler,
  Sparkles,
  X,
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  DEFAULT_MOTIVATION,
  MOTIVATION_OPTIONS,
  normalizeMotivation,
} from '../lib/MotivationOptions';

type ProfileSupplementModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [baseBody, setBaseBody] = useState<{ weight: number | null; height: number | null }>({
    weight: null,
    height: null,
  });
  const [formData, setFormData] = useState({
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
  });

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

  const completion = useMemo(() => {
    const checks = [
      filled(formData.current_diet),
      filled(formData.expectations),
      filled(formData.injuries),
      filled(formData.allergies),
      parseNumberOrNull(formData.target_weight) !== null,
      parseNumberOrNull(formData.waist) !== null || parseNumberOrNull(formData.body_fat) !== null,
      filled(formData.sleep_hours),
      filled(formData.stress_level),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [formData]);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />

      <section className="relative flex h-[100dvh] w-full flex-col overflow-hidden border border-border-primary bg-bg-secondary text-text-primary shadow-[0_28px_90px_rgba(0,0,0,0.42)] sm:h-auto sm:max-h-[92dvh] sm:max-w-5xl sm:rounded-[28px]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border-primary bg-bg-tertiary/65 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-ai" />
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-ai">Hồ sơ AI</p>
            </div>
            <h2 className="mt-2 text-xl font-black text-text-primary sm:text-2xl">Bổ sung dữ liệu cá nhân hóa</h2>
            <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-text-secondary">
              Các thông tin này giúp AI Coach điều chỉnh lịch tập, thực đơn, cường độ và nhịp phục hồi sát hơn mà không làm rối phần thông tin tài khoản.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-secondary text-text-tertiary transition-colors hover:text-text-primary"
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
          <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              <div className="mb-4 rounded-xl border border-ai/20 bg-ai/8 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-text-primary">Mức hoàn thiện hồ sơ AI</p>
                  <span className="rounded-full border border-ai/25 bg-ai/10 px-3 py-1 text-xs font-black text-ai">
                    {completion}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-tertiary">
                  <div className="h-full rounded-full bg-ai transition-all" style={{ width: `${completion}%` }} />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-border-primary bg-bg-primary/45 p-4">
                  <div className="flex items-center gap-2 border-b border-border-primary pb-3">
                    <Ruler className="h-4 w-4 text-accent" />
                    <h3 className="text-base font-black text-text-primary">Mục tiêu cơ thể</h3>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label="Cân nặng mục tiêu (kg)" name="target_weight" value={formData.target_weight} onChange={handleChange} type="number" />
                    <Field label="Body fat (%)" name="body_fat" value={formData.body_fat} onChange={handleChange} type="number" />
                    <Field label="Vòng eo (cm)" name="waist" value={formData.waist} onChange={handleChange} type="number" />
                    <Field label="Vòng hông (cm)" name="hips" value={formData.hips} onChange={handleChange} type="number" />
                    <Field label="Vòng cổ (cm)" name="neck" value={formData.neck} onChange={handleChange} type="number" />
                  </div>
                </section>

                <section className="rounded-xl border border-border-primary bg-bg-primary/45 p-4">
                  <div className="flex items-center gap-2 border-b border-border-primary pb-3">
                    <Apple className="h-4 w-4 text-info" />
                    <h3 className="text-base font-black text-text-primary">Ăn uống & lịch sinh hoạt</h3>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <SelectField label="Khả năng nấu ăn" name="cooking_ability" value={formData.cooking_ability} onChange={handleChange} options={['Tự nấu 100%', 'Ăn trưa ở ngoài, tối tự nấu', 'Chủ yếu ăn ngoài', 'Ít thời gian nấu']} />
                    <SelectField label="Ngân sách ăn uống" name="budget_level" value={formData.budget_level} onChange={handleChange} options={['Tiết kiệm', 'Trung bình', 'Thoải mái']} />
                    <SelectField label="Giờ tập thường hợp" name="workout_time" value={formData.workout_time} onChange={handleChange} options={['Sáng sớm', 'Buổi trưa', 'Chiều tối', 'Linh hoạt']} />
                    <Field label="Mục tiêu nước (lít/ngày)" name="daily_water_goal" value={formData.daily_water_goal} onChange={handleChange} type="number" />
                  </div>
                  <TextArea label="Chế độ ăn hiện tại" name="current_diet" value={formData.current_diet} onChange={handleChange} placeholder="Ví dụ: hay ăn ngoài buổi trưa, ít rau, không thích cá..." />
                </section>

                <section className="rounded-xl border border-border-primary bg-bg-primary/45 p-4">
                  <div className="flex items-center gap-2 border-b border-border-primary pb-3">
                    <Moon className="h-4 w-4 text-warning" />
                    <h3 className="text-base font-black text-text-primary">Phục hồi & sức khỏe</h3>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <SelectField label="Số giờ ngủ" name="sleep_hours" value={formData.sleep_hours} onChange={handleChange} options={['4', '6', '7', '8', '9']} />
                    <SelectField label="Chất lượng ngủ" name="sleep_quality" value={formData.sleep_quality} onChange={handleChange} options={['Tốt', 'Bình thường', 'Kém']} />
                    <SelectField label="Mức stress" name="stress_level" value={formData.stress_level} onChange={handleChange} options={['Thấp - Cuộc sống thoải mái', 'Trung bình - Áp lực công việc nhẹ', 'Cao - Thường xuyên căng thẳng']} />
                    <Field label="Thuốc đang dùng" name="medications" value={formData.medications} onChange={handleChange} />
                  </div>
                  <TextArea label="Chấn thương cần lưu ý" name="injuries" value={formData.injuries} onChange={handleChange} placeholder="Ví dụ: đau gối, lưng dưới yếu, cổ tay dễ đau..." />
                  <TextArea label="Dị ứng / món cần tránh" name="allergies" value={formData.allergies} onChange={handleChange} placeholder="Ví dụ: hải sản, sữa, đậu phộng, không ăn thịt bò..." />
                  <TextArea label="Bệnh nền hoặc lưu ý sức khỏe" name="health_condition" value={formData.health_condition} onChange={handleChange} />
                </section>

                <section className="rounded-xl border border-border-primary bg-bg-primary/45 p-4">
                  <div className="flex items-center gap-2 border-b border-border-primary pb-3">
                    <HeartPulse className="h-4 w-4 text-ai" />
                    <h3 className="text-base font-black text-text-primary">Ưu tiên riêng cho AI Coach</h3>
                  </div>
                  <div className="mt-4">
                    <SelectField label="Động lực chính" name="motivation" value={formData.motivation} onChange={handleChange} options={MOTIVATION_OPTIONS} />
                    <TextArea label="Điều bạn muốn AI nhớ" name="expectations" value={formData.expectations} onChange={handleChange} placeholder="Ví dụ: muốn ưu tiên mông, không thích burpee, cần lịch nhẹ đầu gối, thích món Việt dễ nấu..." rows={7} />
                  </div>
                </section>
              </div>
            </div>

            <footer className="shrink-0 border-t border-border-primary bg-bg-tertiary/65 px-4 py-4 sm:px-6">
              {error ? (
                <div className="mb-3 rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
                  {error}
                </div>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-border-primary bg-bg-secondary px-5 text-sm font-black text-text-secondary transition-colors hover:text-text-primary"
                >
                  Để sau
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ai px-5 text-sm font-black text-white transition-colors hover:bg-ai-hover disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Lưu hồ sơ AI
                </button>
              </div>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  type?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</span>
      <input
        name={name}
        value={value}
        onChange={onChange}
        type={type}
        step={type === 'number' ? '0.1' : undefined}
        className="h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  options: readonly string[];
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</span>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-ai"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextArea({
  label,
  name,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="mt-3 block space-y-1.5">
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</span>
      <textarea
        name={name}
        value={value}
        onChange={onChange}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-border-primary bg-bg-tertiary px-3 py-3 text-sm font-semibold text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-ai"
      />
    </label>
  );
}
