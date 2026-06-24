import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Brain,
  Dumbbell,
  Flame,
  Scale,
  Target,
  TrendingUp,
  Utensils,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';
import { SkeletonBlock, SkeletonSurface } from '../components/PageSkeleton';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const PROGRESS_RANGE_DAYS = 7;
const ESTIMATED_MINUTES_PER_EXERCISE = 8;

type LifestyleRow = {
  weekly_workouts: number | null;
  target_calories: number | null;
  fitness_goal: string | null;
  daily_water_goal: number | null;
};

type HealthRow = {
  sleep_hours: number | null;
};

type ExerciseMeta = {
  name?: string | null;
  target_muscle?: string | null;
  body_part?: string | null;
};

type WorkoutRow = {
  id: string | number;
  log_date: string;
  is_completed: boolean | null;
  exercises?: ExerciseMeta | ExerciseMeta[] | null;
};

type MealLogRow = {
  log_date: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  quantity: number | null;
};

type ProgressLogRow = {
  log_date: string;
  water_intake_ml: number | null;
  sleep_hours: number | null;
  calories_burned: number | null;
};

type BodyMetricRow = {
  weight: number | null;
  created_at: string;
};

type AggregatedDay = {
  dateKey: string;
  completedExercises: number;
  plannedExercises: number;
  calories: number;
  protein: number;
  waterLiters: number;
  sleepHours: number;
  caloriesBurned: number;
  mealEntries: number;
  muscleGroups: Record<string, number>;
};

type ScoreMetric = {
  label: string;
  value: number;
};

type ProgressViewModel = {
  empty: boolean;
  rangeDays: number;
  filterLabel: string;
  heroTitle: string;
  heroBody: string;
  summary: {
    workouts: { completed: number; target: number; delta: number | null };
    nutrition: { completed: number; target: number; loggedDays: number; delta: number | null };
    protein: { average: number; target: number; status: string };
    weight: { latest: number | null; previous: number | null; delta: number | null; status: string };
    streakDays: number;
  };
  coach: {
    title: string;
    body: string;
    actionLabel: string;
    actionHref: string;
  };
  weight: {
    latest: number | null;
    baseline: number | null;
    change: number | null;
    sampleCount: number;
    status: string;
    helper: string;
    chart: Array<{ dateKey: string; label: string; weight: number | null }>;
  };
  score: {
    value: number | null;
    strengths: string[];
    improvements: string[];
    helper: string;
  };
  workout: {
    completedDays: number;
    targetDays: number;
    totalMinutes: number;
    totalCalories: number;
    stripLabel: string;
    strip: Array<{ dateKey: string; label: string; dayNumber: string; completed: boolean; planned: boolean }>;
    chart: Array<{ dateKey: string; label: string; completed: number; planned: number }>;
    muscleGroups: Array<{ label: string; count: number }>;
  };
  nutrition: {
    averageCalories: number;
    targetCalories: number;
    averageProtein: number;
    targetProtein: number;
    daysOnTarget: number;
    loggedDays: number;
    chart: Array<{ dateKey: string; label: string; calories: number; protein: number; inTarget: boolean }>;
  };
  habits: {
    title: string;
    rows: Array<{
      label: string;
      value: string;
      cells: Array<{ dateKey: string; label: string; active: boolean }>;
    }>;
  };
  actions: {
    title: string;
    items: string[];
    primaryLabel: string;
    primaryHref: string;
    secondaryLabel: string;
    secondaryHref: string;
  };
};

type ProgressPageCache = {
  viewModel: ProgressViewModel | null;
};

const progressPageCache = new Map<string, ProgressPageCache>();

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return { year, month, day };
}

function getVietnamDateKey(date = new Date()): string {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getVietnamDateKey(date);
}

function buildDateKeys(endDateKey: string, totalDays: number): string[] {
  const dateKeys: string[] = [];
  for (let index = totalDays - 1; index >= 0; index -= 1) {
    dateKeys.push(addDaysToDateKey(endDateKey, -index));
  }
  return dateKeys;
}

function getWeekdayLabel(dateKey: string): string {
  const day = new Date(`${dateKey}T00:00:00`).getDay();
  return WEEKDAY_LABELS[day] || 'T?';
}

function getDayNumber(dateKey: string): string {
  return dateKey.slice(-2);
}

function getShortDateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${day}/${month}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatWholeNumber(value: number): string {
  return Math.round(Number(value) || 0).toLocaleString('vi-VN');
}

function formatMetric(value: number | null | undefined, digits = 1): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  if (Number.isInteger(numeric)) return numeric.toLocaleString('vi-VN');
  return numeric.toLocaleString('vi-VN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSignedKg(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Chưa đủ dữ liệu';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatMetric(value, 1)} kg`;
}

function getTargetProtein(targetCalories: number): number {
  if (!Number.isFinite(targetCalories) || targetCalories <= 0) return 0;
  return Math.round((targetCalories * 0.3) / 4);
}

function getWorkoutTarget(totalDays: number, weeklyTarget: number): number {
  const normalizedWeeklyTarget = Math.max(0, Math.round(weeklyTarget || 0));
  if (!normalizedWeeklyTarget) return 0;
  const raw = (normalizedWeeklyTarget * totalDays) / 7;
  return Math.max(1, Math.round(raw));
}

function getMealTargetBand(targetCalories: number) {
  if (!Number.isFinite(targetCalories) || targetCalories <= 0) {
    return { min: 0, max: 0 };
  }
  return {
    min: targetCalories * 0.9,
    max: targetCalories * 1.1,
  };
}

function calculateWorkoutStreak(completedDateKeys: string[], endDateKey: string): number {
  const completedSet = new Set(completedDateKeys);
  let streak = 0;
  let cursor = endDateKey;

  if (!completedSet.has(cursor)) {
    cursor = addDaysToDateKey(cursor, -1);
  }

  while (completedSet.has(cursor)) {
    streak += 1;
    cursor = addDaysToDateKey(cursor, -1);
  }

  return streak;
}

function normalizeExerciseMeta(exercises: WorkoutRow['exercises']): ExerciseMeta | null {
  if (!exercises) return null;
  if (Array.isArray(exercises)) return exercises[0] || null;
  return exercises;
}

function toSleepTarget(raw: number | null | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 7;
  return value;
}

function createAggregatedDay(dateKey: string): AggregatedDay {
  return {
    dateKey,
    completedExercises: 0,
    plannedExercises: 0,
    calories: 0,
    protein: 0,
    waterLiters: 0,
    sleepHours: 0,
    caloriesBurned: 0,
    mealEntries: 0,
    muscleGroups: {},
  };
}

function buildScore(metrics: ScoreMetric[]): number | null {
  if (metrics.length === 0) return null;
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.value, 0);
  return Math.round(totalWeight / metrics.length);
}

function buildCoachInsight(input: {
  score: number | null;
  workoutRate: number;
  proteinRate: number;
  sleepRate: number;
  weightStatus: string;
  averageProtein: number;
  targetProtein: number;
  completedDays: number;
  targetDays: number;
  goal: string;
}): ProgressViewModel['coach'] {
  const {
    score,
    workoutRate,
    proteinRate,
    sleepRate,
    weightStatus,
    averageProtein,
    targetProtein,
    completedDays,
    targetDays,
    goal,
  } = input;

  if (proteinRate < 0.85) {
    return {
      title: 'Protein đang là điểm nghẽn chính',
      body: `Trung bình bạn mới đạt khoảng ${formatWholeNumber(averageProtein)} / ${formatWholeNumber(targetProtein)}g protein mỗi ngày. Nếu thêm một bữa phụ giàu protein, tốc độ ${goal === 'Tăng cơ' ? 'phục hồi và tăng cơ' : 'giảm mỡ'} sẽ ổn định hơn.`,
      actionLabel: 'Nhờ AI chỉnh thực đơn',
      actionHref: '/diet-plan',
    };
  }

  if (workoutRate < 0.65) {
    return {
      title: 'Lịch tập hiện tại có vẻ hơi quá tải',
      body: `Bạn mới hoàn thành ${completedDays}/${Math.max(1, targetDays)} buổi trong giai đoạn này. Hợp lý hơn là chốt một lịch nhẹ nhưng đều, thay vì để kế hoạch quá dày rồi bỏ giữa chừng.`,
      actionLabel: 'Điều chỉnh lịch tập',
      actionHref: '/smart-planner',
    };
  }

  if (sleepRate < 0.6) {
    return {
      title: 'Giấc ngủ đang kéo chậm tốc độ hồi phục',
      body: 'Nhịp tập và ăn uống của bạn chưa tệ, nhưng số ngày ngủ đủ còn thấp. Chỉ cần nâng chất lượng ngủ trong vài ngày liên tiếp, cảm giác theo được kế hoạch sẽ dễ hơn nhiều.',
      actionLabel: 'Tối ưu kế hoạch tuần tới',
      actionHref: '/smart-planner',
    };
  }

  if (weightStatus === 'Giảm quá nhanh') {
    return {
      title: 'Cân nặng đang xuống khá nhanh',
      body: 'Tốc độ thay đổi hiện tại có thể khó duy trì lâu nếu bạn cắt quá mạnh. Nên ưu tiên giữ protein và lịch tập ổn định thay vì giảm thêm calories.',
      actionLabel: 'Giữ nhịp an toàn hơn',
      actionHref: '/smart-planner',
    };
  }

  if ((score || 0) >= 75) {
    return {
      title: 'Bạn đang đi đúng hướng',
      body: 'Nhịp tập luyện và dinh dưỡng đang khá ổn. Tuần tới nên giữ cấu trúc hiện tại, chỉ tinh chỉnh nhẹ ở điểm còn yếu để tiến độ tiếp tục đi lên.',
      actionLabel: 'Tối ưu kế hoạch tuần tới',
      actionHref: '/smart-planner',
    };
  }

  return {
    title: 'Tuần này hơi lệch nhịp, nhưng chưa phải vấn đề lớn',
    body: 'Bạn đã có dữ liệu đủ để nhìn ra điểm cần chỉnh. Việc quan trọng nhất lúc này là quay về một kế hoạch đơn giản, dễ duy trì và đủ sát với nhịp sống thực tế.',
    actionLabel: 'Nhờ AI điều chỉnh',
    actionHref: '/smart-planner',
  };
}

function buildActionItems(input: {
  workoutRate: number;
  proteinRate: number;
  sleepRate: number;
  waterRate: number;
  targetProtein: number;
  sleepTarget: number;
  waterGoal: number;
  weeklyWorkoutTarget: number;
}): string[] {
  const items: string[] = [];

  if (input.workoutRate < 0.8) {
    items.push(`Giữ lịch ${Math.max(3, input.weeklyWorkoutTarget || 3)} buổi/tuần và ưu tiên hoàn thành đủ trước khi tăng thêm volume.`);
  }

  if (input.proteinRate < 0.9 && input.targetProtein > 0) {
    items.push(`Thêm một bữa phụ giàu protein để kéo trung bình ngày lên gần ${formatWholeNumber(input.targetProtein)}g.`);
  }

  if (input.sleepRate < 0.7) {
    items.push(`Đặt mục tiêu ngủ đủ ${formatMetric(input.sleepTarget, 0)} giờ trong ít nhất 3 ngày liên tiếp.`);
  }

  if (input.waterRate < 0.7) {
    items.push(`Hoàn thành ${formatMetric(input.waterGoal, 1)}L nước ở ít nhất 5 ngày để giữ nhịp hồi phục tốt hơn.`);
  }

  if (items.length < 3) {
    items.push('Cập nhật cân nặng thêm 1-2 lần trong tuần tới để AI theo dõi xu hướng chính xác hơn.');
  }

  if (items.length < 3) {
    items.push('Giữ nguyên khung tập và thực đơn đang theo, chỉ chỉnh một điểm yếu mỗi tuần thay vì thay toàn bộ kế hoạch.');
  }

  return items.slice(0, 3);
}

function buildProgressViewModel(params: {
  rangeDays: number;
  goal: string;
  weeklyWorkoutTarget: number;
  targetCalories: number;
  waterGoal: number;
  sleepTarget: number;
  currentDateKeys: string[];
  previousDateKeys: string[];
  dayMap: Record<string, AggregatedDay>;
  weightByDate: Record<string, number>;
}): ProgressViewModel {
  const {
    rangeDays,
    goal,
    weeklyWorkoutTarget,
    targetCalories,
    waterGoal,
    sleepTarget,
    currentDateKeys,
    previousDateKeys,
    dayMap,
    weightByDate,
  } = params;

  const currentDays = currentDateKeys.map((dateKey) => dayMap[dateKey] || createAggregatedDay(dateKey));
  const previousDays = previousDateKeys.map((dateKey) => dayMap[dateKey] || createAggregatedDay(dateKey));
  const targetProtein = getTargetProtein(targetCalories);
  const workoutTarget = getWorkoutTarget(rangeDays, weeklyWorkoutTarget);
  const mealTargetBand = getMealTargetBand(targetCalories);

  const currentCompletedDays = currentDays.filter((day) => day.completedExercises > 0).length;
  const previousCompletedDays = previousDays.filter((day) => day.completedExercises > 0).length;
  const currentMinutes = currentDays.reduce((sum, day) => sum + (day.completedExercises * ESTIMATED_MINUTES_PER_EXERCISE), 0);
  const loggedCaloriesBurned = currentDays.reduce((sum, day) => sum + day.caloriesBurned, 0);
  const resolvedCaloriesBurned = loggedCaloriesBurned > 0 ? loggedCaloriesBurned : Math.round(currentMinutes * 5.5);

  const mealDays = currentDays.filter((day) => day.mealEntries > 0);
  const previousMealDays = previousDays.filter((day) => day.mealEntries > 0);
  const averageCalories = mealDays.length > 0
    ? Math.round(mealDays.reduce((sum, day) => sum + day.calories, 0) / mealDays.length)
    : 0;
  const averageProtein = mealDays.length > 0
    ? Math.round(mealDays.reduce((sum, day) => sum + day.protein, 0) / mealDays.length)
    : 0;
  const daysOnTarget = mealDays.filter((day) => day.calories >= mealTargetBand.min && day.calories <= mealTargetBand.max).length;
  const previousDaysOnTarget = previousMealDays.filter((day) => day.calories >= mealTargetBand.min && day.calories <= mealTargetBand.max).length;

  const waterHitDays = currentDays.filter((day) => waterGoal > 0 && day.waterLiters >= waterGoal * 0.95).length;
  const sleepHitDays = currentDays.filter((day) => day.sleepHours >= sleepTarget - 0.25).length;
  const checkInDays = currentDays.filter((day) =>
    day.completedExercises > 0 || day.mealEntries > 0 || day.waterLiters > 0 || day.sleepHours > 0
  ).length;

  const workoutRate = workoutTarget > 0 ? clamp(currentCompletedDays / workoutTarget, 0, 1.25) : (currentCompletedDays > 0 ? 1 : 0);
  const proteinRate = targetProtein > 0 ? clamp(averageProtein / targetProtein, 0, 1.2) : (averageProtein > 0 ? 1 : 0);
  const waterRate = clamp(waterHitDays / Math.max(1, currentDateKeys.length), 0, 1);
  const sleepRate = clamp(sleepHitDays / Math.max(1, currentDateKeys.length), 0, 1);

  const scoreMetrics: ScoreMetric[] = [];
  if (workoutTarget > 0 || currentCompletedDays > 0) scoreMetrics.push({ label: 'Tập luyện', value: workoutRate * 100 });
  if (targetCalories > 0 && mealDays.length > 0) scoreMetrics.push({ label: 'Calories', value: (daysOnTarget / Math.max(1, mealDays.length)) * 100 });
  if (targetProtein > 0 && mealDays.length > 0) scoreMetrics.push({ label: 'Protein', value: proteinRate * 100 });
  if (waterGoal > 0) scoreMetrics.push({ label: 'Nước', value: waterRate * 100 });
  if (sleepTarget > 0) scoreMetrics.push({ label: 'Giấc ngủ', value: sleepRate * 100 });
  const scoreValue = buildScore(scoreMetrics);

  const currentWeights = currentDateKeys
    .map((dateKey) => ({ dateKey, weight: weightByDate[dateKey] ?? null }))
    .filter((item) => item.weight !== null);
  const latestWeight = currentWeights.length > 0 ? currentWeights[currentWeights.length - 1].weight : null;
  const baselineWeight = currentWeights.length > 0 ? currentWeights[0].weight : null;
  const weightDelta = latestWeight !== null && baselineWeight !== null && currentWeights.length > 1
    ? Number((latestWeight - baselineWeight).toFixed(1))
    : null;

  let weightStatus = 'Chưa đủ dữ liệu';
  let weightHelper = 'Cập nhật cân nặng vài lần mỗi tuần để nhìn ra xu hướng rõ hơn.';

  if (weightDelta !== null) {
    const weeklyRate = Math.abs(weightDelta) / Math.max(1, rangeDays / 7);
    if (goal === 'Giảm cân') {
      if (weightDelta < 0 && weeklyRate <= 1.2) {
        weightStatus = 'Đúng hướng';
        weightHelper = 'Mức giảm hiện tại khá ổn. Hãy giữ calories và protein ổn định thay vì cắt ăn mạnh hơn.';
      } else if (weightDelta < 0 && weeklyRate > 1.2) {
        weightStatus = 'Giảm quá nhanh';
        weightHelper = 'Bạn đang xuống khá nhanh. Nên kiểm tra lại protein và mức độ bền của kế hoạch hiện tại.';
      } else {
        weightStatus = 'Cần chỉnh nhẹ';
        weightHelper = 'Cân nặng chưa đi theo hướng mong muốn. Hợp lý nhất là kiểm tra lại mức ăn và độ đều của lịch tập.';
      }
    } else if (goal === 'Tăng cơ') {
      if (weightDelta > 0) {
        weightStatus = 'Đúng hướng';
        weightHelper = 'Cân nặng đang tăng nhẹ. Hãy tiếp tục ưu tiên protein và duy trì tần suất tập.';
      } else {
        weightStatus = 'Cần chỉnh nhẹ';
        weightHelper = 'Nếu mục tiêu là tăng cơ, bạn có thể cần thêm năng lượng và protein để hỗ trợ tiến triển.';
      }
    } else {
      weightStatus = Math.abs(weightDelta) <= 1 ? 'Ổn định' : 'Biến động rõ';
      weightHelper = 'Mục tiêu hiện tại thiên về duy trì nhịp. Theo dõi thêm vài lần đo để xác nhận xu hướng.';
    }
  }

  const strengthPool: string[] = [];
  const improvementPool: string[] = [];
  if (workoutRate >= 0.9) strengthPool.push('Tập luyện đều hơn mục tiêu');
  if (proteinRate >= 0.9) strengthPool.push('Protein đã bám khá sát mục tiêu');
  if (sleepRate >= 0.8) strengthPool.push('Giấc ngủ đang hỗ trợ hồi phục tốt');
  if (waterRate >= 0.8) strengthPool.push('Nước uống được duy trì ổn');
  if (daysOnTarget >= Math.max(3, Math.floor(currentDateKeys.length / 2))) strengthPool.push('Calories giữ được nhịp khá đều');

  if (workoutRate < 0.75) improvementPool.push('Cần hoàn thành thêm buổi tập đã lên kế hoạch');
  if (proteinRate < 0.85) improvementPool.push('Protein còn thấp hơn nhu cầu hiện tại');
  if (sleepRate < 0.65) improvementPool.push('Giấc ngủ chưa đủ đều');
  if (waterRate < 0.65) improvementPool.push('Nước uống chưa ổn định');
  if (targetCalories > 0 && mealDays.length > 0 && daysOnTarget < Math.max(2, Math.floor(mealDays.length / 2))) {
    improvementPool.push('Calories vẫn lệch mục tiêu khá nhiều ngày');
  }

  const completedWorkoutDateKeys = [...previousDateKeys, ...currentDateKeys].filter((dateKey) => {
    const day = dayMap[dateKey];
    return !!day && day.completedExercises > 0;
  });
  const streakDays = calculateWorkoutStreak(completedWorkoutDateKeys, currentDateKeys[currentDateKeys.length - 1]);

  const heroTitle = scoreValue !== null && scoreValue >= 75
    ? 'Bạn đang đi đúng hướng'
    : scoreValue !== null && scoreValue >= 50
      ? 'Tiến độ đang có tín hiệu tốt'
      : 'Tuần này hơi lệch nhịp';
  const heroBody = scoreValue !== null && scoreValue >= 75
    ? `Bạn đã hoàn thành ${currentCompletedDays}/${Math.max(1, workoutTarget)} buổi và đang giữ nhịp khá tốt trong ${rangeDays} ngày gần đây.`
    : scoreValue !== null && scoreValue >= 50
      ? 'Bạn đã có nền dữ liệu đủ rõ để biết điểm mạnh và điểm cần chỉnh cho giai đoạn tiếp theo.'
      : 'Nhịp hiện tại chưa thật sự ổn, nhưng bạn vẫn có thể kéo lại bằng vài điều chỉnh nhỏ và dễ duy trì.';

  const coach = buildCoachInsight({
    score: scoreValue,
    workoutRate,
    proteinRate,
    sleepRate,
    weightStatus,
    averageProtein,
    targetProtein,
    completedDays: currentCompletedDays,
    targetDays: workoutTarget,
    goal,
  });

  const actionItems = buildActionItems({
    workoutRate,
    proteinRate,
    sleepRate,
    waterRate,
    targetProtein,
    sleepTarget,
    waterGoal,
    weeklyWorkoutTarget,
  });

  const muscleGroupMap: Record<string, number> = {};
  currentDays.forEach((day) => {
    Object.entries(day.muscleGroups).forEach(([group, count]) => {
      muscleGroupMap[group] = (muscleGroupMap[group] || 0) + count;
    });
  });

  const stripSource = currentDateKeys.slice(-(rangeDays > 14 ? 14 : rangeDays));
  const habitSource = currentDateKeys.slice(-(rangeDays > 14 ? 14 : rangeDays));
  const weightChart = currentDateKeys.map((dateKey) => ({
    dateKey,
    label: getShortDateLabel(dateKey),
    weight: weightByDate[dateKey] ?? null,
  }));

  const empty = currentCompletedDays === 0
    && mealDays.length === 0
    && checkInDays === 0
    && currentWeights.length === 0;

  return {
    empty,
    rangeDays,
    filterLabel: `${rangeDays} ngày`,
    heroTitle,
    heroBody,
    summary: {
      workouts: {
        completed: currentCompletedDays,
        target: workoutTarget,
        delta: previousDateKeys.length > 0 ? currentCompletedDays - previousCompletedDays : null,
      },
      nutrition: {
        completed: daysOnTarget,
        target: targetCalories > 0 ? (mealDays.length > 0 ? mealDays.length : currentDateKeys.length) : 0,
        loggedDays: mealDays.length,
        delta: previousDateKeys.length > 0 ? daysOnTarget - previousDaysOnTarget : null,
      },
      protein: {
        average: averageProtein,
        target: targetProtein,
        status: targetProtein <= 0 ? 'Chưa có mục tiêu' : proteinRate >= 0.9 ? 'Tốt' : proteinRate >= 0.75 ? 'Tạm ổn' : 'Cần cải thiện',
      },
      weight: {
        latest: latestWeight,
        previous: baselineWeight,
        delta: weightDelta,
        status: weightStatus,
      },
      streakDays,
    },
    coach,
    weight: {
      latest: latestWeight,
      baseline: baselineWeight,
      change: weightDelta,
      sampleCount: currentWeights.length,
      status: weightStatus,
      helper: weightHelper,
      chart: weightChart,
    },
    score: {
      value: scoreValue,
      strengths: strengthPool.slice(0, 2),
      improvements: improvementPool.slice(0, 2),
      helper: scoreValue === null
        ? 'Điểm này sẽ rõ hơn khi bạn có thêm dữ liệu ăn uống, tập luyện và giấc ngủ.'
        : 'Điểm duy trì được tính từ nhịp tập luyện, calories, protein, nước và giấc ngủ trong giai đoạn đã chọn.',
    },
    workout: {
      completedDays: currentCompletedDays,
      targetDays: workoutTarget,
      totalMinutes: currentMinutes,
      totalCalories: resolvedCaloriesBurned,
      stripLabel: rangeDays > 14 ? '14 ngày gần nhất' : `${rangeDays} ngày gần nhất`,
      strip: stripSource.map((dateKey) => {
        const day = dayMap[dateKey] || createAggregatedDay(dateKey);
        return {
          dateKey,
          label: getWeekdayLabel(dateKey),
          dayNumber: getDayNumber(dateKey),
          completed: day.completedExercises > 0,
          planned: day.plannedExercises > 0,
        };
      }),
      chart: stripSource.map((dateKey) => {
        const day = dayMap[dateKey] || createAggregatedDay(dateKey);
        return {
          dateKey,
          label: getShortDateLabel(dateKey),
          completed: day.completedExercises,
          planned: Math.max(0, day.plannedExercises - day.completedExercises),
        };
      }),
      muscleGroups: Object.entries(muscleGroupMap)
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 6),
    },
    nutrition: {
      averageCalories,
      targetCalories,
      averageProtein,
      targetProtein,
      daysOnTarget,
      loggedDays: mealDays.length,
      chart: stripSource.map((dateKey) => {
        const day = dayMap[dateKey] || createAggregatedDay(dateKey);
        return {
          dateKey,
          label: getShortDateLabel(dateKey),
          calories: Math.round(day.calories),
          protein: Math.round(day.protein),
          inTarget: day.mealEntries > 0 && day.calories >= mealTargetBand.min && day.calories <= mealTargetBand.max,
        };
      }),
    },
    habits: {
      title: rangeDays > 14 ? 'Thói quen 14 ngày gần nhất' : `Thói quen ${rangeDays} ngày gần nhất`,
      rows: [
        {
          label: 'Tập luyện',
          value: `${currentCompletedDays}/${Math.max(1, workoutTarget)} buổi`,
          cells: habitSource.map((dateKey) => {
            const day = dayMap[dateKey] || createAggregatedDay(dateKey);
            return { dateKey, label: getWeekdayLabel(dateKey), active: day.completedExercises > 0 };
          }),
        },
        {
          label: 'Ăn đúng plan',
          value: `${daysOnTarget}/${mealDays.length > 0 ? mealDays.length : currentDateKeys.length} ngày`,
          cells: habitSource.map((dateKey) => {
            const day = dayMap[dateKey] || createAggregatedDay(dateKey);
            return {
              dateKey,
              label: getWeekdayLabel(dateKey),
              active: day.mealEntries > 0 && day.calories >= mealTargetBand.min && day.calories <= mealTargetBand.max,
            };
          }),
        },
        {
          label: 'Đủ nước',
          value: `${waterHitDays}/${currentDateKeys.length} ngày`,
          cells: habitSource.map((dateKey) => {
            const day = dayMap[dateKey] || createAggregatedDay(dateKey);
            return { dateKey, label: getWeekdayLabel(dateKey), active: waterGoal > 0 && day.waterLiters >= waterGoal * 0.95 };
          }),
        },
        {
          label: 'Ngủ đủ',
          value: `${sleepHitDays}/${currentDateKeys.length} ngày`,
          cells: habitSource.map((dateKey) => {
            const day = dayMap[dateKey] || createAggregatedDay(dateKey);
            return { dateKey, label: getWeekdayLabel(dateKey), active: day.sleepHours >= sleepTarget - 0.25 };
          }),
        },
        {
          label: 'Check-in',
          value: `${checkInDays}/${currentDateKeys.length} ngày`,
          cells: habitSource.map((dateKey) => {
            const day = dayMap[dateKey] || createAggregatedDay(dateKey);
            return {
              dateKey,
              label: getWeekdayLabel(dateKey),
              active: day.completedExercises > 0 || day.mealEntries > 0 || day.waterLiters > 0 || day.sleepHours > 0,
            };
          }),
        },
      ],
    },
    actions: {
      title: 'Tuần tới nên làm gì?',
      items: actionItems,
      primaryLabel: 'Nhờ AI cập nhật kế hoạch',
      primaryHref: '/smart-planner',
      secondaryLabel: 'Điều chỉnh mục tiêu ăn uống',
      secondaryHref: '/diet-plan',
    },
  };
}

function WeightTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value?: number; payload?: { label: string } }> }) {
  if (!active || !payload || payload.length === 0 || payload[0]?.value === null || payload[0]?.value === undefined) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border-primary bg-bg-secondary/95 px-3 py-2 shadow-xl backdrop-blur-xl">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">{payload[0]?.payload?.label}</p>
      <p className="mt-1 text-sm font-bold text-text-primary">{formatMetric(Number(payload[0]?.value), 1)} kg</p>
    </div>
  );
}

function NutritionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { label: string; protein: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const calories = Number(payload[0]?.value || 0);
  const protein = Number(payload[0]?.payload?.protein || 0);

  return (
    <div className="rounded-2xl border border-border-primary bg-bg-secondary/95 px-3 py-2 shadow-xl backdrop-blur-xl">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">{payload[0]?.payload?.label}</p>
      <p className="mt-1 text-sm font-bold text-text-primary">{formatWholeNumber(calories)} kcal</p>
      <p className="text-xs font-semibold text-text-secondary">{formatWholeNumber(protein)}g protein</p>
    </div>
  );
}

function WorkoutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { label: string; completed: number; planned: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-2xl border border-border-primary bg-bg-secondary/95 px-3 py-2 shadow-xl backdrop-blur-xl">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">{item.label}</p>
      <p className="mt-1 text-sm font-bold text-text-primary">{formatWholeNumber(item.completed)} bài hoàn thành</p>
      <p className="text-xs font-semibold text-text-secondary">{formatWholeNumber(item.planned)} bài còn lại</p>
    </div>
  );
}

function ProgressSkeleton() {
  return (
    <div className="dashboard-page-shell flex flex-col gap-4 animate-pulse pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
        <SkeletonSurface className="rounded-[28px] p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {SkeletonBlock('h-3 w-28')}
              {SkeletonBlock('mt-3 h-7 w-[62%] rounded-xl')}
            </div>
            <div className="h-12 w-12 rounded-2xl bg-bg-tertiary/70" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-[22px] border border-border-primary bg-bg-tertiary/30 p-4">
                {SkeletonBlock('h-3 w-20')}
                {SkeletonBlock('mt-3 h-7 w-20 rounded-xl')}
                {SkeletonBlock('mt-2 h-3 w-28 rounded-lg')}
              </div>
            ))}
          </div>
        </SkeletonSurface>
        <SkeletonSurface className="rounded-[28px] p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {SkeletonBlock('h-3 w-24')}
              {SkeletonBlock('mt-3 h-7 w-[54%] rounded-xl')}
            </div>
            <div className="h-12 w-12 rounded-2xl bg-bg-tertiary/70" />
          </div>
          <div className="mt-5 space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3 rounded-[22px] border border-border-primary bg-bg-tertiary/30 px-4 py-4">
                <div className="h-8 w-8 rounded-full bg-bg-secondary/90" />
                <div className="min-w-0 flex-1">
                  {SkeletonBlock('h-3 w-full rounded-lg')}
                  {SkeletonBlock('mt-2 h-3 w-[82%] rounded-lg')}
                </div>
              </div>
            ))}
          </div>
        </SkeletonSurface>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonSurface className="rounded-[28px] p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {SkeletonBlock('h-3 w-24')}
              {SkeletonBlock('mt-3 h-7 w-[56%] rounded-xl')}
            </div>
            <div className="h-12 w-12 rounded-2xl bg-bg-tertiary/70" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-border-primary bg-bg-tertiary/25 px-3 py-4">
                {SkeletonBlock('mx-auto h-3 w-8 rounded-lg')}
                <div className="mt-3 h-16 rounded-xl bg-bg-tertiary/55" />
              </div>
            ))}
          </div>
        </SkeletonSurface>
        <SkeletonSurface className="rounded-[28px] p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {SkeletonBlock('h-3 w-24')}
              {SkeletonBlock('mt-3 h-7 w-[52%] rounded-xl')}
            </div>
            <div className="h-12 w-12 rounded-2xl bg-bg-tertiary/70" />
          </div>
          <div className="mt-5 space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  {SkeletonBlock('h-3 w-16 rounded-lg')}
                  {SkeletonBlock('h-3 w-20 rounded-lg')}
                </div>
                <div className="h-2 rounded-full bg-bg-tertiary/55">
                  <div className="h-full rounded-full bg-bg-tertiary" style={{ width: `${70 - index * 8}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SkeletonSurface>
      </div>
      <SkeletonSurface className="rounded-[28px] p-5 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {SkeletonBlock('h-3 w-24')}
            {SkeletonBlock('mt-3 h-7 w-[42%] rounded-xl')}
          </div>
          <div className="h-12 w-12 rounded-2xl bg-bg-tertiary/70" />
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-[22px] border border-border-primary bg-bg-tertiary/25 p-4">
              {SkeletonBlock('h-3 w-20')}
              {SkeletonBlock('mt-3 h-6 w-[72%] rounded-xl')}
              {SkeletonBlock('mt-2 h-3 w-full rounded-lg')}
              {SkeletonBlock('mt-2 h-3 w-[84%] rounded-lg')}
            </div>
          ))}
        </div>
      </SkeletonSurface>
    </div>
  );
}

function SummaryDelta({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-xs font-semibold text-text-tertiary">Chưa có kỳ trước</span>;
  }
  if (delta === 0) {
    return <span className="text-xs font-semibold text-text-tertiary">Ổn định</span>;
  }

  const positive = delta > 0;
  return (
    <span className={`text-xs font-bold ${positive ? 'text-accent' : 'text-warning'}`}>
      {positive ? '+' : ''}
      {delta} so với kỳ trước
    </span>
  );
}

type ProgressTone = 'accent' | 'info' | 'warning' | 'ai' | 'score' | 'workout' | 'nutrition' | 'water' | 'weight' | 'coach';

const toneStyles: Record<ProgressTone, { toneClass: string; text: string }> = {
  accent: {
    toneClass: 'progress-tone-score',
    text: 'text-accent',
  },
  info: {
    toneClass: 'progress-tone-nutrition',
    text: 'text-info',
  },
  warning: {
    toneClass: 'progress-tone-recovery',
    text: 'text-warning',
  },
  ai: {
    toneClass: 'progress-tone-weight',
    text: 'text-ai',
  },
  score: {
    toneClass: 'progress-tone-score',
    text: 'text-accent',
  },
  workout: {
    toneClass: 'progress-tone-workout',
    text: 'text-accent',
  },
  nutrition: {
    toneClass: 'progress-tone-nutrition',
    text: 'text-info',
  },
  water: {
    toneClass: 'progress-tone-water',
    text: 'text-info',
  },
  weight: {
    toneClass: 'progress-tone-weight',
    text: 'text-ai',
  },
  coach: {
    toneClass: 'progress-tone-coach',
    text: 'text-ai',
  },
};

function getProgressPercent(value: number, target: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(target) || target <= 0) return 100;
  return clamp((value / target) * 100, 0, 100);
}

function ProgressBar({ percent, tone = 'accent' }: { percent: number; tone?: ProgressTone }) {
  return (
    <div className={`progress-bar-track mt-4 h-2 overflow-hidden rounded-full ${toneStyles[tone].toneClass}`}>
      <div
        className="progress-bar-fill h-full rounded-full"
        style={{ width: `${clamp(percent, 0, 100)}%` }}
      />
    </div>
  );
}

function ProgressIcon({
  icon,
  tone = 'accent',
  size = 'md',
}: {
  icon: ReactNode;
  tone?: ProgressTone;
  size?: 'sm' | 'md';
}) {
  return (
    <span className={`progress-svg-mark progress-svg-mark--${size} ${toneStyles[tone].toneClass}`} aria-hidden="true">
      <svg className="progress-svg-orbit" viewBox="0 0 48 48" focusable="false">
        <circle className="progress-svg-ring" cx="24" cy="24" r="17" />
        <path className="progress-svg-spark" d="M24 5.5c5.4 0 10.3 2.3 13.7 6M42.5 24c0 4.7-1.8 9-4.8 12.2M10.3 36.2A18.4 18.4 0 0 1 5.5 24" />
      </svg>
      <span className="progress-svg-glyph">{icon}</span>
    </span>
  );
}

function MetricTile({
  label,
  value,
  helper,
  icon,
  tone = 'accent',
  percent,
  footer,
}: {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
  tone?: ProgressTone;
  percent?: number;
  footer?: ReactNode;
}) {
  return (
    <article className="progress-simple-card rounded-xl border border-border-primary bg-bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">{label}</p>
          <p className="mt-3 text-2xl font-black leading-tight text-text-primary">{value}</p>
        </div>
        <ProgressIcon icon={icon} tone={tone} size="sm" />
      </div>
      <p className="mt-2 text-xs font-semibold leading-5 text-text-secondary">{helper}</p>
      {typeof percent === 'number' && <ProgressBar percent={percent} tone={tone} />}
      {footer && <div className="mt-3">{footer}</div>}
    </article>
  );
}

function EmptyMetricState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-border-primary bg-bg-tertiary/35 px-5 py-8 text-center">
      <div className="max-w-md">
        <p className="text-sm font-black text-text-primary">{title}</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">{body}</p>
      </div>
    </div>
  );
}

export default function Progress() {
  const navigate = useNavigate();
  const { user, isLoggedIn, refreshTick } = useAuth();
  const rangeDays = PROGRESS_RANGE_DAYS;
  const initialProgressCache = user?.id ? progressPageCache.get(`${user.id}:${PROGRESS_RANGE_DAYS}:${getVietnamDateKey()}`) || null : null;
  const [loading, setLoading] = useState(() => !initialProgressCache);
  const [, setIsRefreshing] = useState(false);
  const [viewModel, setViewModel] = useState<ProgressViewModel | null>(() => initialProgressCache?.viewModel || null);
  const cacheKey = user?.id ? `${user.id}:${PROGRESS_RANGE_DAYS}:${getVietnamDateKey()}` : null;

  useEffect(() => {
    let isMounted = true;

    async function fetchProgress() {
      if (!user || !isLoggedIn) {
        if (isMounted) {
          setViewModel(null);
          setLoading(false);
          setIsRefreshing(false);
        }
        return;
      }

      const cached = cacheKey ? progressPageCache.get(cacheKey) || null : null;
      if (isMounted && cached) {
        setViewModel(cached.viewModel);
      }
      const hasVisibleProgress = !!viewModel;
      setLoading(!cached && !hasVisibleProgress);
      setIsRefreshing(!!cached || hasVisibleProgress);

      try {
        const endDateKey = getVietnamDateKey();
        const currentDateKeys = buildDateKeys(endDateKey, rangeDays);
        const previousDateKeys = buildDateKeys(addDaysToDateKey(currentDateKeys[0], -1), rangeDays);
        const allDateKeys = [...previousDateKeys, ...currentDateKeys];
        const fetchStartKey = allDateKeys[0];
        const currentPeriodStartKey = currentDateKeys[0];

        const [
          lifestyleRes,
          healthRes,
          workoutsRes,
          mealsRes,
          progressRes,
          bodyMetricsRes,
          bodyMetricBeforeCurrentRes,
        ] = await Promise.all([
          supabase
            .from('lifestyle_settings')
            .select('weekly_workouts, target_calories, fitness_goal, daily_water_goal')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('health_conditions')
            .select('sleep_hours')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('daily_exercise_sessions')
            .select('id, log_date, is_completed, exercises:exercise_id(name, target_muscle, body_part)')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', endDateKey),
          supabase
            .from('daily_meal_logs')
            .select('log_date, calories, protein, carbs, fat, quantity')
            .eq('user_id', user.id)
            .eq('is_completed', true)
            .gte('log_date', fetchStartKey)
            .lte('log_date', endDateKey),
          supabase
            .from('daily_progress_logs')
            .select('log_date, water_intake_ml, sleep_hours, calories_burned')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', endDateKey),
          supabase
            .from('body_metrics')
            .select('weight, created_at')
            .eq('user_id', user.id)
            .gte('created_at', `${fetchStartKey}T00:00:00`)
            .order('created_at', { ascending: true }),
          supabase
            .from('body_metrics')
            .select('weight, created_at')
            .eq('user_id', user.id)
            .lt('created_at', `${currentPeriodStartKey}T00:00:00`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        const lifestyle = (lifestyleRes.data || null) as LifestyleRow | null;
        const health = (healthRes.data || null) as HealthRow | null;
        const workouts = (workoutsRes.data || []) as WorkoutRow[];
        const meals = (mealsRes.data || []) as MealLogRow[];
        const progressLogs = (progressRes.data || []) as ProgressLogRow[];
        const bodyMetrics = (bodyMetricsRes.data || []) as BodyMetricRow[];
        const bodyMetricBeforeCurrent = (bodyMetricBeforeCurrentRes.data || null) as BodyMetricRow | null;

        const dayMap = Object.fromEntries(allDateKeys.map((dateKey) => [dateKey, createAggregatedDay(dateKey)])) as Record<string, AggregatedDay>;

        workouts.forEach((row) => {
          const day = dayMap[row.log_date];
          if (!day) return;
          day.plannedExercises += 1;
          if (row.is_completed) {
            day.completedExercises += 1;
            const meta = normalizeExerciseMeta(row.exercises);
            const muscleKey = String(meta?.target_muscle || meta?.body_part || '').trim();
            if (muscleKey) {
              day.muscleGroups[muscleKey] = (day.muscleGroups[muscleKey] || 0) + 1;
            }
          }
        });

        meals.forEach((row) => {
          const day = dayMap[row.log_date];
          if (!day) return;
          const quantity = Math.max(0, Number(row.quantity || 1));
          day.calories += Math.max(0, Number(row.calories || 0)) * quantity;
          day.protein += Math.max(0, Number(row.protein || 0)) * quantity;
          day.mealEntries += 1;
        });

        progressLogs.forEach((row) => {
          const day = dayMap[row.log_date];
          if (!day) return;
          day.waterLiters = Math.max(day.waterLiters, Number(row.water_intake_ml || 0) / 1000);
          day.sleepHours = Math.max(day.sleepHours, Number(row.sleep_hours || 0));
          day.caloriesBurned += Math.max(0, Number(row.calories_burned || 0));
        });

        const weightByDate: Record<string, number> = {};
        bodyMetrics.forEach((row) => {
          const numericWeight = Number(row.weight);
          if (!Number.isFinite(numericWeight) || numericWeight <= 0) return;
          const dateKey = getVietnamDateKey(new Date(row.created_at));
          if (!allDateKeys.includes(dateKey)) return;
          weightByDate[dateKey] = Number(numericWeight.toFixed(1));
        });

        const hasCurrentPeriodWeight = currentDateKeys.some((dateKey) => weightByDate[dateKey] !== undefined);
        const beforeCurrentWeight = Number(bodyMetricBeforeCurrent?.weight);
        if (
          hasCurrentPeriodWeight
          && Number.isFinite(beforeCurrentWeight)
          && beforeCurrentWeight > 0
          && weightByDate[currentPeriodStartKey] === undefined
        ) {
          weightByDate[currentPeriodStartKey] = Number(beforeCurrentWeight.toFixed(1));
        }

        const nextViewModel = buildProgressViewModel({
          rangeDays,
          goal: lifestyle?.fitness_goal || 'Giảm cân',
          weeklyWorkoutTarget: Number(lifestyle?.weekly_workouts || 0),
          targetCalories: Number(lifestyle?.target_calories || 0),
          waterGoal: Number(lifestyle?.daily_water_goal || 2.5),
          sleepTarget: toSleepTarget(health?.sleep_hours),
          currentDateKeys,
          previousDateKeys,
          dayMap,
          weightByDate,
        });

        if (isMounted) {
          setViewModel(nextViewModel);
          if (cacheKey) {
            progressPageCache.set(cacheKey, {
              viewModel: nextViewModel
            });
          }
        }
      } catch (error) {
        console.error(error);
        if (isMounted) {
          if (!cached && !viewModel) {
            setViewModel(null);
          }
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    void fetchProgress();

    return () => {
      isMounted = false;
    };
  }, [user, isLoggedIn, refreshTick, cacheKey]);

  if (loading) return <ProgressSkeleton />;
  if (!viewModel) return <ProgressSkeleton />;

  const isEmpty = viewModel.empty;
  const hasWorkoutTarget = viewModel.summary.workouts.target > 0;
  const hasNutritionTarget = viewModel.summary.nutrition.target > 0 && viewModel.nutrition.targetCalories > 0;
  const hasProteinTarget = viewModel.summary.protein.target > 0;
  const hasWeightSamples = viewModel.weight.sampleCount > 0;
  const hasWeightTrend = viewModel.weight.sampleCount > 1;
  const scorePercent = clamp(viewModel.score.value ?? 0, 0, 100);
  const workoutPercent = hasWorkoutTarget
    ? getProgressPercent(viewModel.workout.completedDays, viewModel.workout.targetDays)
    : getProgressPercent(viewModel.workout.completedDays, viewModel.rangeDays);
  const nutritionPercent = hasNutritionTarget
    ? getProgressPercent(viewModel.nutrition.daysOnTarget, viewModel.summary.nutrition.target)
    : getProgressPercent(viewModel.nutrition.loggedDays, viewModel.rangeDays);
  const proteinPercent = hasProteinTarget
    ? getProgressPercent(viewModel.nutrition.averageProtein, viewModel.nutrition.targetProtein)
    : getProgressPercent(viewModel.nutrition.averageProtein, Math.max(1, viewModel.nutrition.averageProtein));
  const weightSummaryValue = hasWeightSamples
    ? viewModel.weight.change !== null
      ? formatSignedKg(viewModel.weight.change)
      : `${formatMetric(viewModel.weight.latest, 1)} kg`
    : '--';

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-4 md:gap-5 md:pb-6 lg:pb-7">
      {isEmpty ? (
        <section className="progress-simple-card rounded-xl border border-border-primary bg-bg-secondary p-5 md:p-6">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Chưa đủ dữ liệu</p>
            <h2 className="mt-3 text-xl font-black text-text-primary md:text-2xl">Trang tiến độ sẽ rõ hơn sau vài ngày check-in</h2>
            <p className="mt-3 text-sm font-semibold leading-7 text-text-secondary md:text-base">
              Hãy hoàn thành ít nhất 3 ngày tập luyện, ăn uống hoặc cập nhật nước ngủ để AI Coach nhìn ra xu hướng thật. Khi đó bạn sẽ thấy tổng kết tuần, protein trung bình, thay đổi cân nặng và gợi ý điều chỉnh rõ hơn.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => navigate('/overview')}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
              >
                Bắt đầu kế hoạch hôm nay
              </button>
              <button
                type="button"
                onClick={() => navigate('/smart-planner')}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary px-5 text-sm font-black text-text-primary transition-colors hover:border-accent/30 hover:text-accent"
              >
                Tạo kế hoạch với AI
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label="Điểm duy trì"
              value={viewModel.score.value !== null ? `${viewModel.score.value}/100` : '--'}
              helper="Tổng hợp từ tập luyện, ăn uống và phục hồi"
              icon={<Target className="h-5 w-5" />}
              tone="score"
              percent={scorePercent}
            />
            <MetricTile
              label="Tập luyện"
              value={hasWorkoutTarget
                ? `${viewModel.workout.completedDays}/${viewModel.workout.targetDays} buổi`
                : `${viewModel.workout.completedDays} buổi`}
              helper={`${formatWholeNumber(viewModel.workout.totalMinutes)} phút trong giai đoạn này.`}
              icon={<Dumbbell className="h-5 w-5" />}
              tone="workout"
              percent={workoutPercent}
              footer={hasWorkoutTarget ? <SummaryDelta delta={viewModel.summary.workouts.delta} /> : null}
            />
            <MetricTile
              label="Dinh dưỡng"
              value={hasNutritionTarget
                ? `${viewModel.nutrition.daysOnTarget}/${viewModel.summary.nutrition.target} ngày`
                : `${viewModel.nutrition.loggedDays} ngày log`}
              helper={`${formatWholeNumber(viewModel.nutrition.averageCalories)} kcal, ${formatWholeNumber(viewModel.nutrition.averageProtein)}g protein trung bình.`}
              icon={<Utensils className="h-5 w-5" />}
              tone="nutrition"
              percent={nutritionPercent}
            />
            <MetricTile
              label="Cân nặng"
              value={weightSummaryValue}
              helper={hasWeightSamples ? viewModel.weight.status : 'Chưa có dữ liệu cân.'}
              icon={<Scale className="h-5 w-5" />}
              tone="weight"
            />
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <article className="progress-simple-card rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Tập luyện</p>
                  <h2 className="mt-2 text-xl font-black text-text-primary">{viewModel.workout.completedDays} buổi đã xong</h2>
                </div>
                <ProgressIcon icon={<Dumbbell className="h-5 w-5" />} tone="workout" size="sm" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {viewModel.workout.strip.map((day) => (
                  <div
                    key={day.dateKey}
                    className={`rounded-xl border px-3 py-3 text-center ${
                      day.completed
                        ? 'border-accent/25 bg-accent/10'
                        : day.planned
                          ? 'border-warning/20 bg-warning/10'
                          : 'border-border-primary bg-bg-tertiary/35'
                    }`}
                  >
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">{day.label}</p>
                    <p className="mt-2 text-lg font-black text-text-primary">{day.dayNumber}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {viewModel.workout.muscleGroups.length > 0 ? (
                  viewModel.workout.muscleGroups.slice(0, 5).map((group) => (
                    <span
                      key={group.label}
                      className="rounded-full border border-border-primary bg-bg-tertiary/45 px-3 py-1.5 text-xs font-black text-text-secondary"
                    >
                      {group.label} {group.count}
                    </span>
                  ))
                ) : (
                  <p className="text-sm font-semibold text-text-secondary">Chưa có đủ dữ liệu nhóm cơ.</p>
                )}
              </div>
            </article>

            <article className="progress-simple-card rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Dinh dưỡng</p>
                  <h2 className="mt-2 text-xl font-black text-text-primary">Calories theo ngày</h2>
                </div>
                <ProgressIcon icon={<Flame className="h-5 w-5" />} tone="nutrition" size="sm" />
              </div>
              <div className="mt-4 h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={viewModel.nutrition.chart} margin={{ top: 8, right: 10, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={12}
                    />
                    <YAxis
                      tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                    />
                    <Tooltip content={<NutritionTooltip />} />
                    <Bar dataKey="calories" radius={[8, 8, 0, 0]}>
                      {viewModel.nutrition.chart.map((entry) => (
                        <Cell
                          key={entry.dateKey}
                          fill={entry.calories === 0 ? 'rgba(148,163,184,0.22)' : entry.inTarget ? 'var(--progress-nutrition)' : 'var(--progress-recovery)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <article className="progress-simple-card rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Cân nặng</p>
                  <h2 className="mt-2 text-xl font-black text-text-primary">
                    {viewModel.weight.baseline !== null && viewModel.weight.latest !== null
                      ? `${formatMetric(viewModel.weight.baseline, 1)} → ${formatMetric(viewModel.weight.latest, 1)} kg`
                      : 'Chưa đủ dữ liệu'}
                  </h2>
                </div>
                <ProgressIcon icon={<Scale className="h-5 w-5" />} tone="weight" size="sm" />
              </div>

              {hasWeightTrend ? (
                <div className="mt-4 h-[230px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={viewModel.weight.chart} margin={{ top: 8, right: 10, bottom: 0, left: -8 }}>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={12}
                      />
                      <YAxis
                        tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        domain={['dataMin - 1', 'dataMax + 1']}
                      />
                      <Tooltip content={<WeightTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="weight"
                        stroke="var(--progress-weight)"
                        strokeWidth={3}
                        dot={{ fill: 'var(--progress-weight)', stroke: 'var(--bg-secondary)', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 5 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="mt-4">
                  <EmptyMetricState
                    title={hasWeightSamples ? 'Cần thêm mốc cân' : 'Chưa có dữ liệu cân nặng'}
                    body={hasWeightSamples ? 'Thêm 1-2 lần cập nhật để biểu đồ thể hiện xu hướng rõ hơn.' : 'Cập nhật body metrics để theo dõi kết quả thực tế.'}
                  />
                </div>
              )}
            </article>

            <article className="progress-simple-card rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">AI Coach</p>
                  <h2 className="mt-2 text-xl font-black text-text-primary">{viewModel.coach.title}</h2>
                </div>
                <ProgressIcon icon={<Brain className="h-5 w-5" />} tone="coach" size="sm" />
              </div>
              <p className="mt-4 text-sm font-semibold leading-7 text-text-secondary">{viewModel.coach.body}</p>
              <div className="mt-4 grid gap-2">
                {viewModel.actions.items.slice(0, 2).map((item) => (
                  <div key={item} className="rounded-xl border border-border-primary bg-bg-tertiary/45 px-4 py-3">
                    <p className="text-sm font-semibold leading-6 text-text-primary">{item}</p>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => navigate(viewModel.coach.actionHref)}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover sm:w-auto"
              >
                {viewModel.coach.actionLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            </article>
          </section>

          {/*
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label="Lịch tập"
              value={hasWorkoutTarget
                ? `${viewModel.workout.completedDays}/${viewModel.workout.targetDays} buổi`
                : `${viewModel.workout.completedDays} buổi`}
              helper={`${formatWholeNumber(viewModel.workout.totalMinutes)} phút vận động, khoảng ${formatWholeNumber(viewModel.workout.totalCalories)} kcal đã đốt.`}
              icon={<Dumbbell className="h-5 w-5" />}
              tone="accent"
              percent={workoutPercent}
              footer={hasWorkoutTarget
                ? <SummaryDelta delta={viewModel.summary.workouts.delta} />
                : <span className="text-xs font-semibold text-text-tertiary">Chưa có mục tiêu tuần</span>}
            />
            <MetricTile
              label={hasNutritionTarget ? 'Ăn đúng plan' : 'Nhật ký ăn uống'}
              value={hasNutritionTarget
                ? `${viewModel.nutrition.daysOnTarget}/${viewModel.summary.nutrition.target} ngày`
                : `${viewModel.nutrition.loggedDays} ngày log`}
              helper={hasNutritionTarget
                ? `Trung bình ${formatWholeNumber(viewModel.nutrition.averageCalories)} / ${formatWholeNumber(viewModel.nutrition.targetCalories)} kcal.`
                : `Trung bình ${formatWholeNumber(viewModel.nutrition.averageCalories)} kcal trong các ngày đã log.`}
              icon={<ClipboardCheck className="h-5 w-5" />}
              tone="info"
              percent={nutritionPercent}
              footer={hasNutritionTarget
                ? <SummaryDelta delta={viewModel.summary.nutrition.delta} />
                : <span className="text-xs font-semibold text-text-tertiary">Thêm mục tiêu kcal để đo bám plan</span>}
            />
            <MetricTile
              label="Protein"
              value={hasProteinTarget
                ? `${formatWholeNumber(viewModel.nutrition.averageProtein)}/${viewModel.nutrition.targetProtein}g`
                : `${formatWholeNumber(viewModel.nutrition.averageProtein)}g`}
              helper="Mốc này ảnh hưởng trực tiếp tới phục hồi, giữ cơ và tốc độ thay đổi vóc dáng."
              icon={<Flame className="h-5 w-5" />}
              tone="warning"
              percent={proteinPercent}
              footer={<span className={`text-xs font-bold ${proteinPercent >= 85 ? 'text-accent' : 'text-warning'}`}>{viewModel.summary.protein.status}</span>}
            />
            <MetricTile
              label="Cân nặng"
              value={weightSummaryValue}
              helper={hasWeightSamples
                ? `${viewModel.weight.sampleCount} lần cập nhật, trạng thái: ${viewModel.weight.status}.`
                : 'Chưa có mốc cân trong giai đoạn này để kết luận kết quả.'}
              icon={<Scale className="h-5 w-5" />}
              tone="ai"
              footer={hasWeightSamples && viewModel.weight.latest !== null
                ? <span className="text-xs font-semibold text-text-tertiary">Hiện tại {formatMetric(viewModel.weight.latest, 1)} kg</span>
                : <span className="text-xs font-semibold text-text-tertiary">Cập nhật body metrics để có xu hướng</span>}
            />
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.9fr]">
            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">{viewModel.habits.title}</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">Quá trình theo từng ngày</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                    Theo dõi nhịp tập, ăn uống, nước, ngủ và check-in để biết kết quả đến từ đâu.
                  </p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warning/10 text-warning">
                  <CalendarDays className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded-[20px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-info/10 text-info">
                    <Droplets className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Nước</p>
                    <p className="text-lg font-black text-text-primary">{waterRow?.value || `0/${viewModel.rangeDays} ngày`}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-[20px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ai/12 text-ai">
                    <Moon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Giấc ngủ</p>
                    <p className="text-lg font-black text-text-primary">{sleepRow?.value || `0/${viewModel.rangeDays} ngày`}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <div className="min-w-[720px] space-y-3">
                  {viewModel.habits.rows.map((row) => (
                    <div
                      key={row.label}
                      className="grid items-center gap-2"
                      style={{ gridTemplateColumns: `160px repeat(${row.cells.length}, minmax(34px, 1fr))` }}
                    >
                      <div className="pr-4">
                        <p className="text-sm font-black text-text-primary">{row.label}</p>
                        <p className="text-xs font-semibold text-text-tertiary">{row.value}</p>
                      </div>
                      {row.cells.map((cell) => (
                        <div key={`${row.label}-${cell.dateKey}`} className="text-center">
                          <div
                            title={`${cell.label} ${cell.dateKey}`}
                            className={`flex h-10 items-center justify-center rounded-2xl border text-xs font-black ${
                              cell.active
                                ? 'border-accent/25 bg-accent/10 text-accent'
                                : 'border-border-primary bg-bg-tertiary/35 text-text-tertiary'
                            }`}
                          >
                            {cell.active ? <CheckCircle2 className="h-4 w-4" /> : '-'}
                          </div>
                          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">{cell.label}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </article>

            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Nhịp tập luyện</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">{viewModel.workout.completedDays} buổi đã xong</h2>
                  <p className="mt-2 text-sm font-semibold text-text-secondary">{viewModel.workout.stripLabel}</p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <Gauge className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
                {viewModel.workout.strip.map((day) => (
                  <div
                    key={day.dateKey}
                    className={`min-h-[94px] rounded-[20px] border px-3 py-3 text-center ${
                      day.completed
                        ? 'border-accent/25 bg-accent/10'
                        : day.planned
                          ? 'border-warning/20 bg-warning/10'
                          : 'border-border-primary bg-bg-tertiary/35'
                    }`}
                  >
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">{day.label}</p>
                    <p className="mt-2 text-lg font-black text-text-primary">{day.dayNumber}</p>
                    <p className={`mt-2 text-xs font-bold ${day.completed ? 'text-accent' : day.planned ? 'text-warning' : 'text-text-tertiary'}`}>
                      {day.completed ? 'Hoàn thành' : day.planned ? 'Có lịch' : 'Nghỉ'}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Nhóm cơ đã tập</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {viewModel.workout.muscleGroups.length > 0 ? (
                    viewModel.workout.muscleGroups.map((group) => (
                      <span
                        key={group.label}
                        className="rounded-full border border-border-primary bg-bg-secondary px-3 py-2 text-xs font-black text-text-primary"
                      >
                        {group.label} {group.count}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm font-semibold text-text-secondary">Chưa có đủ dữ liệu để phân bổ nhóm cơ.</p>
                  )}
                </div>
              </div>
            </article>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Kết quả cân nặng</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">
                    {viewModel.weight.baseline !== null && viewModel.weight.latest !== null
                      ? `${formatMetric(viewModel.weight.baseline, 1)} → ${formatMetric(viewModel.weight.latest, 1)} kg`
                      : 'Chưa có xu hướng rõ'}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-text-secondary">{viewModel.weight.helper}</p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-info/10 text-info">
                  <Scale className="h-5 w-5" />
                </span>
              </div>

              {hasWeightTrend ? (
                <div className="mt-5 h-[270px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={viewModel.weight.chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={18}
                      />
                      <YAxis
                        tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        domain={['dataMin - 1', 'dataMax + 1']}
                      />
                      <Tooltip content={<WeightTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="weight"
                        stroke="var(--warning-primary)"
                        strokeWidth={3}
                        dot={{ fill: 'var(--warning-primary)', r: 3 }}
                        activeDot={{ r: 5 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : hasWeightSamples ? (
                <div className="mt-5">
                  <EmptyMetricState
                    title="Mới có một mốc cân nặng trong giai đoạn này"
                    body="Cập nhật thêm 1-2 lần nữa để biết cân nặng đang đi nhanh, chậm hay đúng hướng."
                  />
                </div>
              ) : (
                <div className="mt-5">
                  <EmptyMetricState
                    title="Chưa có dữ liệu cân nặng"
                    body="Thêm body metrics để trang tiến độ có thể so sánh kết quả thực tế với quá trình tập và ăn."
                  />
                </div>
              )}
            </article>

            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Kết quả dinh dưỡng</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">
                    {hasNutritionTarget
                      ? `${formatWholeNumber(viewModel.nutrition.averageCalories)} / ${formatWholeNumber(viewModel.nutrition.targetCalories)} kcal`
                      : `${formatWholeNumber(viewModel.nutrition.averageCalories)} kcal`}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-text-secondary">
                    {hasProteinTarget
                      ? `Protein ${formatWholeNumber(viewModel.nutrition.averageProtein)} / ${viewModel.nutrition.targetProtein}g · ${viewModel.nutrition.daysOnTarget} ngày trong mục tiêu`
                      : `Protein trung bình ${formatWholeNumber(viewModel.nutrition.averageProtein)}g · ${viewModel.nutrition.loggedDays} ngày đã log`}
                  </p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-info/10 text-info">
                  <Utensils className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-5 h-[270px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={viewModel.nutrition.chart} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={14}
                    />
                    <YAxis
                      tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip content={<NutritionTooltip />} />
                    <Bar dataKey="calories" radius={[10, 10, 0, 0]}>
                      {viewModel.nutrition.chart.map((entry) => (
                        <Cell
                          key={entry.dateKey}
                          fill={entry.calories === 0 ? 'rgba(148,163,184,0.22)' : entry.inTarget ? 'var(--accent-primary)' : 'var(--warning-primary)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <article className="progress-coach-panel rounded-[28px] border border-border-primary p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">AI Coach nhận xét</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">{viewModel.coach.title}</h2>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ai/12 text-ai">
                  <Brain className="h-5 w-5" />
                </span>
              </div>
              <p className="mt-5 text-sm font-semibold leading-7 text-text-secondary">{viewModel.coach.body}</p>
              <button
                type="button"
                onClick={() => navigate(viewModel.coach.actionHref)}
                className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
              >
                {viewModel.coach.actionLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            </article>

            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Điểm mạnh và bước tiếp theo</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">{viewModel.actions.title}</h2>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warning/10 text-warning">
                  <Medal className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Điểm mạnh</p>
                  <div className="mt-3 grid gap-2">
                    {(viewModel.score.strengths.length > 0 ? viewModel.score.strengths : ['Bạn đã bắt đầu tạo được dữ liệu để theo dõi tiến độ.']).map((item) => (
                      <div key={item} className="flex items-start gap-2 text-sm font-semibold text-text-primary">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Cần chỉnh</p>
                  <div className="mt-3 grid gap-2">
                    {(viewModel.score.improvements.length > 0 ? viewModel.score.improvements : ['Tiếp tục log đều thêm vài ngày để nhìn ra điểm cần chỉnh rõ hơn.']).map((item) => (
                      <div key={item} className="flex items-start gap-2 text-sm font-semibold text-text-primary">
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                {viewModel.actions.items.map((item, index) => (
                  <div key={item} className="flex items-start gap-3 rounded-[22px] border border-border-primary bg-bg-tertiary/45 px-4 py-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-black text-text-inverse">
                      {index + 1}
                    </span>
                    <p className="text-sm font-semibold leading-6 text-text-primary">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => navigate(viewModel.actions.primaryHref)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
                >
                  {viewModel.actions.primaryLabel}
                  <Sparkles className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate(viewModel.actions.secondaryHref)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border-primary bg-bg-tertiary px-5 text-sm font-black text-text-primary transition-colors hover:border-info/40 hover:text-info"
                >
                  {viewModel.actions.secondaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </article>
          </section>
          <section className="hidden grid grid-cols-1 gap-4 xl:grid-cols-[1.65fr_1fr]">
            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Tổng kết {viewModel.filterLabel}</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">Những gì đang thật sự diễn ra</h2>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warning/10 text-warning">
                  <TrendingUp className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Tập luyện</p>
                  <p className="mt-3 text-2xl font-black text-text-primary">
                    {hasWorkoutTarget
                      ? `${viewModel.summary.workouts.completed}/${viewModel.summary.workouts.target}`
                      : `${viewModel.summary.workouts.completed} buổi`}
                  </p>
                  <div className="mt-2">
                    {hasWorkoutTarget ? (
                      <SummaryDelta delta={viewModel.summary.workouts.delta} />
                    ) : (
                      <span className="text-xs font-semibold text-text-tertiary">Chưa có mục tiêu tuần</span>
                    )}
                  </div>
                </div>

                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">
                    {hasNutritionTarget ? 'Ăn đúng plan' : 'Ăn uống'}
                  </p>
                  <p className="mt-3 text-2xl font-black text-text-primary">
                    {hasNutritionTarget
                      ? `${viewModel.summary.nutrition.completed}/${viewModel.summary.nutrition.target}`
                      : `${viewModel.summary.nutrition.loggedDays} ngày log`}
                  </p>
                  <div className="mt-2">
                    {hasNutritionTarget ? (
                      <SummaryDelta delta={viewModel.summary.nutrition.delta} />
                    ) : (
                      <span className="text-xs font-semibold text-text-tertiary">Thêm mục tiêu kcal để đo adherence</span>
                    )}
                  </div>
                </div>

                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Protein</p>
                  <p className="mt-3 text-2xl font-black text-text-primary">
                    {hasProteinTarget
                      ? `${formatWholeNumber(viewModel.summary.protein.average)}/${viewModel.summary.protein.target}g`
                      : `${formatWholeNumber(viewModel.summary.protein.average)}g`}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-text-secondary">{viewModel.summary.protein.status}</p>
                </div>

                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Cân nặng</p>
                  <p className="mt-3 text-2xl font-black text-text-primary">{formatSignedKg(viewModel.summary.weight.delta)}</p>
                  <p className="mt-2 text-xs font-semibold text-text-secondary">{viewModel.summary.weight.status}</p>
                </div>
              </div>
            </article>

            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">AI Coach nhận xét</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">{viewModel.coach.title}</h2>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ai/12 text-ai">
                  <Brain className="h-5 w-5" />
                </span>
              </div>

              <p className="mt-5 text-sm font-semibold leading-7 text-text-secondary">{viewModel.coach.body}</p>

              <button
                type="button"
                onClick={() => navigate(viewModel.coach.actionHref)}
                className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
              >
                {viewModel.coach.actionLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            </article>
          </section>

          <section className="hidden grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Cân nặng</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">
                    {viewModel.weight.baseline !== null && viewModel.weight.latest !== null
                      ? `${formatMetric(viewModel.weight.baseline, 1)} -> ${formatMetric(viewModel.weight.latest, 1)} kg`
                      : 'Xu hướng body metrics'}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-text-secondary">{viewModel.weight.helper}</p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-info/10 text-info">
                  <Scale className="h-5 w-5" />
                </span>
              </div>

              {hasWeightSamples ? (
                <div className="mt-6 h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={viewModel.weight.chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={18}
                      />
                      <YAxis
                        tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        domain={['dataMin - 1', 'dataMax + 1']}
                      />
                      <Tooltip content={<WeightTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="weight"
                        stroke="var(--warning-primary)"
                        strokeWidth={3}
                        dot={{ fill: 'var(--warning-primary)', r: 3 }}
                        activeDot={{ r: 5 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="mt-6 flex h-[280px] items-center justify-center rounded-[24px] border border-dashed border-border-primary bg-bg-tertiary/35 px-6 text-center">
                  <div>
                    <p className="text-sm font-black text-text-primary">Chưa có dữ liệu cân nặng trong giai đoạn này</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                      Cập nhật thêm 1-2 lần đo để biểu đồ hiển thị xu hướng rõ ràng hơn.
                    </p>
                  </div>
                </div>
              )}
            </article>

            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Điểm duy trì</p>
                  <h2 className="mt-2 text-5xl font-black text-text-primary">
                    {viewModel.score.value !== null ? viewModel.score.value : '--'}
                    <span className="text-xl text-text-tertiary">/100</span>
                  </h2>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warning/10 text-warning">
                  <Target className="h-5 w-5" />
                </span>
              </div>

              <p className="mt-4 text-sm font-semibold leading-7 text-text-secondary">{viewModel.score.helper}</p>

              <div className="mt-6 grid gap-4">
                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Điểm mạnh</p>
                  <div className="mt-3 grid gap-2">
                    {(viewModel.score.strengths.length > 0 ? viewModel.score.strengths : ['Bạn đã bắt đầu tạo được dữ liệu để theo dõi tiến độ.']).map((item) => (
                      <div key={item} className="flex items-start gap-2 text-sm font-semibold text-text-primary">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Cần cải thiện</p>
                  <div className="mt-3 grid gap-2">
                    {(viewModel.score.improvements.length > 0 ? viewModel.score.improvements : ['Tiếp tục log đều thêm vài ngày để nhìn ra điểm cần chỉnh rõ hơn.']).map((item) => (
                      <div key={item} className="flex items-start gap-2 text-sm font-semibold text-text-primary">
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Streak</p>
                  <p className="mt-3 text-2xl font-black text-text-primary">{viewModel.summary.streakDays} ngày liên tiếp</p>
                </div>
                {hasWeightSamples && !hasWeightTrend && (
                  <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Body metrics</p>
                    <p className="mt-3 text-sm font-semibold leading-6 text-text-secondary">
                      Hiện mới có một mốc cân nặng trong giai đoạn này, nên chưa thể kết luận xu hướng thay đổi.
                    </p>
                  </div>
                )}
              </div>
            </article>
          </section>

          <section className="hidden grid grid-cols-1 gap-4 lg:grid-cols-2">
            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Tập luyện</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">
                    {viewModel.workout.completedDays} buổi · {formatWholeNumber(viewModel.workout.totalMinutes)} phút · ~{formatWholeNumber(viewModel.workout.totalCalories)} kcal
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-text-secondary">Nhịp tập trong {viewModel.workout.stripLabel.toLowerCase()}</p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <Dumbbell className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {viewModel.workout.strip.map((day) => (
                  <div
                    key={day.dateKey}
                    className={`rounded-[20px] border px-3 py-3 text-center ${
                      day.completed
                        ? 'border-accent/25 bg-accent/10'
                        : day.planned
                          ? 'border-warning/20 bg-warning/10'
                          : 'border-border-primary bg-bg-tertiary/35'
                    }`}
                  >
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">{day.label}</p>
                    <p className="mt-2 text-lg font-black text-text-primary">{day.dayNumber}</p>
                    <p className={`mt-2 text-xs font-bold ${day.completed ? 'text-accent' : day.planned ? 'text-warning' : 'text-text-tertiary'}`}>
                      {day.completed ? 'Hoàn thành' : day.planned ? 'Có lịch' : 'Nghỉ'}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Nhóm cơ đã tập</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {viewModel.workout.muscleGroups.length > 0 ? (
                    viewModel.workout.muscleGroups.map((group) => (
                      <span
                        key={group.label}
                        className="rounded-full border border-border-primary bg-bg-secondary px-3 py-2 text-xs font-black text-text-primary"
                      >
                        {group.label} {group.count}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm font-semibold text-text-secondary">Chưa có đủ dữ liệu để phân bố nhóm cơ.</p>
                  )}
                </div>
              </div>
            </article>

            <article className="rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">Ăn uống</p>
                  <h2 className="mt-2 text-2xl font-black text-text-primary">
                    {hasNutritionTarget
                      ? `${formatWholeNumber(viewModel.nutrition.averageCalories)} / ${formatWholeNumber(viewModel.nutrition.targetCalories)} kcal`
                      : `${formatWholeNumber(viewModel.nutrition.averageCalories)} kcal`}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-text-secondary">
                    {hasProteinTarget
                      ? `Protein: ${formatWholeNumber(viewModel.nutrition.averageProtein)} / ${viewModel.nutrition.targetProtein}g · ${viewModel.nutrition.daysOnTarget} ngày trong mục tiêu`
                      : `Protein trung bình: ${formatWholeNumber(viewModel.nutrition.averageProtein)}g · ${viewModel.nutrition.loggedDays} ngày đã log`}
                  </p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-info/10 text-info">
                  <Utensils className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Calories trung bình</p>
                  <p className="mt-3 text-2xl font-black text-text-primary">
                    {formatWholeNumber(viewModel.nutrition.averageCalories)}
                    <span className="ml-1 text-sm font-bold text-text-tertiary">kcal</span>
                  </p>
                </div>

                <div className="rounded-[22px] border border-border-primary bg-bg-tertiary/45 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Protein trung bình</p>
                  <p className="mt-3 text-2xl font-black text-text-primary">
                    {formatWholeNumber(viewModel.nutrition.averageProtein)}
                    <span className="ml-1 text-sm font-bold text-text-tertiary">g</span>
                  </p>
                </div>
              </div>

              <div className="mt-6 h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={viewModel.nutrition.chart} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={14}
                    />
                    <YAxis
                      tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip content={<NutritionTooltip />} />
                    <Bar dataKey="calories" radius={[10, 10, 0, 0]}>
                      {viewModel.nutrition.chart.map((entry) => (
                        <Cell
                          key={entry.dateKey}
                          fill={entry.calories === 0 ? 'rgba(148,163,184,0.22)' : entry.inTarget ? 'var(--accent-primary)' : 'var(--warning-primary)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="hidden rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">{viewModel.habits.title}</p>
                <h2 className="mt-2 text-2xl font-black text-text-primary">Giữ nhịp quan trọng hơn phân tích quá sâu</h2>
              </div>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warning/10 text-warning">
                <CalendarDays className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-6 overflow-x-auto">
              <div className="min-w-[720px] space-y-3">
                {viewModel.habits.rows.map((row) => (
                  <div
                    key={row.label}
                    className="grid items-center gap-2"
                    style={{ gridTemplateColumns: `180px repeat(${row.cells.length}, minmax(36px, 1fr))` }}
                  >
                    <div className="pr-4">
                      <p className="text-sm font-black text-text-primary">{row.label}</p>
                      <p className="text-xs font-semibold text-text-tertiary">{row.value}</p>
                    </div>
                    {row.cells.map((cell) => (
                      <div key={`${row.label}-${cell.dateKey}`} className="text-center">
                        <div className={`flex h-10 items-center justify-center rounded-2xl border text-xs font-black ${
                          cell.active
                            ? 'border-accent/25 bg-accent/10 text-accent'
                            : 'border-border-primary bg-bg-tertiary/35 text-text-tertiary'
                        }`}>
                          {cell.active ? 'OK' : '-'}
                        </div>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">{cell.label}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="hidden rounded-[28px] border border-border-primary bg-bg-secondary/82 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">{viewModel.actions.title}</p>
                <h2 className="mt-2 text-2xl font-black text-text-primary">Dữ liệu chỉ có giá trị khi nó dẫn đến hành động</h2>
                <div className="mt-5 grid gap-3">
                  {viewModel.actions.items.map((item, index) => (
                    <div key={item} className="flex items-start gap-3 rounded-[22px] border border-border-primary bg-bg-tertiary/45 px-4 py-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-black text-text-inverse">
                        {index + 1}
                      </span>
                      <p className="text-sm font-semibold leading-6 text-text-primary">{item}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid w-full gap-3 lg:max-w-xs">
                <button
                  type="button"
                  onClick={() => navigate(viewModel.actions.primaryHref)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
                >
                  {viewModel.actions.primaryLabel}
                  <Sparkles className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate(viewModel.actions.secondaryHref)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-border-primary bg-bg-tertiary px-5 text-sm font-black text-text-primary transition-colors hover:border-info/40 hover:text-info"
                >
                  {viewModel.actions.secondaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
          */}
        </>
      )}
    </div>
  );
}
