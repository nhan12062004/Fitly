import {
  Activity,
  ArrowRight,
  Droplets,
  Flame,
  HeartPulse,
  Info,
  Loader2,
  Scale,
  Target,
} from 'lucide-react';
import type { SurveyPlanSummary } from './SurveyForm';

interface SurveyResultScreenProps {
  summary: SurveyPlanSummary;
  isGeneratingPlan?: boolean;
  generationError?: string;
  onStart: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);

const formatKg = (value: number) => `${formatNumber(value, 1)} kg`;

const normalizeGenderOffset = (gender: string) => {
  if (gender === 'Nam') return 5;
  if (gender === 'Nữ') return -161;
  return -78;
};

const normalizeBodyFatSex = (gender: string) => (gender === 'Nam' ? 1 : gender === 'Nữ' ? 0 : 0.5);

const getBmiLabel = (bmi: number) => {
  if (bmi < 18.5) return { label: 'Thiếu cân', tone: 'text-sky-300' };
  if (bmi < 25) return { label: 'Bình thường', tone: 'text-accent' };
  if (bmi < 30) return { label: 'Thừa cân nhẹ', tone: 'text-amber-300' };
  return { label: 'Thừa cân', tone: 'text-red-300' };
};

const valueToAngle = (value: number, min: number, max: number) => {
  const ratio = clamp((value - min) / (max - min), 0, 1);
  return 180 + ratio * 180;
};

const polarToCartesian = (cx: number, cy: number, radius: number, angle: number) => {
  const radians = (angle * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
};

const describeArc = (startAngle: number, endAngle: number) => {
  const start = polarToCartesian(110, 110, 82, startAngle);
  const end = polarToCartesian(110, 110, 82, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A 82 82 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
};

function BmiGauge({ bmi }: { bmi: number }) {
  const bmiLabel = getBmiLabel(bmi);
  const needleAngle = valueToAngle(bmi, 15, 35);
  const needle = polarToCartesian(110, 110, 48, needleAngle);
  const segments = [
    { from: 15, to: 18.5, color: '#60a5fa', label: 'Thiếu cân' },
    { from: 18.5, to: 25, color: '#a3e635', label: 'Bình thường' },
    { from: 25, to: 30, color: '#f59e0b', label: 'Thừa cân nhẹ' },
    { from: 30, to: 35, color: '#fb7185', label: 'Thừa cân' },
  ];

  return (
    <div className="relative mx-auto h-[168px] w-full max-w-sm">
      <svg viewBox="0 0 220 144" className="h-full w-full overflow-visible">
        <path d={describeArc(180, 360)} stroke="rgba(255,255,255,0.08)" strokeWidth="18" fill="none" strokeLinecap="round" />
        {segments.map((segment) => (
          <path
            key={segment.label}
            d={describeArc(valueToAngle(segment.from, 15, 35), valueToAngle(segment.to, 15, 35))}
            stroke={segment.color}
            strokeWidth="18"
            fill="none"
            strokeLinecap="round"
          />
        ))}
        <line x1="110" y1="110" x2={needle.x} y2={needle.y} stroke="white" strokeWidth="4" strokeLinecap="round" />
        <circle cx="110" cy="110" r="7" fill="white" />
      </svg>
      <div className="absolute inset-x-0 top-14 text-center">
        <p className="text-4xl font-black leading-none text-text-primary">{formatNumber(bmi, 1)}</p>
        <p className={`mt-2 text-sm font-black ${bmiLabel.tone}`}>{bmiLabel.label}</p>
      </div>
      <div className="absolute bottom-0 left-1/2 flex w-full -translate-x-1/2 flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] font-bold text-text-tertiary">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  value,
  label,
  caption,
  toneClass,
}: {
  icon: typeof Activity;
  value: string;
  label: string;
  caption: string;
  toneClass: string;
}) {
  return (
    <div className="rounded-2xl border border-border-primary bg-bg-secondary/75 p-4 text-center">
      <span className={`mx-auto flex h-9 w-9 items-center justify-center rounded-xl ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-2xl font-black leading-none text-text-primary">{value}</p>
      <p className="mt-1 text-xs font-bold text-text-secondary">{label}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">{caption}</p>
    </div>
  );
}

function MacroRow({
  label,
  grams,
  percent,
  colorClass,
}: {
  label: string;
  grams: number;
  percent: number;
  colorClass: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-black">
        <span className="text-text-primary">{label}</span>
        <span className="text-text-secondary">
          <span className="text-text-primary">{formatNumber(grams)}g</span> {formatNumber(percent)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-primary">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${clamp(percent, 0, 100)}%` }} />
      </div>
    </div>
  );
}

export default function SurveyResultScreen({
  summary,
  isGeneratingPlan = false,
  generationError = '',
  onStart
}: SurveyResultScreenProps) {
  const heightMeters = Math.max(1, summary.heightCm || 170) / 100;
  const weightKg = Math.max(1, summary.weightKg || 68);
  const age = Math.max(1, summary.age || 28);
  const bmi = weightKg / (heightMeters * heightMeters);
  const idealMin = 18.5 * heightMeters * heightMeters;
  const idealMax = 24.9 * heightMeters * heightMeters;
  const bmr = Math.round(10 * weightKg + 6.25 * (summary.heightCm || 170) - 5 * age + normalizeGenderOffset(summary.gender));
  const tdee = Math.round(bmr * (1.2 + clamp(summary.weeklyWorkouts || 3, 0, 6) * 0.05));
  const targetCalories = Math.max(1200, summary.targetCalories || tdee);
  const proteinG = Math.round(weightKg * 1.8);
  const fatG = Math.round((targetCalories * 0.28) / 9);
  const carbsG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4));
  const proteinPercent = Math.round((proteinG * 4 / targetCalories) * 100);
  const carbsPercent = Math.round((carbsG * 4 / targetCalories) * 100);
  const fatPercent = Math.max(0, 100 - proteinPercent - carbsPercent);
  const estimatedBodyFat = clamp(1.2 * bmi + 0.23 * age - 10.8 * normalizeBodyFatSex(summary.gender) - 5.4, 8, 45);
  const fatMass = weightKg * estimatedBodyFat / 100;
  const leanMass = weightKg - fatMass;
  const waterLiters = Math.max(summary.dailyWaterGoalLiters || 2, Math.round(weightKg * 0.035 * 10) / 10);
  const waterBlocks = Math.max(6, Math.min(12, Math.round(waterLiters * 4)));
  const activeWaterBlocks = Math.round(waterLiters * 4);

  return (
    <div className="min-h-[100dvh] w-full bg-bg-primary px-3 py-6 text-text-primary sm:px-5 lg:px-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="text-center">
          <div className="mx-auto flex items-center justify-center gap-2">
            <span className="text-2xl font-black text-accent">✓</span>
            <span className="text-sm font-black text-accent">Fitly</span>
          </div>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-accent">
            <HeartPulse className="h-3.5 w-3.5" />
            Đánh giá thể trạng
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-text-primary">Kết quả phân tích</h1>
          <p className="mt-2 text-sm font-semibold text-text-secondary">
            AI dùng các chỉ số này để cá nhân hóa kế hoạch ăn & tập của bạn.
          </p>
        </header>

        <main className="mt-6 space-y-4">
          <section className="rounded-2xl border border-border-primary bg-bg-secondary/75 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">
              <span>BMI - chuẩn WHO Á Đông</span>
              <span>Lý tưởng: {formatKg(idealMin)} - {formatKg(idealMax)}</span>
            </div>
            <BmiGauge bmi={bmi} />
            <p className="mt-2 text-center text-xs font-semibold text-text-secondary">
              Cân đối theo chuẩn WHO Á Đông - duy trì thói quen hiện tại.
            </p>
          </section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard icon={Activity} value={formatNumber(bmr)} label="nghỉ ngơi" caption="BMR" toneClass="bg-blue-500/12 text-blue-300" />
            <MetricCard icon={Flame} value={formatNumber(tdee)} label="tiêu hao/ngày" caption="TDEE" toneClass="bg-orange-500/12 text-orange-300" />
            <MetricCard icon={Target} value={formatNumber(targetCalories)} label="ăn/ngày" caption="Mục tiêu" toneClass="bg-accent/12 text-accent" />
          </div>

          <section className="rounded-2xl border border-border-primary bg-bg-secondary/75 p-4 sm:p-5">
            <div>
              <h2 className="text-base font-black text-text-primary">Phân bổ dinh dưỡng</h2>
              <p className="mt-1 text-xs font-semibold text-text-secondary">Duy trì cân nặng</p>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-[7.5rem_1fr] sm:items-center">
              <div
                className="mx-auto flex h-28 w-28 items-center justify-center rounded-full"
                style={{
                  background: `conic-gradient(var(--info-primary) 0 ${proteinPercent}%, var(--accent-primary) ${proteinPercent}% ${proteinPercent + carbsPercent}%, var(--warning-primary) ${proteinPercent + carbsPercent}% 100%)`
                }}
              >
                <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-bg-primary">
                  <span className="text-lg font-black text-text-primary">{formatNumber(targetCalories)}</span>
                  <span className="text-[10px] font-bold text-text-tertiary">kcal/ngày</span>
                </div>
              </div>
              <div className="space-y-4">
                <MacroRow label="Protein" grams={proteinG} percent={proteinPercent} colorClass="bg-info" />
                <MacroRow label="Carbs" grams={carbsG} percent={carbsPercent} colorClass="bg-accent" />
                <MacroRow label="Chất béo" grams={fatG} percent={fatPercent} colorClass="bg-warning" />
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <section className="rounded-2xl border border-border-primary bg-bg-secondary/75 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Thành phần cơ thể</p>
              <p className="mt-3 text-3xl font-black text-orange-300">{formatNumber(estimatedBodyFat)}<span className="text-base text-text-secondary">% mỡ</span></p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg-primary">
                <div className="h-full rounded-full bg-blue-400" style={{ width: `${clamp((leanMass / weightKg) * 100, 0, 100)}%` }} />
              </div>
              <div className="mt-3 flex justify-between gap-3 text-[10px] font-bold text-text-secondary">
                <span>Khối cơ {formatKg(leanMass)}</span>
                <span>Mỡ {formatKg(fatMass)}</span>
              </div>
            </section>

            <section className="rounded-2xl border border-border-primary bg-bg-secondary/75 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/12 text-blue-300">
                  <Droplets className="h-4 w-4" />
                </span>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Nước / ngày</p>
              </div>
              <p className="mt-3 text-3xl font-black text-blue-300">{formatNumber(waterLiters, 1)}<span className="text-base text-text-secondary"> L</span></p>
              <div className="mt-4 grid grid-cols-8 gap-1">
                {Array.from({ length: waterBlocks }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-4 rounded ${index < activeWaterBlocks ? 'bg-blue-400' : 'bg-blue-400/20'}`}
                  />
                ))}
              </div>
              <p className="mt-3 text-[10px] font-bold text-text-tertiary">mỗi ô xấp xỉ 250ml</p>
            </section>
          </div>

          <section className="rounded-2xl border border-border-primary bg-bg-secondary/75 p-4">
            <div className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                <Info className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-black text-text-primary">Lộ trình ước tính</h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">
                  Duy trì cân nặng - tập trung cải thiện thành phần cơ thể theo thời gian.
                </p>
                <p className="mt-2 text-[11px] font-semibold leading-5 text-text-tertiary">
                  Duy trì cân nặng. Kết quả phụ thuộc vào sự đều đặn và giấc ngủ.
                </p>
              </div>
            </div>
          </section>

          {isGeneratingPlan || generationError ? (
            <section className={`rounded-2xl border p-4 ${generationError ? 'border-red-500/30 bg-red-500/10' : 'border-accent/25 bg-accent/10'}`}>
              <div className="flex gap-3">
                {isGeneratingPlan ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" /> : <Info className="h-5 w-5 shrink-0 text-red-300" />}
                <div>
                  <p className={`text-sm font-black ${generationError ? 'text-red-300' : 'text-accent'}`}>
                    {generationError ? 'Chưa tạo được lịch AI 7 ngày' : 'AI đang tạo lịch 7 ngày'}
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">
                    {generationError || 'Lịch tập và thực đơn sẽ được lưu tự động vào hồ sơ của bạn.'}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-border-primary bg-bg-secondary/75 p-4 text-[11px] font-semibold leading-5 text-text-secondary">
            <b className="text-text-primary">BMR</b> - năng lượng khi nghỉ hoàn toàn · <b className="text-text-primary">TDEE</b> - tổng tiêu hao theo mức vận động · <b className="text-text-primary">% mỡ</b> ước tính theo Deurenberg · <b className="text-text-primary">BMI</b> theo chuẩn WHO châu Á 2004.
          </section>

          <button
            type="button"
            onClick={onStart}
            disabled={isGeneratingPlan}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGeneratingPlan ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang tạo lịch 7 ngày
              </>
            ) : (
              <>
                Bắt đầu sử dụng
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <p className="pb-6 text-center text-xs font-semibold text-text-tertiary">
            Tiếp theo: thiết lập ngân sách & kho thực phẩm để AI lên thực đơn cá nhân hóa.
          </p>
        </main>
      </div>
    </div>
  );
}
