const normalizeWorkoutLabel = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function resolveWeeklyWorkouts(activityLevel?: string | null, weeklyWorkouts?: number | null): number {
  if (weeklyWorkouts && weeklyWorkouts > 0) return weeklyWorkouts;

  const raw = String(activityLevel || '').trim();
  if (!raw) return 3;

  const normalized = normalizeWorkoutLabel(raw);

  if (/1\s*-\s*2/.test(normalized)) return 2;
  if (/3\s*-\s*4/.test(normalized)) return 4;
  if (/3\s*-\s*5/.test(normalized)) return 4;
  if (/(tren|tr n|over)\s*5/.test(normalized)) return 5;
  if (normalized.includes('chua') && (normalized.includes('tap') || normalized.includes('luyen'))) return 2;

  const numericMatch = normalized.match(/\b([2-6])\b/);
  if (numericMatch) return parseInt(numericMatch[1], 10);

  return 3;
}
