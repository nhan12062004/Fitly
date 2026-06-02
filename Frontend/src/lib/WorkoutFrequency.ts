export const WORKOUT_FREQUENCY_OPTIONS = [
  { value: '2 ngày/tuần', days: 2, label: '2 ngày/tuần' },
  { value: '3 ngày/tuần', days: 3, label: '3 ngày/tuần' },
  { value: '4 ngày/tuần', days: 4, label: '4 ngày/tuần' },
  { value: '5 ngày/tuần', days: 5, label: '5 ngày/tuần' },
  { value: '6 ngày/tuần', days: 6, label: '6 ngày/tuần' },
] as const;

export const DEFAULT_WORKOUT_FREQUENCY = '3 ngày/tuần';

const LEGACY_FREQUENCY_MAP: Record<string, string> = {
  'Chưa tập luyện': '2 ngày/tuần',
  '1-2 buổi/tuần': '2 ngày/tuần',
  '3-4 buổi/tuần': '4 ngày/tuần',
  'Trên 5 buổi/tuần': '5 ngày/tuần',
  'Vừa phải (Tập luyện 3-5 ngày/tuần)': '4 ngày/tuần',
};

export function weeklyWorkoutsToFrequency(days: number | null | undefined): string {
  const match = WORKOUT_FREQUENCY_OPTIONS.find((option) => option.days === days);
  return match?.value || DEFAULT_WORKOUT_FREQUENCY;
}

export function normalizeWorkoutFrequency(raw: string | undefined | null): string {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT_WORKOUT_FREQUENCY;
  if (LEGACY_FREQUENCY_MAP[value]) return LEGACY_FREQUENCY_MAP[value];
  if (WORKOUT_FREQUENCY_OPTIONS.some((option) => option.value === value)) return value;
  return DEFAULT_WORKOUT_FREQUENCY;
}

export function workoutFrequencyToWeeklyWorkouts(frequency: string | undefined | null): number {
  const normalized = normalizeWorkoutFrequency(frequency);
  const match = WORKOUT_FREQUENCY_OPTIONS.find((option) => option.value === normalized);
  return match?.days ?? 3;
}
