export const WORKOUT_DURATION_TAGS = [15, 30, 45, 60, 90] as const;

export const DEFAULT_WORKOUT_DURATION = '45';

export function normalizeWorkoutDurationTag(raw: string | number | undefined | null): string {
  const n = parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(n) || n <= 0) return DEFAULT_WORKOUT_DURATION;
  if ((WORKOUT_DURATION_TAGS as readonly number[]).includes(n)) return String(n);
  
  // Find the closest tag in the list
  const closest = [...WORKOUT_DURATION_TAGS].reduce((best, cur) =>
    Math.abs(cur - n) < Math.abs(best - n) ? cur : best
  );
  return String(closest);
}
