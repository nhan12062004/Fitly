import { useEffect, useState } from 'react';
import {
  CalendarDays,
  Clock3,
  Droplets,
  Dumbbell,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';

const bmiSegments = [
  { path: 'M 20 100 A 90 90 0 0 1 37.2 47.1', color: '#71A4F4' },
  { path: 'M 40.4 43.3 A 90 90 0 0 1 82.2 14.4', color: '#B2E458' },
  { path: 'M 86.8 13.1 A 90 90 0 0 1 133.2 13.1', color: '#F4C640' },
  { path: 'M 137.8 14.4 A 90 90 0 0 1 179.6 43.3', color: '#ED974F' },
  { path: 'M 182.8 47.1 A 90 90 0 0 1 200 100', color: '#E75D57' },
];

function BrandMark() {
  return (
    <div className="assessment-logo" aria-label="Fitly">
      <span className="fitly-mark"><img src="/logo.png" alt="" /></span>
      <span>FITLY</span>
    </div>
  );
}

type AssessmentData = {
  weight: number | null;
  height: number | null;
  targetWeight: number | null;
  bodyFat: number | null;
  waterMl: number | null;
  waterGoalMl: number | null;
  workoutPlan: WorkoutPlan | null;
};

type WorkoutExercise = {
  name: string;
  detail: string;
};

type WorkoutPlan = {
  name: string;
  explanation: string;
  exercises: WorkoutExercise[];
  isRestDay: boolean;
};

const numberOrNull = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const getVietnamDateKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const formatNumber = (value: number, digits = 0) => new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
}).format(value);

function BmiGauge({ value, label }: { value: number | null; label: string }) {
  const ratio = Math.max(0, Math.min(1, ((value || 22.5) - 14) / 20));
  const angle = Math.PI + ratio * Math.PI;
  const endpoint = { x: 110 + Math.cos(angle) * 65, y: 100 + Math.sin(angle) * 65 };
  return (
    <div className="bmi-gauge">
      <svg viewBox="0 0 220 122" role="img" aria-label={value ? `BMI ${value.toFixed(1)}, ${label}` : 'Chưa có dữ liệu BMI'}>
        <path className="gauge-base" d="M 20 100 A 90 90 0 0 1 200 100" />
        {bmiSegments.map(({ path, color }) => (
          <path key={color} d={path} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" />
        ))}
        {value && <line x1="110" y1="100" x2={endpoint.x} y2={endpoint.y} className="gauge-needle" />}
        <circle cx="110" cy="100" r="5.4" className="gauge-pivot" />
      </svg>
      <div className="gauge-score"><strong>{value ? value.toFixed(1) : '—'}</strong><span>{label}</span></div>
    </div>
  );
}

const getTodayWeekDay = () => {
  const today = new Date(`${getVietnamDateKey()}T00:00:00`);
  return today.getDay() === 0 ? 6 : today.getDay() - 1;
};

const formatExerciseDetail = (exercise: any) => {
  const sets = Number(exercise.planned_sets ?? exercise.sets ?? 0);
  const reps = String(exercise.planned_reps ?? exercise.reps ?? '').trim();
  const rest = Number(exercise.planned_rest_seconds ?? exercise.rest_seconds ?? 0);
  const parts = [] as string[];
  if (sets > 0 && reps && reps !== '0') parts.push(`${sets} hiệp × ${reps}`);
  if (rest > 0) parts.push(`nghỉ ${rest}s`);
  return parts.join(' · ') || 'Theo hướng dẫn AI';
};

export default function BodyAssessmentResult() {
  const { user } = useAuth();
  const [data, setData] = useState<AssessmentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setData(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    const loadAssessment = async () => {
      setIsLoading(true);
      const today = getVietnamDateKey();
      const [bodyRes, lifestyleRes, progressRes, planRes] = await Promise.all([
        supabase.from('body_metrics').select('weight, height, target_weight, body_fat, body_fat_percentage, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1),
        supabase.from('lifestyle_settings').select('daily_water_goal').eq('user_id', user.id).maybeSingle(),
        supabase.from('daily_progress_logs').select('water_intake_ml').eq('user_id', user.id).eq('log_date', today).limit(1),
        supabase.from('weekly_plans').select('id, name, description, ai_explanation').eq('user_id', user.id).eq('plan_status', 'active').order('week_start_date', { ascending: false }).order('updated_at', { ascending: false }).limit(1),
      ]);

      if (!active) return;
      const body = bodyRes.data?.[0];
      const plan = planRes.data?.[0];
      const exerciseRes = plan
        ? await supabase
          .from('weekly_plan_exercises')
          .select('sets, reps, rest_seconds, planned_sets, planned_reps, planned_rest_seconds, order_index, is_rest_day, exercises:exercise_id(name)')
          .eq('weekly_plan_id', plan.id)
          .eq('day_of_week', getTodayWeekDay())
          .order('order_index', { ascending: true })
        : null;
      if (!active) return;
      const planRows = (exerciseRes?.data || []) as any[];
      const activeExercises = planRows.filter((row) => !row.is_rest_day && row.exercises?.name);
      const workoutPlan: WorkoutPlan | null = plan
        ? {
            name: plan.name || 'Lịch tập AI hôm nay',
            explanation: plan.ai_explanation || plan.description || 'AI đã cá nhân hoá lịch tập dựa trên thông tin khảo sát của bạn.',
            exercises: activeExercises.map((row) => ({ name: row.exercises.name, detail: formatExerciseDetail(row) })),
            isRestDay: planRows.length > 0 && activeExercises.length === 0,
          }
        : null;
      const rawWaterGoal = numberOrNull(lifestyleRes.data?.daily_water_goal);
      const waterGoalMl = rawWaterGoal === null ? null : rawWaterGoal > 20 ? rawWaterGoal : rawWaterGoal * 1000;
      setData({
        weight: numberOrNull(body?.weight),
        height: numberOrNull(body?.height),
        targetWeight: numberOrNull(body?.target_weight),
        bodyFat: numberOrNull(body?.body_fat ?? body?.body_fat_percentage),
        waterMl: numberOrNull(progressRes.data?.[0]?.water_intake_ml),
        waterGoalMl,
        workoutPlan,
      });
      setIsLoading(false);
    };

    void loadAssessment();
    return () => { active = false; };
  }, [user]);

  const bmi = data?.weight && data.height ? data.weight / ((data.height / 100) ** 2) : null;
  const bmiLabel = !bmi ? 'Chưa có dữ liệu' : bmi < 18.5 ? 'Thiếu cân' : bmi < 23 ? 'Bình thường' : bmi < 25 ? 'Thừa cân nhẹ' : 'Thừa cân';
  const idealWeight = data?.height ? `${formatNumber(18.5 * (data.height / 100) ** 2, 1)}–${formatNumber(22.9 * (data.height / 100) ** 2, 1)} kg` : 'Chưa có chiều cao';
  const bodyFat = data?.bodyFat || 0;
  const displayedWaterMl = data?.waterMl ?? data?.waterGoalMl ?? null;
  const waterLitres = displayedWaterMl ? displayedWaterMl / 1000 : null;
  const waterProgress = data?.waterMl && data.waterGoalMl ? Math.min(8, Math.round(data.waterMl / data.waterGoalMl * 8)) : 0;
  const journeyMessage = data?.weight && data.targetWeight
    ? Math.abs(data.weight - data.targetWeight) < 0.5
      ? 'Bạn đang ở rất gần cân nặng mục tiêu.'
      : `Còn ${formatNumber(Math.abs(data.weight - data.targetWeight), 1)} kg để đạt cân nặng mục tiêu.`
    : 'Thêm cân nặng mục tiêu để theo dõi lộ trình.';

  return (
    <main className="assessment-page">
      <div className="assessment-topline" />
      <div className="assessment-shell">
        <header className="assessment-header">
          <BrandMark />
          <h1>Kết quả phân tích</h1>
          <p>{isLoading ? 'Đang tải chỉ số của bạn…' : user ? 'Dữ liệu được lấy từ hồ sơ và nhật ký hôm nay của bạn.' : 'Đăng nhập để xem các chỉ số thật của bạn.'}</p>
        </header>

        <section className="assessment-card bmi-card">
          <div className="card-kicker"><span>BMI — CHUẨN WHO Á ĐÔNG</span><span>Lý tưởng: {idealWeight}</span></div>
          <BmiGauge value={bmi} label={bmiLabel} />
          <div className="bmi-legend">
            <span><i className="blue" />Thiếu cân</span><span><i className="lime" />Bình thường</span><span><i className="yellow" />Thừa cân nhẹ</span><span><i className="orange" />Thừa cân</span>
          </div>
          <p className="bmi-note">{bmi ? `Tính từ ${formatNumber(data?.weight || 0, 1)} kg và ${formatNumber(data?.height || 0)} cm được lưu gần nhất.` : 'Cập nhật chiều cao và cân nặng trong Hồ sơ để xem BMI.'}</p>
        </section>

        <section className="assessment-card workout-card">
          <div className="workout-heading"><div><h2>Lịch tập AI hôm nay</h2><p>{data?.workoutPlan ? 'Được tạo từ thông tin khảo sát của bạn' : 'Chưa có lịch tập AI được tạo'}</p></div><CalendarDays size={16} /></div>
          {data?.workoutPlan?.isRestDay ? (
            <div className="workout-empty"><Dumbbell size={22} /><strong>Ngày nghỉ phục hồi</strong><span>AI đã xếp hôm nay là ngày nghỉ trong lịch tập của bạn.</span></div>
          ) : data?.workoutPlan?.exercises.length ? (
            <div className="workout-content">
              <div className="workout-summary"><Dumbbell size={25} /><strong>{data.workoutPlan.exercises.length}</strong><span>bài tập hôm nay</span></div>
              <div className="workout-list">
                {data.workoutPlan.exercises.slice(0, 3).map((exercise, index) => <div className="workout-item" key={`${exercise.name}-${index}`}><b>{index + 1}</b><span><strong>{exercise.name}</strong><small>{exercise.detail}</small></span></div>)}
                {data.workoutPlan.exercises.length > 3 && <p>+{data.workoutPlan.exercises.length - 3} bài tập khác trong lịch</p>}
              </div>
            </div>
          ) : <div className="workout-empty"><Dumbbell size={22} /><strong>AI đang tạo lịch tập</strong><span>Hãy quay lại sau khi quá trình tạo kế hoạch hoàn tất.</span></div>}
        </section>

        <section className="body-grid">
          <article className="assessment-card body-card">
            <h2>THÀNH PHẦN CƠ THỂ</h2>
            <div className="body-value"><strong>{data?.bodyFat ? formatNumber(data.bodyFat, 1) : '—'}</strong><span>% mỡ</span></div>
            <div className="composition-bar"><i style={{ width: data?.bodyFat ? `${Math.max(0, 100 - bodyFat)}%` : '0%' }} /><b style={{ width: `${bodyFat}%` }} /></div>
            <div className="composition-legend"><span><i className="blue" />Cân nặng {data?.weight ? `${formatNumber(data.weight, 1)} kg` : '—'}</span><span><i className="orange" />Mỡ {data?.bodyFat ? `${formatNumber(data.bodyFat, 1)}%` : '—'}</span></div>
          </article>
          <article className="assessment-card water-card">
            <h2><Droplets size={10} /> NƯỚC / NGÀY</h2>
            <div className="water-value"><strong>{waterLitres ? formatNumber(waterLitres, 1) : '—'}</strong><span>L</span></div>
            <div className="water-glasses" aria-label={`${waterProgress} trong 8 mức nước`}><i className={waterProgress > 0 ? 'filled' : ''} /><i className={waterProgress > 1 ? 'filled' : ''} /><i className={waterProgress > 2 ? 'filled' : ''} /><i className={waterProgress > 3 ? 'filled' : ''} /><i className={waterProgress > 4 ? 'filled' : ''} /><i className={waterProgress > 5 ? 'filled' : ''} /><i className={waterProgress > 6 ? 'filled' : ''} /><i className={waterProgress > 7 ? 'filled' : ''} /></div>
            <p>{data?.waterMl && data.waterGoalMl ? `Đã uống ${formatNumber(data.waterMl / 1000, 1)} / ${formatNumber(data.waterGoalMl / 1000, 1)} L` : data?.waterGoalMl ? 'Mục tiêu tự động từ khảo sát' : 'Chưa có mục tiêu nước'}</p>
          </article>
        </section>

        <section className="assessment-card journey-card">
          <div className="journey-icon"><Clock3 size={15} /></div>
          <div><h2>Lộ trình theo mục tiêu</h2><p>{journeyMessage}</p><small>Dựa trên cân nặng và mục tiêu được lưu gần nhất trong hồ sơ.</small></div>
        </section>

        <aside className="assessment-disclaimer"><b>BMI</b> — tính từ chiều cao và cân nặng đã lưu · <b>Lịch tập AI</b> — kế hoạch mới nhất tạo sau khảo sát · <b>% Mỡ</b> — ước tính từ khảo sát nếu chưa có số đo · <b>Nước</b> — mục tiêu tự động theo cân nặng và lịch tập.</aside>
        <button className="assessment-cta" type="button">Bắt đầu sử dụng <span>→</span></button>
      </div>
    </main>
  );
}
