import {
  Activity,
  ArrowRight,
  CalendarDays,
  Droplets,
  Dumbbell,
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

const formatNumber = (value: number, digits = 0) => {
  const formatted = new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
  return digits > 0 ? formatted.replace(',', '.') : formatted;
};

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
  const needleAngle = valueToAngle(bmi, 15, 35);
  const needle = polarToCartesian(110, 108, 52, needleAngle);
  const segments = [
    { from: 15, to: 18.5, color: '#60a5fa', label: 'Thiếu cân' },
    { from: 18.5, to: 25, color: '#a3ff32', label: 'Bình thường' },
    { from: 25, to: 30, color: '#f59e0b', label: 'Thừa cân nhẹ' },
    { from: 30, to: 35, color: '#fb7185', label: 'Thừa cân' },
  ];
  const displaySegments = [
    { from: 15, to: 18.5, color: '#60a5fa', label: 'Thiếu cân' },
    { from: 18.5, to: 23, color: '#a3ff32', label: 'Bình thường' },
    { from: 23, to: 25, color: '#fbbf24', label: 'Thừa cân nhẹ' },
    { from: 25, to: 30, color: '#f59e0b', label: 'Thừa cân' },
    { from: 30, to: 35, color: '#fb7185', label: 'Béo phì' },
  ];
  const displayBmiLabel = displaySegments.find((segment) => bmi < segment.to) || displaySegments[displaySegments.length - 1];
  const boundaries = [18.5, 23, 25, 30].map((value) => valueToAngle(value, 15, 35));

  return (
    <div className="relative mx-auto h-[184px] w-full max-w-[340px]">
      <svg viewBox="0 0 220 146" className="h-full w-full overflow-visible">
        <path
          d={describeArc(180, 360)}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="14"
          fill="none"
          strokeLinecap="butt"
        />
        {displaySegments.map((segment, index) => (
          <path
            key={segment.label}
            d={describeArc(valueToAngle(segment.from, 15, 35), valueToAngle(segment.to, 15, 35))}
            stroke={segment.color}
            strokeWidth="14"
            fill="none"
            strokeLinecap={index === 0 || index === displaySegments.length - 1 ? 'round' : 'butt'}
          />
        ))}
        {boundaries.map((angle, index) => {
          const radians = (angle * Math.PI) / 180;
          return (
            <line
              key={`boundary-${index}`}
              x1={110 + Math.cos(radians) * 75}
              y1={108 + Math.sin(radians) * 75}
              x2={110 + Math.cos(radians) * 89}
              y2={108 + Math.sin(radians) * 89}
              stroke="#f8fafc"
              strokeWidth="2.5"
            />
          );
        })}
        <line
          x1="110"
          y1="108"
          x2={needle.x}
          y2={needle.y}
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="butt"
        />
        <circle cx="110" cy="108" r="7" fill="#ffffff" />
      </svg>
      <div className="absolute inset-x-0 top-[60px] text-center">
        <p className="text-[42px] font-black leading-none text-white">{bmi.toFixed(1)}</p>
        <p className="mt-1 text-sm font-black" style={{ color: displayBmiLabel.color }}>{displayBmiLabel.label}</p>
      </div>
      <div className="absolute bottom-0 left-1/2 flex w-full -translate-x-1/2 flex-wrap justify-center gap-x-3 gap-y-1 text-[9px] font-bold text-[#8994a6]">
        {displaySegments.map((segment) => (
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
  const estimatedBodyFat = summary.estimatedBodyFatPercentage
    || clamp(1.2 * bmi + 0.23 * age - 10.8 * normalizeBodyFatSex(summary.gender) - 5.4, 3, 60);
  const fatMass = (weightKg * estimatedBodyFat) / 100;
  const leanMass = weightKg - fatMass;
  const waterMlPerKg = summary.weeklyWorkouts >= 5 ? 40 : summary.weeklyWorkouts >= 3 ? 35 : 30;
  const waterLiters = summary.dailyWaterGoalLiters || Math.round(weightKg * waterMlPerKg) / 1000;
  const waterGlasses = Math.round(waterLiters * 4);
  const waterBlocks = 8;
  const activeWaterBlocks = clamp(Math.round((waterLiters / 3.5) * waterBlocks), 1, 5);
  const bodyFatBar = clamp((leanMass / weightKg) * 100, 0, 100);
  const workoutItems = summary.hasAiWorkoutPreview ? summary.todayExercises : [];

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#090d13] px-4 py-10 text-white sm:px-5">
      <div className="mx-auto w-full max-w-[640px]">
        <header className="text-center">
          <div className="mx-auto flex items-center justify-center gap-1.5">
            <img src="/logo.png" alt="Fitly" className="h-7 w-7 object-contain" />
            <span className="hidden relative flex h-7 w-7 items-center justify-center">
              <span className="absolute h-4 w-1.5 rotate-[-28deg] rounded-full bg-[#1f7cff]" />
              <span className="absolute ml-3 h-6 w-1.5 rotate-[34deg] rounded-full bg-[#12e59a]" />
            </span>
            <span className="text-sm font-black text-[#7dfba0]">Fitly</span>
          </div>

          <div className="hidden mt-5 inline-flex items-center gap-2 rounded-full border border-[#0c766d] bg-[#062b2d] px-4 py-1.5 text-[10px] font-black uppercase text-[#5eead4] shadow-[0_0_22px_rgba(20,184,166,0.15)]">
            <HeartPulse className="h-3.5 w-3.5" strokeWidth={2.5} />
            Đánh giá thể trạng
          </div>

          <h1 className="mt-5 text-[0px] font-black leading-tight tracking-tight text-white sm:text-[0px]">
            Lịch tập AI đã sẵn sàng
            <span className="text-[28px] sm:text-[32px]">Kết quả phân tích</span>
          </h1>
          <p className="mt-1 text-[0px] font-semibold text-[#8390a3] sm:text-[0px]">
            Xem nhanh bài tập hôm nay, sau đó chuyển sang bước lên thực đơn.
            <span className="text-xs sm:text-sm">AI dùng các chỉ số này để cá nhân hóa kế hoạch ăn &amp; tập của bạn.</span>
          </p>
        </header>

        <main className="mt-6 flex flex-col gap-4">
          <Panel className="overflow-hidden">
            <div className="border-b border-[#273140] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase text-[#8c98aa]">Lịch tập hôm nay</p>
                  <h2 className="mt-1 text-xl font-black text-white">{summary.todayWorkout}</h2>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#9ca8ba]">
                    {summary.goal} · {summary.experience} · {summary.location}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-black text-[#cbd5e1] sm:min-w-[190px]">
                  <span className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0b1119] px-3 py-2">
                    <CalendarDays className="h-3.5 w-3.5 text-[#c8ff19]" />
                    {summary.weeklyWorkouts} buổi/tuần
                  </span>
                  <span className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0b1119] px-3 py-2">
                    <Activity className="h-3.5 w-3.5 text-[#60a5fa]" />
                    {summary.todayDuration || summary.duration}
                  </span>
                </div>
              </div>
            </div>

            <div className="divide-y divide-[#273140]">
              {isGeneratingPlan ? (
                <div className="flex items-center gap-3 p-4 text-sm font-semibold text-[#9ca8ba] sm:p-5">
                  <Loader2 className="h-5 w-5 animate-spin text-[#c8ff19]" />
                  AI đang phân tích hồ sơ và chọn bài tập phù hợp cho hôm nay.
                </div>
              ) : workoutItems.length > 0 ? workoutItems.map((exercise, index) => (
                <div key={`${exercise.name}-${index}`} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 p-4 sm:p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#c8ff19]/12 text-[#c8ff19]">
                    <Dumbbell className="h-4 w-4" strokeWidth={2.4} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{exercise.name}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-[#9ca8ba]">{exercise.detail}</p>
                  </div>
                </div>
              )) : (
                <div className="p-4 text-sm font-semibold leading-5 text-[#fca5a5] sm:p-5">
                  Chưa thể tải danh sách bài tập AI. Bạn vẫn có thể tiếp tục và tạo lại kế hoạch trong AI Coach.
                </div>
              )}
            </div>
          </Panel>

          <Panel className="order-first min-h-[270px] rounded-[24px] border-[#303947] bg-[#171d27] px-7 py-5 sm:px-8">
            <div className="flex items-center justify-between gap-3 text-[10px] font-black text-[#9aa8bb]">
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
              value={formatNumber(summary.weeklyWorkouts || 3)}
              label="buổi/tuần"
              caption="Tần suất"
              color="#2dd4bf"
              background="rgba(45,212,191,0.13)"
            />
          </div>

          <Panel className="hidden p-4 sm:p-5">
            <h2 className="text-base font-black text-white">Nhịp tập đề xuất</h2>
            <p className="mt-1 text-[11px] font-semibold text-[#8c98aa]">
              Ưu tiên đúng kỹ thuật trong tuần đầu, tăng tải khi hoàn thành đủ số hiệp.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-[#0b1119] p-3">
                <p className="text-[10px] font-black uppercase text-[#7b8798]">Mục tiêu</p>
                <p className="mt-1 text-sm font-black text-white">{summary.goal}</p>
              </div>
              <div className="rounded-xl bg-[#0b1119] p-3">
                <p className="text-[10px] font-black uppercase text-[#7b8798]">Địa điểm</p>
                <p className="mt-1 text-sm font-black text-white">{summary.location}</p>
              </div>
              <div className="rounded-xl bg-[#0b1119] p-3">
                <p className="text-[10px] font-black uppercase text-[#7b8798]">Thời lượng</p>
                <p className="mt-1 text-sm font-black text-white">{summary.duration}</p>
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
              <div className="mt-4 flex h-2 gap-1">
                <span className="h-full min-w-1 rounded-full bg-[#5794dc]" style={{ flex: bodyFatBar }} />
                <span className="h-full min-w-1 rounded-full bg-[#fb923c]" style={{ flex: 100 - bodyFatBar }} />
              </div>
              <div className="mt-3 flex justify-between gap-3 text-[10px] font-semibold text-[#9ca8ba]">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#60a5fa]" />
                  Khối cơ <strong className="font-black text-[#d7deea]">{formatKg(leanMass)}</strong>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#fb923c]" />
                  Mỡ <strong className="font-black text-[#d7deea]">{formatKg(fatMass)}</strong>
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
              <div className="mt-4 grid h-5 grid-cols-8 items-end gap-1">
                {Array.from({ length: waterBlocks }).map((_, index) => (
                  <span
                    key={index}
                    className={`rounded-[4px] ${index < activeWaterBlocks ? 'h-5 bg-[#5b8ed9]' : 'h-2.5 bg-[#18304f]'}`}
                  />
                ))}
              </div>
              <p className="mt-3 text-[10px] font-bold text-[#7b8798]">≈ {waterGlasses} ly 250ml · {waterMlPerKg} ml/kg/ngày</p>
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
                  Tập {summary.weeklyWorkouts} buổi/tuần, xen kẽ ngày nghỉ để cơ thể kịp phục hồi.
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-5 text-[#7d8899]">
                  Sau khi xem lịch tập, bước kế tiếp là lên thực đơn để khớp năng lượng và protein.
                </p>
              </div>
            </div>
          </Panel>

          {isGeneratingPlan ? (
            <Panel className="border-[#bfff18]/35 bg-[#bfff18]/10 p-4">
              <div className="flex gap-3">
                {isGeneratingPlan ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#c8ff19]" />
                ) : (
                  <Info className="h-5 w-5 shrink-0 text-red-300" />
                )}
                <div>
                  <p className={`text-sm font-black ${generationError ? 'text-red-300' : 'text-[#c8ff19]'}`}>
                    {generationError ? 'Chưa tạo được lịch tập AI 7 ngày' : 'AI đang tạo lịch tập 7 ngày'}
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#9ca8ba]">
                    {generationError || 'Chỉ lịch tập được lưu ở bước này. Thực đơn sẽ làm ở bước tiếp theo.'}
                  </p>
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel className="p-4 text-[11px] font-semibold leading-5 text-[#9ca8ba]">
            <b className="text-white">BMR</b> - năng lượng khi nghỉ hoàn toàn · <b className="text-white">TDEE</b> - tổng tiêu hao theo mức vận động · <b className="text-white">% mỡ</b> ước tính theo công thức Deurenberg (không thay thế InBody) · <b className="text-white">Nước</b> theo 30–40 ml/kg/ngày · <b className="text-white">BMI</b> theo chuẩn WHO châu Á 2004.
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
                Đang tạo lịch tập
              </>
            ) : (
              <>
                Khảo sát thực đơn
                <ArrowRight className="h-4 w-4" strokeWidth={3} />
              </>
            )}
          </button>

          <p className="pb-6 text-center text-xs font-semibold text-[#7b8798]">
            Tiếp theo: chọn sở thích ăn uống để cá nhân hóa thực đơn của bạn.
          </p>
        </main>
      </div>
    </div>
  );
}
