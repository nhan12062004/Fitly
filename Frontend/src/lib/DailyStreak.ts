export const DAILY_STREAK_LOOKBACK_DAYS = 60;

export type DailyStreakStatus = 'completed' | 'pending' | 'empty';

export type DailyStreakState = {
  count: number;
  isTodayCompleted: boolean;
  completedTodayReasons: string[];
  status: DailyStreakStatus;
};

export type StreakWorkoutRow = {
  log_date: string;
  is_completed: boolean | null;
};

export type StreakMealRow = {
  log_date: string;
  is_completed: boolean | null;
};

export type StreakProgressRow = {
  log_date: string;
  water_intake_ml: number | null;
  sleep_hours: number | null;
};

type CalculateDailyStreakInput = {
  todayKey: string;
  waterGoalMl: number | null;
  workouts: StreakWorkoutRow[];
  meals: StreakMealRow[];
  progressLogs: StreakProgressRow[];
};

export const initialDailyStreak: DailyStreakState = {
  count: 0,
  isTodayCompleted: false,
  completedTodayReasons: [],
  status: 'empty',
};

export function addDateKeyDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function getStreakHistoryStartKey(
  todayKey: string,
  totalDays = DAILY_STREAK_LOOKBACK_DAYS,
): string {
  return addDateKeyDays(todayKey, -(Math.max(1, totalDays) - 1));
}

export function calculateDailyStreak({
  todayKey,
  waterGoalMl,
  workouts,
  meals,
  progressLogs,
}: CalculateDailyStreakInput): DailyStreakState {
  const reasonsByDate = new Map<string, Set<string>>();
  const addReason = (dateKey: string, reason: string) => {
    if (!dateKey) return;
    const reasons = reasonsByDate.get(dateKey) || new Set<string>();
    reasons.add(reason);
    reasonsByDate.set(dateKey, reasons);
  };

  workouts.forEach((row) => {
    if (row.is_completed) addReason(row.log_date, 'Tập luyện');
  });
  meals.forEach((row) => {
    if (row.is_completed) addReason(row.log_date, 'Ghi bữa ăn');
  });
  progressLogs.forEach((row) => {
    if (waterGoalMl !== null && Number(row.water_intake_ml || 0) >= Math.max(1, waterGoalMl)) {
      addReason(row.log_date, 'Uống đủ nước');
    }
    if (Number(row.sleep_hours || 0) > 0) {
      addReason(row.log_date, 'Ghi nhận giấc ngủ');
    }
  });

  const completedTodayReasons = [...(reasonsByDate.get(todayKey) || [])];
  const isTodayCompleted = completedTodayReasons.length > 0;
  let cursor = isTodayCompleted ? todayKey : addDateKeyDays(todayKey, -1);
  let count = 0;

  while (reasonsByDate.has(cursor)) {
    count += 1;
    cursor = addDateKeyDays(cursor, -1);
  }

  const hasTrackedData = workouts.length > 0 || meals.length > 0 || progressLogs.length > 0;
  return {
    count,
    isTodayCompleted,
    completedTodayReasons,
    status: isTodayCompleted ? 'completed' : hasTrackedData || count > 0 ? 'pending' : 'empty',
  };
}

export function completeDailyStreakToday(
  current: DailyStreakState,
  reason: string,
): DailyStreakState {
  return {
    count: current.isTodayCompleted ? Math.max(1, current.count) : Math.max(1, current.count + 1),
    isTodayCompleted: true,
    completedTodayReasons: [...new Set([...current.completedTodayReasons, reason])],
    status: 'completed',
  };
}
