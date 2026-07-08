import {
  Activity,
  ArrowRight,
  Droplets,
  Flame,
  HeartPulse,
  Info,
  Loader2,
  Target,
} from 'lucide-react';
import type { SurveyPlanSummary } from './SurveyForm';

interface SurveyResultScreenProps {
  summary: SurveyPlanSummary;
  isGeneratingPlan?: boolean;
  generationError?: string;
  onStart: () => void;
}

type IconComponent = typeof Activity;

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
  if (bmi < 18.5) return { label: 'Thiếu cân', tone: 'text-[#60a5fa]' };
  if (bmi < 25) return { label: 'Bình thường', tone: 'text-[#9cff37]' };
  if (bmi < 30) return { label: 'Thừa cân nhẹ', tone: 'text-[#fbbf24]' };
  return { label: 'Thừa cân', tone: 'text-[#fb7185]' };
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
  const start = polarToCartesian(110, 108, 82, startAngle);
  const end = polarToCartesian(110, 108, 82, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A 82 82 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
};

function BmiGauge({ bmi }: { bmi: number }) {
  const bmiLabel = getBmiLabel(bmi);
  const needleAngle = valueToAngle(bmi, 15, 35);
  const needle = polarToCartesian(110, 108, 52, needleAngle);
  const segments = [
    { from: 15, to: 18.5, color: '#60a5fa', label: 'Thiếu cân' },
    { from: 18.5, to: 25, color: '#a3ff32', label: 'Bình thường' },
    { from: 25, to: 30, color: '#f59e0b', label: 'Thừa cân nhẹ' },
    { from: 30, to: 35, color: '#fb7185', label: 'Thừa cân' },
  ];

  return (
    <div className="relative mx-auto h-[178px] w-full max-w-[360px]">
      <svg viewBox="0 0 220 146" className="h-full w-full overflow-visible">
        <path
          d={describeArc(180, 360)}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="20"
          fill="none"
          strokeLinecap="round"
        />
        {segments.map((segment) => (
          <path
            key={segment.label}
            d={describeArc(valueToAngle(segment.from, 15, 35), valueToAngle(segment.to, 15, 35))}
            stroke={segment.color}
            strokeWidth="20"
            fill="none"
            strokeLinecap="round"
          />
        ))}
        <line
          x1="110"
          y1="108"
          x2={needle.x}
          y2={needle.y}
          stroke="#ffffff"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx="110" cy="108" r="7" fill="#ffffff" />
      </svg>
      <div className="absolute inset-x-0 top-[56px] text-center">
        <p className="text-[42px] font-black leading-none text-white">{formatNumber(bmi, 1)}</p>
        <p className={`mt-1 text-sm font-black ${bmiLabel.tone}`}>{bmiLabel.label}</p>
      </div>
      <div className="absolute bottom-0 left-1/2 flex w-full -translate-x-1/2 flex-wrap justify-center gap-x-3 gap-y-1 text-[9px] font-bold text-[#8994a6]">
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

function MacroRow({
  label,
  helper,
  grams,
  percent,
  color,
}: {
  label: string;
  helper: string;
  grams: number;
  percent: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-black text-white">{label}</p>
          <p className="mt-0.5 truncate text-[10px] font-semibold text-[#8490a3]">{helper}</p>
        </div>
        <p className="shrink-0 text-xs font-black" style={{ color }}>
          {formatNumber(grams)}g <span className="text-[10px] text-[#7b8798]">{formatNumber(percent)}%</span>
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#0a0f16]">
        <div className="h-full rounded-full" style={{ width: `${clamp(percent, 0, 100)}%`, backgroundColor: color }} />
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
  const activityMultiplier = 1.2 + clamp(summary.weeklyWorkouts || 3, 0, 6) * 0.05;
  const tdee = Math.round(bmr * activityMultiplier);
  const targetCalories = Math.max(1200, summary.targetCalories || tdee);
  const proteinG = Math.round(weightKg * 1.8);
  const fatG = Math.round((targetCalories * 0.28) / 9);
  const carbsG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4));
  const proteinPercent = Math.round(((proteinG * 4) / targetCalories) * 100);
  const carbsPercent = Math.round(((carbsG * 4) / targetCalories) * 100);
  const fatPercent = Math.max(0, 100 - proteinPercent - carbsPercent);
  const estimatedBodyFat = clamp(1.2 * bmi + 0.23 * age - 10.8 * normalizeBodyFatSex(summary.gender) - 5.4, 8, 45);
  const fatMass = (weightKg * estimatedBodyFat) / 100;
  const leanMass = weightKg - fatMass;
  const waterLiters = Math.max(summary.dailyWaterGoalLiters || 2, Math.round(weightKg * 0.035 * 10) / 10);
  const waterBlocks = 10;
  const activeWaterBlocks = clamp(Math.round(waterLiters * 4), 1, waterBlocks);
  const bodyFatBar = clamp((leanMass / weightKg) * 100, 0, 100);
  const macroGradient = `conic-gradient(#60a5fa 0 ${proteinPercent}%, #a3ff32 ${proteinPercent}% ${proteinPercent + carbsPercent}%, #fb923c ${proteinPercent + carbsPercent}% 100%)`;

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#090d13] px-4 py-10 text-white sm:px-5">
      <div className="fixed inset-x-0 top-0 z-20 h-[2px] bg-[#ff4055]" />

      <div className="mx-auto w-full max-w-[640px]">
        <header className="text-center">
          <div className="mx-auto flex items-center justify-center gap-2">
            <span className="relative flex h-7 w-7 items-center justify-center">
              <span className="absolute h-4 w-1.5 rotate-[-28deg] rounded-full bg-[#1f7cff]" />
              <span className="absolute ml-3 h-6 w-1.5 rotate-[34deg] rounded-full bg-[#12e59a]" />
            </span>
            <span className="text-sm font-black text-[#7dfba0]">Fitly</span>
          </div>

          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#0c766d] bg-[#062b2d] px-4 py-1.5 text-[10px] font-black uppercase text-[#5eead4] shadow-[0_0_22px_rgba(20,184,166,0.15)]">
            <HeartPulse className="h-3.5 w-3.5" strokeWidth={2.5} />
            Đánh giá thể trạng
          </div>

          <h1 className="mt-3 text-[28px] font-black leading-tight tracking-tight text-white sm:text-[32px]">
            Kết quả phân tích
          </h1>
          <p className="mt-1 text-xs font-semibold text-[#8390a3] sm:text-sm">
            AI dùng các chỉ số này để cá nhân hóa kế hoạch ăn & tập của bạn.
          </p>
        </header>

        <main className="mt-6 space-y-4">
          <Panel className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase text-[#8c98aa]">
              <span>BMI - Chuẩn WHO Á Đông</span>
              <span>Lý tưởng: {formatKg(idealMin)}-{formatKg(idealMax)}</span>
            </div>
            <BmiGauge bmi={bmi} />
            <p className="mt-2 text-center text-[11px] font-semibold text-[#8c98aa]">
              Cân đối theo chuẩn WHO Á Đông - duy trì thói quen hiện tại.
            </p>
          </Panel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              icon={Activity}
              value={formatNumber(bmr)}
              label="nghỉ ngơi"
              caption="BMR"
              color="#60a5fa"
              background="rgba(96,165,250,0.13)"
            />
            <MetricCard
              icon={Flame}
              value={formatNumber(tdee)}
              label="tiêu hao/ngày"
              caption="TDEE"
              color="#fb923c"
              background="rgba(251,146,60,0.13)"
            />
            <MetricCard
              icon={Target}
              value={formatNumber(targetCalories)}
              label="ăn/ngày"
              caption="Mục tiêu"
              color="#2dd4bf"
              background="rgba(45,212,191,0.13)"
            />
          </div>

          <Panel className="p-4 sm:p-5">
            <h2 className="text-base font-black text-white">Phân bổ dinh dưỡng</h2>
            <p className="mt-1 text-[11px] font-semibold text-[#8c98aa]">Duy trì cân nặng</p>

            <div className="mt-5 grid gap-5 sm:grid-cols-[128px_1fr] sm:items-center">
              <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full" style={{ background: macroGradient }}>
                <div className="flex h-[78px] w-[78px] flex-col items-center justify-center rounded-full bg-[#090d13]">
                  <span className="text-lg font-black text-white">{formatNumber(targetCalories)}</span>
                  <span className="text-[10px] font-bold text-[#7b8798]">kcal/ngày</span>
                </div>
              </div>

              <div className="space-y-4">
                <MacroRow label="Protein" helper="Xây cơ & phục hồi" grams={proteinG} percent={proteinPercent} color="#60a5fa" />
                <MacroRow label="Carbs" helper="Năng lượng tập" grams={carbsG} percent={carbsPercent} color="#a3ff32" />
                <MacroRow label="Chất béo" helper="Hormone & vitamin" grams={fatG} percent={fatPercent} color="#fb923c" />
              </div>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Panel className="p-4">
              <p className="text-[10px] font-black uppercase text-[#8c98aa]">Thành phần cơ thể</p>
              <p className="mt-3 text-3xl font-black leading-none text-[#f6b35f]">
                {formatNumber(estimatedBodyFat)}
                <span className="ml-1 text-base font-black text-[#cbd5e1]">% mỡ</span>
              </p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#0a0f16]">
                <div className="h-full rounded-full bg-[#60a5fa]" style={{ width: `${bodyFatBar}%` }} />
              </div>
              <div className="mt-3 flex justify-between gap-3 text-[10px] font-bold text-[#9ca8ba]">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#60a5fa]" />
                  Khối cơ {formatKg(leanMass)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#fb923c]" />
                  Mỡ {formatKg(fatMass)}
                </span>
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#60a5fa]/15 text-[#60a5fa]">
                  <Droplets className="h-4 w-4" strokeWidth={2.4} />
                </span>
                <p className="text-[10px] font-black uppercase text-[#8c98aa]">Nước / ngày</p>
              </div>
              <p className="mt-3 text-3xl font-black leading-none text-[#93c5fd]">
                {formatNumber(waterLiters, 1)}
                <span className="ml-1 text-base font-black text-[#cbd5e1]">L</span>
              </p>
              <div className="mt-4 grid grid-cols-10 gap-1">
                {Array.from({ length: waterBlocks }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-4 rounded-[4px] ${index < activeWaterBlocks ? 'bg-[#5b8ed9]' : 'bg-[#18304f]'}`}
                  />
                ))}
              </div>
              <p className="mt-3 text-[10px] font-bold text-[#7b8798]">≈ 8 ly 250ml</p>
            </Panel>
          </div>

          <Panel className="p-4">
            <div className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#14b8a6]/15 text-[#2dd4bf]">
                <Info className="h-4 w-4" strokeWidth={2.4} />
              </span>
              <div>
                <h2 className="text-sm font-black text-white">Lộ trình ước tính</h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#a2adbd]">
                  Duy trì cân nặng - tập trung cải thiện thành phần cơ thể theo thời gian.
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-5 text-[#7d8899]">
                  Duy trì cân nặng. Kết quả phụ thuộc vào sự đều đặn và giấc ngủ.
                </p>
              </div>
            </div>
          </Panel>

          {isGeneratingPlan || generationError ? (
            <Panel className={`p-4 ${generationError ? 'border-red-500/35 bg-red-500/10' : 'border-[#bfff18]/35 bg-[#bfff18]/10'}`}>
              <div className="flex gap-3">
                {isGeneratingPlan ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#c8ff19]" />
                ) : (
                  <Info className="h-5 w-5 shrink-0 text-red-300" />
                )}
                <div>
                  <p className={`text-sm font-black ${generationError ? 'text-red-300' : 'text-[#c8ff19]'}`}>
                    {generationError ? 'Chưa tạo được lịch AI 7 ngày' : 'AI đang tạo lịch 7 ngày'}
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#9ca8ba]">
                    {generationError || 'Lịch tập và thực đơn sẽ được lưu tự động vào hồ sơ của bạn.'}
                  </p>
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel className="p-4 text-[11px] font-semibold leading-5 text-[#9ca8ba]">
            <b className="text-white">BMR</b> - năng lượng khi nghỉ hoàn toàn · <b className="text-white">TDEE</b> - tổng tiêu hao theo mức vận động · <b className="text-white">% mỡ</b> ước tính theo Deurenberg · <b className="text-white">BMI</b> theo chuẩn WHO châu Á 2004.
          </Panel>

          <button
            type="button"
            onClick={onStart}
            disabled={isGeneratingPlan}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#c8ff19] px-6 py-4 text-sm font-black text-[#071007] shadow-[0_16px_36px_rgba(200,255,25,0.22)] transition-colors hover:bg-[#b9f40f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGeneratingPlan ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang tạo lịch 7 ngày
              </>
            ) : (
              <>
                Bắt đầu sử dụng
                <ArrowRight className="h-4 w-4" strokeWidth={3} />
              </>
            )}
          </button>

          <p className="pb-6 text-center text-xs font-semibold text-[#7b8798]">
            Tiếp theo: thiết lập ngân sách & kho thực phẩm để AI lên thực đơn cá nhân hóa.
          </p>
        </main>
      </div>
    </div>
  );
}
