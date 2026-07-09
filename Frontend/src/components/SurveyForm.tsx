import React, { useState } from 'react';
import {
  Activity,
  Bike,
  Calendar,
  Check,
  EyeOff,
  User,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Home,
  Sofa,
  Stethoscope,
  Target,
  Loader2,
  Mars,
  Minus,
  MoveVertical,
  Plus,
  Venus,
  VenusAndMars,
  Weight,
  Wind,
  Zap,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from './LoadingScreen';
import {
  DEFAULT_WORKOUT_FREQUENCY,
  WORKOUT_FREQUENCY_OPTIONS,
  normalizeWorkoutFrequency,
  weeklyWorkoutsToFrequency,
  workoutFrequencyToWeeklyWorkouts,
} from '../lib/WorkoutFrequency';
import {
  DEFAULT_MOTIVATION,
  normalizeMotivation,
} from '../lib/MotivationOptions';
import {
  DEFAULT_WORKOUT_DURATION,
  WORKOUT_DURATION_TAGS,
  normalizeWorkoutDurationTag,
} from '../lib/WorkoutDuration';
import { useToast } from './ToastProvider';

export type SurveyPlanSummary = {
  goal: string;
  experience: string;
  frequency: string;
  duration: string;
  targetCalories: number;
  gender: string;
  age: number;
  heightCm: number;
  weightKg: number;
  weeklyWorkouts: number;
  mealsPerDay: number;
  dailyWaterGoalLiters: number;
  location: string;
  todayWorkout: string;
  todayDuration: string;
  meals: string;
  todayExercises: Array<{
    name: string;
    detail: string;
  }>;
  todayMeals: Array<{
    label: string;
    dish: string;
    detail: string;
  }>;
};

interface SurveyFormProps {
  onComplete: (summary?: SurveyPlanSummary) => void | Promise<void>;
  isOpen?: boolean;
  onClose?: () => void;
}

const TOTAL_STEPS = 4;
/** Nhãn ngắn trên thanh bước (theo mockup) */
const STEP_NAV_LABELS = [
  'Cơ thể',
  'Mục tiêu',
  'Vận động',
  'Tập luyện'
];

type StepIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
  icon?: StepIcon;
  iconWrapClass?: string;
  iconClass?: string;
};

const GOAL_OPTIONS: ChoiceOption[] = [
  {
    value: 'Giảm mỡ',
    label: 'Giảm mỡ',
    description: 'Đốt mỡ thừa, lấy lại vóc dáng tự tin.',
    icon: Flame,
    iconWrapClass: 'bg-orange-500/12 text-orange-400 ring-orange-400/35',
  },
  {
    value: 'Tăng cơ',
    label: 'Tăng cơ',
    description: 'Cơ rắn chắc, thân hình thon gọn hơn mỗi tuần.',
    icon: Dumbbell,
    iconWrapClass: 'bg-lime-500/12 text-lime-300 ring-lime-300/35',
  },
  {
    value: 'Sức mạnh',
    label: 'Sức mạnh',
    description: 'Nâng nặng hơn mỗi tuần, cảm giác mạnh mẽ thật sự.',
    icon: Zap,
    iconWrapClass: 'bg-cyan-500/12 text-cyan-300 ring-cyan-300/35',
  },
  {
    value: 'Sức bền',
    label: 'Sức bền',
    description: 'Tim khỏe hơn, vận động lâu mà ít mệt.',
    icon: HeartPulse,
    iconWrapClass: 'bg-red-500/12 text-red-300 ring-red-300/35',
  },
  {
    value: 'Dẻo dai',
    label: 'Dẻo dai',
    description: 'Khớp linh hoạt, giảm đau lưng và nguy cơ chấn thương.',
    icon: Wind,
    iconWrapClass: 'bg-purple-500/12 text-purple-300 ring-purple-300/35',
  },
  {
    value: 'Phục hồi & Tái tạo',
    label: 'Phục hồi & Tái tạo',
    description: 'Lấy lại năng lượng, giảm căng thẳng và phục hồi tốt hơn.',
    icon: Target,
    iconWrapClass: 'bg-slate-500/12 text-slate-300 ring-slate-300/35',
  }
];

const ACTIVITY_LEVEL_OPTIONS: ChoiceOption[] = [
  {
    value: '2 ngày/tuần',
    label: 'Ít vận động',
    description: 'Công việc văn phòng, ít đi lại trong ngày.',
    icon: Sofa,
    iconWrapClass: 'bg-slate-500/12 text-slate-300 ring-slate-300/30',
  },
  {
    value: '3 ngày/tuần',
    label: 'Vận động nhẹ',
    description: 'Đi bộ hoặc tập nhẹ vài buổi mỗi tuần.',
    icon: Footprints,
    iconWrapClass: 'bg-lime-500/12 text-lime-300 ring-lime-300/35',
  },
  {
    value: '4 ngày/tuần',
    label: 'Vận động đều',
    description: 'Tập 3-5 ngày/tuần, giữ sức khỏe ổn định.',
    icon: Bike,
    iconWrapClass: 'bg-sky-500/12 text-sky-300 ring-sky-300/35',
  },
  {
    value: '5 ngày/tuần',
    label: 'Vận động nhiều',
    description: 'Cường độ cao gần như mỗi ngày - bạn nghiêm túc.',
    icon: Zap,
    iconWrapClass: 'bg-purple-500/12 text-purple-300 ring-purple-300/35',
  }
];

const GENDER_OPTIONS: ChoiceOption[] = [
  {
    value: 'Nam',
    label: 'Nam',
    icon: Mars,
    iconWrapClass: 'text-text-primary',
  },
  {
    value: 'Nữ',
    label: 'Nữ',
    icon: Venus,
    iconWrapClass: 'text-text-primary',
  },
  {
    value: 'Khác',
    label: 'Khác',
    icon: VenusAndMars,
    iconWrapClass: 'text-text-primary',
  },
  {
    value: 'Ẩn',
    label: 'Ẩn',
    icon: EyeOff,
    iconWrapClass: 'text-text-primary',
  }
];

const EXPERIENCE_OPTIONS: ChoiceOption[] = [
  { value: 'Người mới', label: 'Người mới', description: 'Cần bài dễ bám và ít rủi ro' },
  { value: 'Đã tập dưới 6 tháng', label: 'Dưới 6 tháng', description: 'Đã quen động tác cơ bản' },
  { value: 'Trung cấp', label: 'Trung cấp', description: 'Tập đều và muốn tăng hiệu quả' },
  { value: 'Nâng cao', label: 'Nâng cao', description: 'Cần lịch có tải và cấu trúc rõ' }
];

const LOCATION_OPTIONS: ChoiceOption[] = [
  { value: 'Phòng Gym', label: 'Phòng gym', description: 'Có máy và tạ đầy đủ', icon: Dumbbell },
  { value: 'Tập tại nhà (Home Workout)', label: 'Tập ở nhà', description: 'Ưu tiên bài ít hoặc không dụng cụ', icon: Home }
];

const DIET_OPTIONS: ChoiceOption[] = [
  { value: 'Bình thường', label: 'Bình thường' },
  { value: 'Ăn chay', label: 'Ăn chay' },
  { value: 'Ăn nhiều đạm (High Protein)', label: 'Nhiều đạm' },
  { value: 'Keto / Low Carb', label: 'Low Carb' },
  { value: 'Eat Clean', label: 'Eat Clean' }
];

const MEAL_OPTIONS: ChoiceOption[] = [
  { value: '2', label: '2 bữa' },
  { value: '3', label: '3 bữa' },
  { value: '4', label: '4 bữa', description: 'Có 1 bữa phụ' },
  { value: '5', label: '5 bữa nhỏ' }
];

interface StepSurveyCardProps {
  icon: StepIcon;
  iconWrapClass: string;
  iconClass: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function StepSurveyCard({ icon: Icon, iconWrapClass, iconClass, title, subtitle, children, footer }: StepSurveyCardProps) {
  return (
    <section className="rounded-[24px] border border-border-primary bg-bg-secondary/92 p-4 shadow-[0_20px_48px_rgba(0,0,0,0.12)] md:p-7">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconWrapClass}`}>
            <Icon className={iconClass} aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-lg font-black tracking-tight text-text-primary sm:text-xl md:text-2xl">{title}</h3>
            <p className="max-w-2xl text-sm font-semibold leading-6 text-text-secondary">{subtitle}</p>
          </div>
        </div>
        <div className="mt-6 space-y-5 md:mt-7 md:space-y-6">
          {children}
        </div>
        {footer ? (
          <div className="mt-6 border-t border-border-primary pt-5 md:mt-7 md:pt-6">
            {footer}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ChoiceGrid({
  name,
  value,
  options,
  onChange,
  columns = 'md:grid-cols-3',
  compact = false
}: {
  name: string;
  value: string;
  options: ChoiceOption[];
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  columns?: string;
  compact?: boolean;
}) {
  return (
    <div className={`grid grid-cols-1 ${compact ? 'gap-2' : 'gap-2.5'} ${columns}`}>
      {options.map((option) => {
        const active = value === option.value;
        const Icon = option.icon;
        return (
          <label
            key={option.value}
            className={`group flex cursor-pointer flex-col border transition-colors sm:px-4 ${
              compact ? 'min-h-[58px] rounded-xl px-3.5 py-2.5' : 'min-h-[72px] justify-between rounded-2xl px-3.5 py-3'
            } ${
              active
                ? 'border-accent/50 bg-accent/10 text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'border-border-primary bg-bg-primary/65 text-text-secondary hover:border-accent/30 hover:bg-bg-primary'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={onChange}
              className="sr-only"
            />
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-black text-text-primary">{option.label}</span>
                {option.description ? (
                  <span className={`${compact ? 'mt-0.5 leading-4' : 'mt-1 leading-5'} block text-xs font-semibold text-text-tertiary`}>{option.description}</span>
                ) : null}
              </span>
              {Icon ? (
                <span className={`flex ${compact ? 'h-7 w-7' : 'h-8 w-8'} shrink-0 items-center justify-center rounded-lg ${active ? 'bg-accent/15 text-accent' : 'bg-bg-secondary text-text-tertiary'}`}>
                  <Icon className="h-4 w-4" />
                </span>
              ) : (
                <span className={`mt-1 ${compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} shrink-0 rounded-full ${active ? 'bg-accent' : 'border border-border-primary'}`} />
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function GenderChoiceList({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: ChoiceOption[];
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {options.map((option) => {
        const active = value === option.value;
        const Icon = option.icon || User;
        return (
          <label
            key={option.value}
            className={`flex min-h-[78px] cursor-pointer flex-col items-center justify-center rounded-md border px-3 py-3 text-center transition-colors ${
              active
                ? 'border-accent bg-accent/10 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                : 'border-border-primary bg-bg-secondary text-text-primary hover:border-accent/45 hover:bg-bg-tertiary'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={onChange}
              className="sr-only"
            />
            <span className={`flex h-8 w-8 items-center justify-center ${active ? 'text-accent' : option.iconWrapClass || 'text-text-primary'}`}>
              <Icon className="h-6 w-6" strokeWidth={2.4} />
            </span>
            <span className={`mt-2 block text-xs font-bold ${active ? 'text-accent' : 'text-text-primary'}`}>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function GoalChoiceGrid({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: ChoiceOption[];
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const active = value === option.value;
        const Icon = option.icon || Target;
        return (
          <label
            key={option.value}
            className={`relative flex min-h-[132px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border px-4 py-5 text-center transition-colors ${
              active
                ? 'border-accent bg-accent/10 text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-accent/35 hover:bg-bg-tertiary'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={onChange}
              className="sr-only"
            />
            {active ? (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-text-inverse">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
            ) : null}
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ring-1 ${option.iconWrapClass || 'bg-accent/12 text-accent ring-accent/30'}`}>
              <Icon className={`h-6 w-6 ${option.iconClass || ''}`} strokeWidth={2.4} />
            </span>
            <span className="mt-3 min-w-0">
              <span className={`block text-base font-black leading-tight ${active ? 'text-accent' : 'text-text-primary'}`}>{option.label}</span>
              {option.description ? (
                <span className="mt-1.5 block text-xs font-semibold leading-5 text-text-secondary">
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function NumberStepper({
  name,
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  fallback,
  onChange,
  invalid,
  error,
}: {
  name: 'age' | 'height' | 'weight';
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  unit: string;
  fallback: number;
  onChange: (name: 'age' | 'height' | 'weight', value: string) => void;
  invalid?: boolean;
  error: string;
}) {
  const parsed = Number(value);
  const current = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  const clampValue = (nextValue: number) => Math.min(max, Math.max(min, Math.round(nextValue / step) * step));
  const emit = (nextValue: number) => onChange(name, String(clampValue(nextValue)));

  return (
    <div className={`rounded-lg border bg-bg-primary/65 p-4 transition-colors ${
      invalid ? 'border-red-500' : 'border-border-primary hover:border-accent/30'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`survey-${name}`} className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
          {label} <span className="text-red-500">*</span>
        </label>
        <span className="text-xs font-bold text-text-tertiary">{unit}</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => emit(current - step)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-primary bg-bg-secondary text-text-primary transition-colors hover:border-accent/40 hover:text-accent"
          aria-label={`Giảm ${label.toLowerCase()}`}
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="min-w-0 text-center">
          <p className="text-3xl font-black leading-none text-text-primary">
            {current}
          </p>
          <p className="mt-1 text-xs font-semibold text-text-tertiary">{unit}</p>
        </div>
        <button
          type="button"
          onClick={() => emit(current + step)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-primary bg-bg-secondary text-text-primary transition-colors hover:border-accent/40 hover:text-accent"
          aria-label={`Tăng ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <input
        id={`survey-${name}`}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(event) => onChange(name, event.target.value)}
        className="mt-4 h-2 w-full cursor-pointer rounded-full"
        style={{ accentColor: 'var(--accent-primary)' }}
      />
      {invalid ? (
        <p className="mt-2 text-[10px] font-medium text-red-500">{error}</p>
      ) : null}
    </div>
  );
}

function CompactMetricInput({
  name,
  label,
  value,
  placeholder,
  min,
  max,
  icon: Icon,
  onChange,
  invalid,
  error,
}: {
  name: 'age' | 'height' | 'weight';
  label: string;
  value: string;
  placeholder: string;
  min: number;
  max: number;
  icon: StepIcon;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  invalid?: boolean;
  error: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`survey-compact-${name}`} className="block text-xs font-black text-text-primary">
        {label}
      </label>
      <div className={`flex h-9 items-center gap-2 rounded-md border bg-bg-secondary px-3 transition-colors ${
        invalid ? 'border-red-500' : 'border-border-primary focus-within:border-accent'
      }`}>
        <Icon className="h-4 w-4 shrink-0 text-text-secondary" strokeWidth={2.2} />
        <input
          id={`survey-compact-${name}`}
          name={name}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
      {invalid ? (
        <p className="text-[10px] font-medium text-red-500">{error}</p>
      ) : null}
    </div>
  );
}

function ActivityChoiceList({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: ChoiceOption[];
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="space-y-2.5">
      {options.map((option) => {
        const active = normalizeWorkoutFrequency(value) === option.value;
        const Icon = option.icon || Activity;
        return (
          <label
            key={option.value}
            className={`flex min-h-[76px] cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
              active
                ? 'border-accent bg-accent/10 text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                : 'border-border-primary bg-bg-primary/65 text-text-secondary hover:border-accent/35 hover:bg-bg-primary'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={onChange}
              className="sr-only"
            />
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${option.iconWrapClass || 'bg-accent/12 text-accent ring-accent/30'}`}>
              <Icon className="h-5 w-5" strokeWidth={2.4} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-base font-black ${active ? 'text-accent' : 'text-text-primary'}`}>{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-xs font-semibold leading-5 text-text-tertiary">
                  {option.description}
                </span>
              ) : null}
            </span>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
              active ? 'border-accent bg-accent text-text-inverse' : 'border-border-primary text-transparent'
            }`}>
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          </label>
        );
      })}
    </div>
  );
}

const birthdayToAge = (birthday: string | null | undefined) => {
  if (!birthday) return '';
  const date = new Date(birthday);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age -= 1;
  return age > 0 ? String(age) : '';
};

const ageToBirthday = (age: string) => {
  const parsedAge = Number(age);
  if (!Number.isFinite(parsedAge) || parsedAge <= 0) return null;
  return `${new Date().getFullYear() - Math.round(parsedAge)}-01-01`;
};

const hasPositiveNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const normalizeGender = (value: string | null | undefined) =>
  GENDER_OPTIONS.some((option) => option.value === value) ? String(value) : 'Nam';

const normalizePlainText = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const buildTodayExercises = ({
  experience,
  location,
  goal
}: {
  experience: string;
  location: string;
  goal: string;
}) => {
  const normalizedExperience = normalizePlainText(experience);
  const normalizedLocation = normalizePlainText(location);
  const normalizedGoal = normalizePlainText(goal);
  const isHome = normalizedLocation.includes('nha') || normalizedLocation.includes('home');
  const isBeginner = normalizedExperience.includes('nguoi moi') || normalizedExperience.includes('duoi 6 thang');

  if (isHome) {
    return [
      { name: 'Squat ghế', detail: isBeginner ? '3 hiệp x 10-12 lần' : '4 hiệp x 12-15 lần' },
      { name: 'Chống đẩy nghiêng', detail: isBeginner ? '3 hiệp x 8-10 lần' : '4 hiệp x 10-12 lần' },
      { name: 'Glute bridge', detail: '3 hiệp x 12-15 lần' },
      { name: 'Dead bug', detail: '3 hiệp x 10 lần mỗi bên' },
      { name: 'Plank', detail: isBeginner ? '3 hiệp x 20-30 giây' : '3 hiệp x 35-45 giây' }
    ];
  }

  if (isBeginner) {
    return [
      { name: 'Leg press', detail: '3 hiệp x 10-12 lần' },
      { name: 'Chest press machine', detail: '3 hiệp x 10-12 lần' },
      { name: 'Lat pulldown', detail: '3 hiệp x 10-12 lần' },
      { name: 'Seated row', detail: '3 hiệp x 10-12 lần' },
      { name: 'Plank', detail: '3 hiệp x 25-35 giây' }
    ];
  }

  if (normalizedGoal.includes('tang co')) {
    return [
      { name: 'Goblet squat', detail: '4 hiệp x 8-10 lần' },
      { name: 'Dumbbell bench press', detail: '4 hiệp x 8-10 lần' },
      { name: 'Lat pulldown', detail: '4 hiệp x 10-12 lần' },
      { name: 'Romanian deadlift', detail: '3 hiệp x 8-10 lần' },
      { name: 'Cable crunch', detail: '3 hiệp x 12-15 lần' }
    ];
  }

  if (normalizedGoal.includes('suc manh')) {
    return [
      { name: 'Squat hoặc leg press', detail: '4 hiệp x 5-6 lần' },
      { name: 'Bench press hoặc chest press', detail: '4 hiệp x 5-6 lần' },
      { name: 'Seated row', detail: '4 hiệp x 6-8 lần' },
      { name: 'Romanian deadlift', detail: '3 hiệp x 6-8 lần' },
      { name: 'Farmer carry', detail: '3 lượt x 30-40 mét' }
    ];
  }

  if (normalizedGoal.includes('suc ben')) {
    return [
      { name: 'Đi bộ nhanh hoặc đạp xe', detail: '12 phút nhịp đều' },
      { name: 'Bodyweight squat', detail: '3 hiệp x 15 lần' },
      { name: 'Incline push-up', detail: '3 hiệp x 12-15 lần' },
      { name: 'Step-up', detail: '3 hiệp x 12 lần mỗi bên' },
      { name: 'Plank shoulder tap', detail: '3 hiệp x 30 giây' }
    ];
  }

  if (normalizedGoal.includes('deo dai')) {
    return [
      { name: 'World greatest stretch', detail: '2 hiệp x 5 lần mỗi bên' },
      { name: 'Hip flexor stretch', detail: '2 hiệp x 40 giây mỗi bên' },
      { name: 'Thoracic rotation', detail: '3 hiệp x 8 lần mỗi bên' },
      { name: 'Cossack squat nhẹ', detail: '3 hiệp x 6-8 lần mỗi bên' },
      { name: 'Breathing cooldown', detail: '4 phút cuối buổi' }
    ];
  }

  if (normalizedGoal.includes('phuc hoi') || normalizedGoal.includes('tai tao')) {
    return [
      { name: 'Đi bộ nhẹ', detail: '8-10 phút khởi động' },
      { name: 'Cat-cow', detail: '2 hiệp x 8-10 lần' },
      { name: 'Glute bridge', detail: '3 hiệp x 10-12 lần' },
      { name: 'Band pull-apart hoặc row nhẹ', detail: '3 hiệp x 12 lần' },
      { name: 'Giãn cơ hông và lưng', detail: '5 phút cuối buổi' }
    ];
  }

  if (normalizedGoal.includes('giam mo') || normalizedGoal.includes('giam can')) {
    return [
      { name: 'Đi bộ dốc trên máy', detail: '8 phút khởi động' },
      { name: 'Goblet squat', detail: '3 hiệp x 12 lần' },
      { name: 'Dumbbell row', detail: '3 hiệp x 12 lần mỗi bên' },
      { name: 'Kettlebell deadlift', detail: '3 hiệp x 12 lần' },
      { name: 'Mountain climber', detail: '3 hiệp x 30 giây' }
    ];
  }

  return [
    { name: 'Squat hoặc leg press', detail: '3 hiệp x 10-12 lần' },
    { name: 'Push press nhẹ', detail: '3 hiệp x 10 lần' },
    { name: 'Lat pulldown', detail: '3 hiệp x 10-12 lần' },
    { name: 'Hip hinge', detail: '3 hiệp x 10 lần' },
    { name: 'Side plank', detail: '3 hiệp x 25-35 giây mỗi bên' }
  ];
};

const mealLabelsByCount: Record<number, string[]> = {
  2: ['Bữa chính 1', 'Bữa chính 2'],
  3: ['Bữa sáng', 'Bữa trưa', 'Bữa tối'],
  4: ['Bữa sáng', 'Bữa trưa', 'Bữa phụ', 'Bữa tối'],
  5: ['Bữa sáng', 'Bữa phụ sáng', 'Bữa trưa', 'Bữa phụ chiều', 'Bữa tối']
};

const mealTemplateIndexesByCount: Record<number, number[]> = {
  2: [1, 4],
  3: [0, 2, 4],
  4: [0, 2, 3, 4],
  5: [0, 1, 2, 3, 4]
};

const mealTemplatesByDiet = {
  vegetarian: [
    { dish: 'Yến mạch sữa hạt + chuối', detail: 'Dễ tiêu, nhiều chất xơ' },
    { dish: 'Sữa chua đậu nành + hạt chia', detail: 'Bữa phụ nhẹ' },
    { dish: 'Cơm gạo lứt + đậu phụ sốt nấm', detail: 'Protein thực vật' },
    { dish: 'Sinh tố bơ đậu phộng', detail: 'Bổ sung năng lượng' },
    { dish: 'Salad quinoa + trứng/đậu gà', detail: 'No lâu, cân bằng đạm' }
  ],
  keto: [
    { dish: 'Trứng ốp la + bơ + rau xanh', detail: 'Ít carb, giàu chất béo tốt' },
    { dish: 'Phô mai tươi + hạnh nhân', detail: 'Bữa phụ ít đường' },
    { dish: 'Ức gà áp chảo + salad dầu olive', detail: 'Protein cao, carb thấp' },
    { dish: 'Sữa chua Hy Lạp không đường', detail: 'Giữ no giữa buổi' },
    { dish: 'Cá hồi + bông cải xanh', detail: 'Omega-3 và rau xanh' }
  ],
  highProtein: [
    { dish: 'Trứng cuộn + bánh mì đen', detail: 'Đạm cao cho buổi sáng' },
    { dish: 'Sữa chua Hy Lạp + whey/chuối', detail: 'Bữa phụ phục hồi' },
    { dish: 'Cơm gạo lứt + ức gà + rau luộc', detail: 'Bữa chính giàu protein' },
    { dish: 'Phô mai tươi + hạnh nhân', detail: 'Đạm chậm, no lâu' },
    { dish: 'Cá ngừ/cá hồi + khoai lang + salad', detail: 'Cân bằng đạm và carb' }
  ],
  clean: [
    { dish: 'Yến mạch qua đêm + trái cây', detail: 'Nguyên liệu sạch, ít chế biến' },
    { dish: 'Táo + bơ đậu phộng', detail: 'Bữa phụ gọn' },
    { dish: 'Cơm gạo lứt + cá áp chảo + rau', detail: 'Cân bằng năng lượng' },
    { dish: 'Sữa chua Hy Lạp + granola', detail: 'Giữ no nhẹ nhàng' },
    { dish: 'Ức gà + khoai lang + salad', detail: 'Dễ bám plan' }
  ],
  normal: [
    { dish: 'Yến mạch chuối + trứng luộc', detail: 'Carb chậm và protein vừa đủ' },
    { dish: 'Sữa chua Hy Lạp + hạnh nhân', detail: 'Bữa phụ no lâu' },
    { dish: 'Cơm gạo lứt + ức gà + rau xanh', detail: 'Bữa chính cân bằng' },
    { dish: 'Chuối + sữa ít đường', detail: 'Nạp nhẹ trước/sau tập' },
    { dish: 'Cá hồi/cá trắng + khoai lang + salad', detail: 'Tối nhẹ, đủ đạm' }
  ]
};

const buildTodayMeals = (dietPreference: string, mealsPerDay: string) => {
  const normalizedDiet = normalizePlainText(dietPreference);
  const mealCount = Math.max(2, Math.min(5, Number(mealsPerDay) || 3));
  const labels = mealLabelsByCount[mealCount] || mealLabelsByCount[3];
  const indexes = mealTemplateIndexesByCount[mealCount] || mealTemplateIndexesByCount[3];
  const template = normalizedDiet.includes('chay')
    ? mealTemplatesByDiet.vegetarian
    : normalizedDiet.includes('keto') || normalizedDiet.includes('low carb')
      ? mealTemplatesByDiet.keto
      : normalizedDiet.includes('dam') || normalizedDiet.includes('protein')
        ? mealTemplatesByDiet.highProtein
        : normalizedDiet.includes('eat clean')
          ? mealTemplatesByDiet.clean
          : mealTemplatesByDiet.normal;

  return labels.map((label, index) => ({
    label,
    ...template[indexes[index]]
  }));
};

const estimateTargetCalories = ({
  gender,
  age,
  height,
  weight,
  goal,
  frequency
}: {
  gender: string;
  age: string;
  height: string;
  weight: string;
  goal: string;
  frequency: string;
}) => {
  const parsedAge = Number(age) || 28;
  const parsedHeight = Number(height) || 170;
  const parsedWeight = Number(weight) || 70;
  const genderOffset = gender === 'Nam' ? 5 : gender === 'Nữ' ? -161 : -78;
  const bmr = 10 * parsedWeight + 6.25 * parsedHeight - 5 * parsedAge + genderOffset;
  const weeklyWorkouts = workoutFrequencyToWeeklyWorkouts(frequency);
  const activityMultiplier = 1.2 + Math.min(Math.max(weeklyWorkouts, 0), 6) * 0.05;
  const normalizedGoal = normalizePlainText(goal);
  const goalAdjustment = normalizedGoal.includes('giam')
    ? -350
    : normalizedGoal.includes('tang co')
      ? 250
      : normalizedGoal.includes('suc manh')
        ? 150
        : normalizedGoal.includes('phuc hoi')
          ? -100
          : 0;
  return Math.max(1200, Math.round((bmr * activityMultiplier + goalAdjustment) / 50) * 50);
};

export default function SurveyForm({ onComplete, isOpen, onClose }: SurveyFormProps) {
  const { user, refreshProfile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [isPreloading, setIsPreloading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [submitError, setSubmitError] = useState('');
  // Các giá trị tầng 2 dùng mặc định để tạo kế hoạch đầu tiên nhanh hơn.
  const [formData, setFormData] = useState({
    // Tầng 1: thông tin tối thiểu cho kế hoạch đầu tiên
    full_name: user?.user_metadata?.full_name || '',
    email: user?.email || '',
    phone: '',
    gender: 'Nam',
    birthday: '',
    age: '28',
    job: '',

    // Giá trị nâng cao vẫn giữ mặc định để không làm thiếu payload backend
    height: '170',
    weight: '68',
    target_weight: '',
    body_fat: '',
    neck: '',
    chest: '',
    waist: '',
    hips: '',
    // BMI sẽ được tính tự động, không cần trong state input
    activity_level: DEFAULT_WORKOUT_FREQUENCY,
    fitness_goal: 'Giảm mỡ',
    workout_time: 'Sáng sớm',
    workout_duration: DEFAULT_WORKOUT_DURATION,
    experience_level: 'Người mới',
    work_nature: 'Ngồi văn phòng nhiều',
    workout_location: 'Phòng Gym',
    equipment_available: 'Đầy đủ tạ & máy móc',

    // Tầng 2: có thể bổ sung sau trong hồ sơ
    diet_preference: 'Bình thường',
    daily_water_goal: '2',
    meals_per_day: '3',
    cooking_ability: 'Tự nấu 100%',
    budget_level: 'Trung bình',
    current_diet: '',
    allergies: '',
    health_condition: '',
    injuries: 'Không',
    medications: 'Không sử dụng thuốc',
    medications_extra: '',
    smoke_drink: 'Không',

    // Tầng 2: có thể hỏi sau
    sleep_hours: '7',
    sleep_quality: 'Tốt',
    mood: 'Bình thường',
    stress_level: 'Thấp - Cuộc sống thoải mái',
    expectations: '',
    motivation: DEFAULT_MOTIVATION
  });

  React.useEffect(() => {
    async function loadCurrentData() {
      if (!user || !isOpen) return;
      setIsPreloading(true);
      try {
        const [p, b, l, h] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).single(),
          supabase.from('body_metrics').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('lifestyle_settings').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('health_conditions').select('*').eq('user_id', user.id).maybeSingle()
        ]);
        // ... (data update logic remains same)
        if (p.data) {
            const rawMeds = h.data?.medications || '';
            const standardMedOptions = [
              'Không sử dụng thuốc', 'Thuốc huyết áp', 'Thuốc tiểu đường / kiểm soát đường huyết',
              'Thuốc tim mạch', 'Thuốc hen suyễn / hô hấp', 'Thuốc giảm đau / kháng viêm',
              'Thuốc xương khớp', 'Thuốc dạ dày', 'Thuốc dị ứng', 'Thuốc nội tiết / hormone',
              'Thuốc an thần / hỗ trợ giấc ngủ', 'Vitamin / thực phẩm bổ sung', 'Khác'
            ];
            
            let medType = 'Không sử dụng thuốc';
            let medExtra = '';
            
            if (rawMeds && rawMeds !== 'Không sử dụng thuốc') {
              const matchedOpt = standardMedOptions.find(opt => rawMeds.startsWith(opt) && opt !== 'Không sử dụng thuốc');
              if (matchedOpt) {
                medType = matchedOpt;
                medExtra = rawMeds.substring(matchedOpt.length).replace(/^ - /, '').trim();
              } else {
                medType = 'Khác';
                medExtra = rawMeds;
              }
            }

          setFormData(prev => ({
            ...prev,
            full_name: p.data.full_name || prev.full_name,
            phone: p.data.phone || '',
            gender: normalizeGender(p.data.gender),
            birthday: p.data.birthday || '',
            age: birthdayToAge(p.data.birthday) || prev.age,
            job: p.data.job || '',
            height: b.data?.height?.toString() || prev.height,
            weight: b.data?.weight?.toString() || prev.weight,
            target_weight: b.data?.target_weight?.toString() || prev.target_weight,
            body_fat: b.data?.body_fat?.toString() || prev.body_fat,
            neck: (b.data?.neck && b.data.neck !== 0) ? b.data.neck.toString() : '',
            chest: (b.data?.chest && b.data.chest !== 0) ? b.data.chest.toString() : '',
            waist: (b.data?.waist && b.data.waist !== 0) ? b.data.waist.toString() : '',
            hips: (b.data?.hips && b.data.hips !== 0) ? b.data.hips.toString() : '',
            activity_level: normalizeWorkoutFrequency(
              l.data?.activity_level || weeklyWorkoutsToFrequency(l.data?.weekly_workouts) || prev.activity_level
            ),
            fitness_goal: l.data?.fitness_goal || prev.fitness_goal,
            diet_preference: l.data?.diet_preference === 'Ăn chay (Có thể ăn chay)' ? 'Ăn chay' : (l.data?.diet_preference || prev.diet_preference),
            cooking_ability: l.data?.cooking_ability === 'Tự nấu tối, ăn ngoài trưa' ? 'Ăn trưa ở ngoài, tối tự nấu' : (l.data?.cooking_ability || prev.cooking_ability),
            budget_level: l.data?.budget_level === 'Sinh viên (Rẻ, Tiết kiệm)' ? 'Tiết kiệm' : (l.data?.budget_level === 'Trung bình (Cơ bản)' ? 'Trung bình' : (l.data?.budget_level === 'Cao cấp (Đủ loại thực phẩm)' ? 'Thoải mái' : (l.data?.budget_level || prev.budget_level))),
            current_diet: l.data?.current_diet || '',
            workout_location: l.data?.workout_location === 'Phòng Gym chuyên nghiệp'
              ? 'Phòng Gym'
              : (l.data?.workout_location || prev.workout_location),
            workout_time: l.data?.workout_time || prev.workout_time,
            workout_duration: normalizeWorkoutDurationTag(
              l.data?.workout_duration?.toString() || prev.workout_duration
            ),
            equipment_available: ({
              'Đầy đủ tạ & máy móc (Gym)': 'Đầy đủ tạ & máy móc',
              'Tạ đơn (Dumbbells) & Thảm': 'Tạ đơn & Thảm',
              'Dây kháng lực (Resistance Bands)': 'Dây kháng lực',
              'Không dụng cụ (Calisthenics)': 'Không dụng cụ',
            } as Record<string, string>)[l.data?.equipment_available || '']
              || l.data?.equipment_available
              || prev.equipment_available,
            experience_level: l.data?.experience_level || prev.experience_level,
            meals_per_day: l.data?.meals_per_day?.toString() || prev.meals_per_day,
            daily_water_goal: l.data?.daily_water_goal?.toString() || prev.daily_water_goal,
            health_condition: h.data?.health_condition || '',
            allergies: h.data?.medical_history || prev.allergies,
            injuries: h.data?.injuries || 'Không',
            medications: medType,
            medications_extra: medExtra,
            smoke_drink: h.data?.smoke_drink || 'Không',
            stress_level: h.data?.stress_level || 'Thấp - Cuộc sống thoải mái',
            sleep_hours: h.data?.sleep_hours?.toString() || prev.sleep_hours,
            expectations: l.data?.expectations || '',
            motivation: normalizeMotivation(l.data?.motivation),
          }));
        }
      } catch (e) {
        console.error('Error preload:', e);
      } finally {
        setIsPreloading(false);
      }
    }
    loadCurrentData();
  }, [user, isOpen]);

  React.useEffect(() => {
    if (submitError) toast.error(submitError);
  }, [submitError, toast]);

  React.useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      setIsSubmitted(false);
    }
  }, [isOpen]);

  const modalMode = Boolean(isOpen);
  const progressPercent = (currentStep / TOTAL_STEPS) * 100;
  const surveyFooter = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="order-2 hidden min-w-0 flex-1 sm:order-1 sm:block sm:pr-4">
        <p className="text-sm font-bold leading-6 text-text-secondary">
          Bạn có thể bổ sung thông tin nâng cao sau khi xem kế hoạch đầu tiên. Bước này chỉ hỏi dữ liệu cần thiết.
        </p>
      </div>
      <div className="order-1 flex w-full shrink-0 flex-col-reverse gap-2 sm:order-2 sm:ml-auto sm:w-auto sm:flex-row sm:gap-3">
        {currentStep > 1 && (
          <button
            type="button"
            onClick={goPrev}
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border-primary px-5 py-2.5 text-sm font-bold text-accent transition-all hover:border-accent/45 hover:bg-bg-secondary/80 disabled:opacity-50 sm:w-auto"
          >
            <ChevronLeft className="w-4 h-4" />
            Quay lại
          </button>
        )}
        {currentStep < TOTAL_STEPS ? (
          <button
            key="survey-next-step-inline"
            type="button"
            onClick={goNext}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
          >
            Tiếp theo
            <ChevronRight className="w-4 h-4 text-text-inverse" />
          </button>
        ) : (
          <button
            key="survey-submit-inline"
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang tạo kế hoạch...
              </>
            ) : (
              <>
                {isOpen ? "CẬP NHẬT HỒ SƠ" : "TẠO KẾ HOẠCH ĐẦU TIÊN"}
                <Zap className="w-4 h-4 text-text-inverse" />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );

  const getFirstInvalidStep = (): number | null => {
    if (
      !formData.gender ||
      !hasPositiveNumber(formData.age) ||
      !hasPositiveNumber(formData.height) ||
      !hasPositiveNumber(formData.weight)
    ) {
      return 1;
    }
    if (!formData.fitness_goal) {
      return 2;
    }
    if (!formData.activity_level) {
      return 3;
    }
    if (
      !formData.experience_level ||
      !formData.workout_location ||
      !formData.workout_duration
    ) {
      return 4;
    }
    return null;
  };

  function goNext() {
    setIsSubmitted(true);
    if (currentStep === 1) {
      if (
        !formData.gender ||
        !hasPositiveNumber(formData.age) ||
        !hasPositiveNumber(formData.height) ||
        !hasPositiveNumber(formData.weight)
      ) {
        return;
      }
    }
    if (currentStep === 2) {
      if (!formData.fitness_goal) {
        return;
      }
    }
    if (currentStep === 3) {
      if (!formData.activity_level) {
        return;
      }
    }
    if (currentStep === 4) {
      if (
        !formData.experience_level ||
        !formData.workout_location ||
        !formData.workout_duration
      ) {
        return;
      }
    }
    setIsSubmitted(false);
    if (currentStep < TOTAL_STEPS) setCurrentStep(s => s + 1);
  }

  function goPrev() {
    setIsSubmitted(false);
    setSubmitError('');
    setCurrentStep(s => Math.max(1, s - 1));
  }

  if (isPreloading) {
    return (
      <div className="fixed inset-0 z-[70]">
        <LoadingScreen />
      </div>
    );
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'workout_location') {
        next.equipment_available = value === 'Phòng Gym' ? 'Đầy đủ tạ & máy móc' : 'Không dụng cụ';
      }
      return next;
    });
  };

  const handleNumberChange = (name: 'age' | 'height' | 'weight', value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    if (!user) {
      setSubmitError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    if (currentStep < TOTAL_STEPS) {
      goNext();
      return;
    }

    setIsSubmitted(true);
    const invalidStep = getFirstInvalidStep();
    if (invalidStep !== null) {
      setCurrentStep(invalidStep);
      setSubmitError(`Vui lòng điền đầy đủ thông tin bắt buộc ở bước ${invalidStep}.`);
      return;
    }
    setLoading(true);

    try {
      const resolvedBirthday = formData.birthday || ageToBirthday(formData.age);
      const resolvedFullName = formData.full_name.trim() || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Thành viên';
      const resolvedTargetWeight = parseFloat(formData.target_weight) || parseFloat(formData.weight) || 0;
      const resolvedEquipment = formData.workout_location === 'Phòng Gym' ? 'Đầy đủ tạ & máy móc' : 'Không dụng cụ';
      const normalizedActivityLevel = normalizeWorkoutFrequency(formData.activity_level);
      const weeklyWorkouts = workoutFrequencyToWeeklyWorkouts(normalizedActivityLevel);
      const ageYears = Number(formData.age) || 28;
      const heightCm = Number(formData.height) || 170;
      const weightKg = Number(formData.weight) || 68;
      const mealsPerDay = parseInt(formData.meals_per_day, 10) || 3;
      const dailyWaterGoalLiters = parseFloat(formData.daily_water_goal) || 2.0;
      const estimatedTargetCalories = estimateTargetCalories({
        gender: formData.gender,
        age: formData.age,
        height: formData.height,
        weight: formData.weight,
        goal: formData.fitness_goal,
        frequency: normalizedActivityLevel
      });

      // 1. Cập nhật hoặc Tạo mới Profile (Thông tin cơ bản)
      const profilePromise = supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: resolvedFullName,
          email: formData.email,
          phone: formData.phone,
          gender: formData.gender,
          birthday: resolvedBirthday,
          job: formData.job,
          updated_at: new Date().toISOString()
        });

      // 2. Lưu số đo cơ thể đầy đủ
      const bodyMetricsPromise = supabase
        .from('body_metrics')
        .insert({
          user_id: user.id,
          height: parseFloat(formData.height) || 0,
          weight: parseFloat(formData.weight) || 0,
          target_weight: resolvedTargetWeight,
          body_fat: formData.body_fat ? parseFloat(formData.body_fat) : null,
          neck: formData.neck ? parseFloat(formData.neck) : null,
          chest: formData.chest ? parseFloat(formData.chest) : null,
          waist: formData.waist ? parseFloat(formData.waist) : null,
          hips: formData.hips ? parseFloat(formData.hips) : null
        });

      // 3. Cập nhật Lối sống & Thói quen toàn diện
      const lifestylePromise = supabase
        .from('lifestyle_settings')
        .upsert({
          user_id: user.id,
          activity_level: normalizedActivityLevel,
          weekly_workouts: weeklyWorkouts,
          fitness_goal: formData.fitness_goal,
          diet_preference: formData.diet_preference,
          cooking_ability: formData.cooking_ability,
          budget_level: formData.budget_level,
          current_diet: formData.current_diet,
          workout_location: formData.workout_location,
          workout_time: formData.workout_time,
          workout_duration: parseInt(normalizeWorkoutDurationTag(formData.workout_duration), 10),
          equipment_available: resolvedEquipment,
          experience_level: formData.experience_level,
          meals_per_day: mealsPerDay,
          daily_water_goal: dailyWaterGoalLiters,
          target_calories: estimatedTargetCalories,
          motivation: formData.motivation,
          expectations: formData.expectations,
          updated_at: new Date().toISOString()
        });

      const finalMedications = formData.medications === 'Không sử dụng thuốc'
        ? 'Không sử dụng thuốc'
        : formData.medications_extra.trim() 
          ? `${formData.medications} - ${formData.medications_extra.trim()}`
          : formData.medications;

      // 4. Cập nhật Tình trạng Y tế chi tiết
      const healthPromise = supabase
        .from('health_conditions')
        .upsert({
          user_id: user.id,
          health_condition: formData.health_condition,
          medical_history: formData.allergies,
          injuries: formData.injuries,
          medications: finalMedications,
          smoke_drink: formData.smoke_drink,
          stress_level: formData.stress_level,
          sleep_quality: formData.sleep_quality,
          sleep_hours: parseFloat(formData.sleep_hours) || 7,
          updated_at: new Date().toISOString()
        });


      // 1. ĐẢM BẢO Profile tồn tại trước (Sequential to avoid FK errors)
      const { error: pError } = await profilePromise;
      if (pError) throw pError;
      
      // 2. Chạy các lệnh còn lại (Concurrent ok now)
      const results = await Promise.all([
        bodyMetricsPromise,
        lifestylePromise,
        healthPromise
      ]);

      // In chi tiết lỗi (nếu có) ra console để debug
      results.forEach((res, index) => {
        if (res.error) {
          console.error(`Error in promise ${index}:`, res.error);
        }
      });

      // Kiểm tra lỗi từ bất kỳ bảng nào
      const firstError = results.find(res => res.error)?.error;
      if (firstError) {
        throw firstError;
      }

      const durationMinutes = Number(normalizeWorkoutDurationTag(formData.workout_duration)) || Number(DEFAULT_WORKOUT_DURATION) || 30;
      const selectedMeals = MEAL_OPTIONS.find(option => option.value === formData.meals_per_day);
      const selectedActivity = ACTIVITY_LEVEL_OPTIONS.find(option => option.value === normalizedActivityLevel);
      const selectedFrequency = WORKOUT_FREQUENCY_OPTIONS.find(
        option => option.value === normalizedActivityLevel
      );
      const todayExercises = buildTodayExercises({
        experience: formData.experience_level,
        location: formData.workout_location,
        goal: formData.fitness_goal
      });
      const todayMeals = buildTodayMeals(formData.diet_preference, formData.meals_per_day);
      const summary: SurveyPlanSummary = {
        goal: formData.fitness_goal,
        experience: formData.experience_level,
        frequency: selectedActivity
          ? `${selectedActivity.label} · ${selectedFrequency?.label || selectedActivity.value}`
          : selectedFrequency?.label || `${workoutFrequencyToWeeklyWorkouts(normalizedActivityLevel)} buổi / tuần`,
        duration: `${durationMinutes}-${durationMinutes + 10} phút / buổi`,
        targetCalories: estimatedTargetCalories,
        gender: formData.gender,
        age: ageYears,
        heightCm,
        weightKg,
        weeklyWorkouts,
        mealsPerDay,
        dailyWaterGoalLiters,
        location: formData.workout_location === 'Tập tại nhà (Home Workout)' ? 'Tại nhà' : 'Phòng gym',
        todayWorkout: formData.experience_level === 'Người mới' ? 'Full Body Beginner' : 'Full Body Strength',
        todayDuration: `${durationMinutes} phút`,
        meals: selectedMeals?.label || `${formData.meals_per_day} bữa/ngày`,
        todayExercises,
        todayMeals
      };

      await refreshProfile();
      await onComplete(summary);
    } catch (err: any) {
      console.error('Error saving multi-table profile:', err);
      const message = err?.message || err?.details || 'Thông tin không hợp lệ';
      setSubmitError(`Lỗi hệ thống: ${message}. Vui lòng thử lại hoặc mở Console (F12) để xem chi tiết.`);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className={modalMode ? 'fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-5' : 'min-h-[100dvh] w-full bg-bg-primary px-3 py-3 sm:px-5 sm:py-5'}>
      {/* Backdrop */}
      {modalMode ? <div className="themed-modal-backdrop absolute inset-0 backdrop-blur-md" /> : null}

      {/* Modal Content */}
      <div className={`relative flex w-full flex-col overflow-hidden bg-transparent ${
        modalMode
          ? 'max-h-[100dvh] max-w-3xl rounded-none animate-in zoom-in duration-300 sm:max-h-[92dvh]'
          : 'mx-auto min-h-[calc(100dvh-1.5rem)] max-w-3xl sm:min-h-[calc(100dvh-2.5rem)]'
      }`}>

        {/* Close Button (Only for Profile Editing) */}
        {isOpen && onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-[70] rounded-xl border border-border-primary bg-bg-primary/80 p-2 text-text-tertiary transition-colors hover:text-text-primary"
          >
            <X className="w-6 h-6" />
          </button>
        )}

        <aside className="hidden">
          <div className="themed-subtle-panel rounded-[24px] border p-4 shadow-[0_18px_42px_rgba(0,0,0,0.18)] sm:p-5">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Trợ lý cá nhân" className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" />
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-accent">Trợ lý cá nhân</p>
                <h2 className="mt-1 text-lg font-black leading-tight text-text-primary sm:text-xl">
                  {isOpen ? "Cập nhật hồ sơ" : "Tạo kế hoạch đầu tiên"}
                </h2>
              </div>
            </div>

            <p className="mt-4 text-sm font-semibold leading-6 text-text-secondary">
              {isOpen
                ? "Cập nhật dữ liệu cốt lõi để kế hoạch tập luyện và thực đơn sát hơn."
                : "Trả lời nhanh vài thông tin chính. Trợ lý cá nhân sẽ chuẩn bị khung bắt đầu phù hợp với bạn."}
            </p>

            <div className="mt-5 grid grid-cols-5 gap-2 xl:hidden">
              {STEP_NAV_LABELS.map((_, idx) => {
                const n = idx + 1;
                const active = n === currentStep;
                const done = currentStep > n;
                return (
                  <button
                    key={`mobile-step-${n}`}
                    type="button"
                    onClick={() => setCurrentStep(n)}
                    className={`rounded-2xl border px-2 py-2 text-center transition-colors ${
                      active
                        ? 'border-accent/45 bg-accent/12 text-accent'
                        : done
                          ? 'border-border-primary bg-bg-primary/70 text-text-primary'
                          : 'border-border-primary/60 bg-bg-primary/35 text-text-tertiary'
                    }`}
                  >
                    <span className="block text-[10px] font-black uppercase tracking-[0.14em]">Bước {n}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Tiến độ</p>
                <p className="text-xs font-black text-accent">{Math.round(progressPercent)}%</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg-primary/70">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 hidden space-y-2.5 xl:block">
            {STEP_NAV_LABELS.map((label, idx) => {
              const n = idx + 1;
              const active = n === currentStep;
              const done = currentStep > n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCurrentStep(n)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? 'border-accent/45 bg-accent/10 text-accent'
                      : done
                        ? 'border-border-primary bg-bg-primary/70 text-text-primary'
                        : 'border-transparent bg-transparent text-text-secondary hover:border-border-primary hover:bg-bg-primary/50'
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-black ${
                    active || done ? 'bg-accent text-text-inverse' : 'bg-bg-secondary text-text-tertiary'
                  }`}>
                    {n}
                  </span>
                  <span>
                    <span className="block text-sm font-black text-text-primary">{label}</span>
                    <span className="mt-0.5 block text-xs font-semibold text-text-tertiary">
                      {active ? 'Đang nhập' : done ? 'Đã qua' : 'Sắp tới'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-border-primary bg-bg-primary/55 p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-accent">Nhanh hơn</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
              Những thông tin nâng cao như ngân sách, lịch sinh hoạt, động lực có thể bổ sung sau.
            </p>
          </div>
        </aside>

        <div className={`flex min-h-0 flex-1 flex-col bg-bg-primary ${modalMode ? 'max-h-[100dvh] sm:max-h-[92dvh]' : ''}`}>
          <div className="hidden">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <img src="/logo.png" alt="Fitly" className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-accent">Khảo sát Fitly</p>
                    <h2 className="mt-1 text-xl font-black leading-tight text-text-primary sm:text-2xl">
                      {isOpen ? "Cập nhật hồ sơ" : "Tạo kế hoạch đầu tiên"}
                    </h2>
                  </div>
                </div>
                <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-text-secondary sm:text-base sm:leading-7">
                  {isOpen
                    ? "Cập nhật dữ liệu cốt lõi để kế hoạch tập luyện và thực đơn sát hơn."
                    : "Trả lời nhanh các thông tin quan trọng. Fitly sẽ tạo khởi đầu phù hợp và bạn có thể bổ sung chi tiết sau."}
                </p>
              </div>
              <div className="shrink-0 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-left md:min-w-36 md:text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-accent">Tiến độ</p>
                <p className="mt-1 text-2xl font-black text-text-primary">{Math.round(progressPercent)}%</p>
              </div>
            </div>

            <div className="mt-5 h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
              {STEP_NAV_LABELS.map((label, idx) => {
                const n = idx + 1;
                const active = n === currentStep;
                const done = currentStep > n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCurrentStep(n)}
                    className={`flex min-h-[56px] items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                      active
                        ? 'border-accent/45 bg-accent/10 text-accent'
                        : done
                          ? 'border-border-primary bg-bg-primary/70 text-text-primary'
                          : 'border-border-primary/70 bg-bg-primary/35 text-text-secondary hover:border-accent/30 hover:bg-bg-primary/70'
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-black ${
                      active || done ? 'bg-accent text-text-inverse' : 'bg-bg-secondary text-text-tertiary'
                    }`}>
                      {n}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-text-primary">{label}</span>
                      <span className="mt-0.5 block text-xs font-semibold text-text-tertiary">
                        {active ? 'Đang thực hiện' : done ? 'Đã qua' : 'Sắp tới'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hidden">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-black text-text-primary">
                  Bước {currentStep}/{TOTAL_STEPS}
                </p>
                <p className="mt-1 text-sm font-semibold text-text-secondary">{STEP_NAV_LABELS[currentStep - 1]}</p>
              </div>
              <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-black text-accent">
                {Math.round(progressPercent)}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

        {/* Form Body */}
        <form id="survey-form" onSubmit={handleSubmit} className="custom-scrollbar mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto px-0 py-4 sm:px-0 md:px-0 md:py-6">
          <div className="my-auto space-y-6 md:space-y-8">
            <div className="hidden">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Fitly" className="h-10 w-10 shrink-0 sm:h-11 sm:w-11" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-accent">Khảo sát Fitly</p>
                      <h2 className="mt-1 text-xl font-black leading-tight text-text-primary sm:text-2xl">
                        {isOpen ? "Cập nhật hồ sơ" : "Tạo kế hoạch đầu tiên"}
                      </h2>
                    </div>
                  </div>
                  <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-text-secondary">
                    {isOpen
                      ? "Cập nhật dữ liệu cốt lõi để kế hoạch tập luyện và thực đơn sát hơn."
                      : "Trả lời nhanh các thông tin quan trọng. Fitly sẽ tạo khởi đầu phù hợp và bạn có thể bổ sung chi tiết sau."}
                  </p>
                </div>
                <div className="shrink-0 text-left md:text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-accent">Tiến độ</p>
                  <p className="mt-1 text-2xl font-black text-text-primary">{Math.round(progressPercent)}%</p>
                </div>
              </div>

              <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                {STEP_NAV_LABELS.map((label, idx) => {
                  const n = idx + 1;
                  const active = n === currentStep;
                  const done = currentStep > n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCurrentStep(n)}
                      className={`flex min-h-[54px] items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-accent/45 bg-accent/10 text-accent'
                          : done
                            ? 'border-border-primary bg-bg-secondary/80 text-text-primary'
                            : 'border-border-primary/70 bg-transparent text-text-secondary hover:border-accent/30 hover:bg-bg-secondary/60'
                      }`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-black ${
                        active || done ? 'bg-accent text-text-inverse' : 'bg-bg-secondary text-text-tertiary'
                      }`}>
                        {n}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-text-primary">{label}</span>
                        <span className="mt-0.5 block text-xs font-semibold text-text-tertiary">
                          {active ? 'Đang thực hiện' : done ? 'Đã qua' : 'Sắp tới'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

          {currentStep === 1 && (
          <section className="rounded-lg border border-border-primary bg-bg-primary px-5 py-7 text-text-primary shadow-[0_22px_60px_rgba(0,0,0,0.38)] sm:px-9 sm:py-9">
            <div className="flex items-center justify-between gap-4 text-xs font-semibold">
              <p className="text-accent">Bước 1: Chỉ số cơ thể</p>
              <p className="text-text-secondary">1 / {TOTAL_STEPS}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-9">
              <h3 className="text-2xl font-black leading-tight text-text-primary sm:text-3xl">
                Cho chúng tôi biết về bạn
              </h3>
              <p className="mt-3 text-sm font-medium leading-6 text-text-secondary">
                Những thông tin này giúp cá nhân hóa mục tiêu và gợi ý phù hợp hơn.
              </p>
            </div>

            <div className="mt-8 space-y-5">
              <div className="space-y-3">
                <label className="block text-xs font-black text-text-primary">Giới tính</label>
                <GenderChoiceList name="gender" value={formData.gender} options={GENDER_OPTIONS} onChange={handleInputChange} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <CompactMetricInput
                  name="age"
                  label="Tuổi"
                  value={formData.age}
                  placeholder="VD: 25"
                  min={13}
                  max={80}
                  icon={Calendar}
                  onChange={handleInputChange}
                  invalid={isSubmitted && !hasPositiveNumber(formData.age)}
                  error="Vui lòng nhập tuổi"
                />
                <CompactMetricInput
                  name="height"
                  label="Chiều cao (cm)"
                  value={formData.height}
                  placeholder="VD: 170"
                  min={130}
                  max={220}
                  icon={MoveVertical}
                  onChange={handleInputChange}
                  invalid={isSubmitted && !hasPositiveNumber(formData.height)}
                  error="Vui lòng nhập chiều cao"
                />
                <CompactMetricInput
                  name="weight"
                  label="Cân nặng (kg)"
                  value={formData.weight}
                  placeholder="VD: 65"
                  min={35}
                  max={180}
                  icon={Weight}
                  onChange={handleInputChange}
                  invalid={isSubmitted && !hasPositiveNumber(formData.weight)}
                  error="Vui lòng nhập cân nặng"
                />
              </div>
            </div>

            <div className="mt-5 border-t border-border-primary pt-5 sm:mt-6 sm:flex sm:justify-end">
              <button
                type="button"
                onClick={goNext}
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-7 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
              >
                Tiếp tục
                <ChevronRight className="h-4 w-4 text-text-inverse" strokeWidth={3} />
              </button>
            </div>
          </section>
          )}

          {currentStep === 2 && (
          <section className="rounded-lg border border-border-primary bg-bg-primary px-5 py-7 text-text-primary shadow-[0_22px_60px_rgba(0,0,0,0.38)] sm:px-9 sm:py-9">
            <div className="flex items-center justify-between gap-4 text-xs font-semibold">
              <p className="text-accent">Bước 2: Mục tiêu</p>
              <p className="text-text-secondary">2 / {TOTAL_STEPS}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-9">
              <h3 className="text-2xl font-black leading-tight text-text-primary sm:text-3xl">
                Mục tiêu của bạn là gì?
              </h3>
              <p className="mt-3 text-sm font-medium leading-6 text-text-secondary">
                Chọn một mục tiêu chính để Fitly cá nhân hóa bài tập, dinh dưỡng và nhịp phục hồi.
              </p>
            </div>

            <div className="mt-8">
              <GoalChoiceGrid name="fitness_goal" value={formData.fitness_goal} options={GOAL_OPTIONS} onChange={handleInputChange} />
            </div>

            <div className="mt-3 flex flex-col-reverse gap-3 sm:mt-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={goPrev}
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-primary px-7 text-sm font-black text-accent transition-colors hover:border-accent/45 hover:bg-bg-secondary disabled:opacity-60 sm:w-auto"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={3} />
                Quay lại
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-7 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
              >
                Tiếp tục
                <ChevronRight className="h-4 w-4 text-text-inverse" strokeWidth={3} />
              </button>
            </div>
          </section>
          )}

          {currentStep === 3 && (
          <section className="rounded-lg border border-border-primary bg-bg-primary px-5 py-7 text-text-primary shadow-[0_22px_60px_rgba(0,0,0,0.38)] sm:px-9 sm:py-9">
            <div className="flex items-center justify-between gap-4 text-xs font-semibold">
              <p className="text-accent">Bước 3: Mức độ vận động</p>
              <p className="text-text-secondary">3 / {TOTAL_STEPS}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-9">
              <h3 className="text-2xl font-black leading-tight text-text-primary sm:text-3xl">
                Mức độ vận động của bạn là gì?
              </h3>
              <p className="mt-3 text-sm font-medium leading-6 text-text-secondary">
                Chọn mức gần nhất với nhịp sống của bạn để Fitly xếp lịch vừa sức và dễ duy trì.
              </p>
            </div>

            <div className="mt-8">
              <ActivityChoiceList name="activity_level" value={formData.activity_level} options={ACTIVITY_LEVEL_OPTIONS} onChange={handleInputChange} />
            </div>

            <div className="mt-3 flex flex-col-reverse gap-3 sm:mt-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={goPrev}
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-primary px-7 text-sm font-black text-accent transition-colors hover:border-accent/45 hover:bg-bg-secondary disabled:opacity-60 sm:w-auto"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={3} />
                Quay lại
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-7 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
              >
                Tiếp tục
                <ChevronRight className="h-4 w-4 text-text-inverse" strokeWidth={3} />
              </button>
            </div>
          </section>
          )}

          {currentStep === 4 && (
          <section className="rounded-lg border border-border-primary bg-bg-primary px-5 py-7 text-text-primary shadow-[0_22px_60px_rgba(0,0,0,0.38)] sm:px-9 sm:py-9">
            <div className="flex items-center justify-between gap-4 text-xs font-semibold">
              <p className="text-accent">Bước 4: Thiết lập tập luyện</p>
              <p className="text-text-secondary">4 / {TOTAL_STEPS}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-9">
              <h3 className="text-2xl font-black leading-tight text-text-primary sm:text-3xl">
                Bạn muốn tập như thế nào?
              </h3>
              <p className="mt-3 text-sm font-medium leading-6 text-text-secondary">
                Cho Fitly biết trình độ, nơi tập và thời lượng để chọn bài phù hợp với điều kiện thực tế của bạn.
              </p>
            </div>

            <div className="mt-8 space-y-5">
              <div>
                <ChoiceGrid name="experience_level" value={formData.experience_level} options={EXPERIENCE_OPTIONS} onChange={handleInputChange} columns="md:grid-cols-2" />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <ChoiceGrid name="workout_location" value={formData.workout_location} options={LOCATION_OPTIONS} onChange={handleInputChange} columns="grid-cols-1" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{"Thời lượng mỗi buổi"} <span className="text-red-500">*</span></label>
                  <select name="workout_duration" value={normalizeWorkoutDurationTag(formData.workout_duration)} onChange={handleInputChange} className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary/70 px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent">
                    {WORKOUT_DURATION_TAGS.map((minutes) => (
                      <option key={minutes} value={String(minutes)}>{`${minutes} phút`}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-col-reverse gap-3 sm:mt-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={goPrev}
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-primary px-7 text-sm font-black text-accent transition-colors hover:border-accent/45 hover:bg-bg-secondary disabled:opacity-60 sm:w-auto"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={3} />
                Quay lại
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-7 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60 sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Đang tạo kế hoạch...
                  </>
                ) : (
                  <>
                    {isOpen ? 'CẬP NHẬT HỒ SƠ' : 'TẠO KẾ HOẠCH'}
                    <Zap className="h-4 w-4 text-text-inverse" strokeWidth={3} />
                  </>
                )}
              </button>
            </div>
          </section>
          )}

          <div className="hidden">
            <div className="order-2 min-w-0 flex-1 sm:order-1 sm:pr-4">
              <p className="text-sm font-bold leading-6 text-text-secondary">
                Bạn có thể bổ sung thông tin nâng cao sau khi xem kế hoạch đầu tiên. Bước này chỉ hỏi dữ liệu cần thiết.
              </p>
            </div>
            <div className="order-1 flex w-full shrink-0 flex-col-reverse gap-2 sm:order-2 sm:ml-auto sm:w-auto sm:flex-row sm:gap-3">
              {currentStep > 1 && (
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border-primary px-5 py-2.5 text-sm font-bold text-accent transition-all hover:border-accent/45 hover:bg-bg-secondary/80 disabled:opacity-50 sm:w-auto"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Quay lại
                </button>
              )}
              {currentStep < TOTAL_STEPS ? (
                <button
                  key="survey-next-step-inline"
                  type="button"
                  onClick={goNext}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
                >
                  Tiếp theo
                  <ChevronRight className="w-4 h-4 text-text-inverse" />
                </button>
              ) : (
                <button
                  key="survey-submit-inline"
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Đang tạo kế hoạch...
                    </>
                  ) : (
                    <>
                      {isOpen ? "CẬP NHẬT HỒ SƠ" : "TẠO KẾ HOẠCH ĐẦU TIÊN"}
                      <Zap className="w-4 h-4 text-text-inverse" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          </div>
        </form>

        {/* Footer */}
        <div className="hidden">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="order-2 flex min-w-0 flex-1 items-center sm:order-1 sm:pr-4">
            <p className="text-sm font-black tracking-tight leading-snug">
              <span className="text-text-secondary font-bold">
                {"Bạn có thể bổ sung thông tin nâng cao sau khi xem kế hoạch đầu tiên. "}
              </span>
              <span className="text-text-secondary font-bold">{"Bước này chỉ hỏi dữ liệu cần thiết."}</span>
            </p>
          </div>
          <div className="order-1 flex w-full shrink-0 flex-col-reverse gap-2 sm:order-2 sm:ml-auto sm:w-auto sm:flex-row sm:gap-3">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={goPrev}
                disabled={loading}
                className="w-full sm:w-auto py-2.5 px-5 rounded-xl border border-border-primary text-accent font-bold text-sm hover:border-accent/45 hover:bg-bg-tertiary/70 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
                Quay lại
              </button>
            )}
            {currentStep < TOTAL_STEPS ? (
              <button
                key="survey-next-step"
                type="button"
                onClick={goNext}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
              >
                Tiếp theo
                <ChevronRight className="w-4 h-4 text-text-inverse" />
              </button>
            ) : (
              <button
                key="survey-submit"
                type="submit"
                form="survey-form"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang tạo kế hoạch...
                  </>
                ) : (
                  <>
                    {isOpen ? "CẬP NHẬT HỒ SƠ" : "TẠO KẾ HOẠCH ĐẦU TIÊN"}
                    <Zap className="w-4 h-4 text-text-inverse" />
                  </>
                )}
              </button>
            )}
          </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
