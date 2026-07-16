export type TrainingSafetyLimits = {
  maxTrainingDays?: number | null;
  rpeCap?: number | null;
};

export type TrainingPrescription = {
  weeklyWorkouts: number;
  durationMinutes: number;
  reasonCodes: string[];
};

const normalize = (value: unknown) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const resolveActivityBaseline = (activityLevel: unknown) => {
  const value = normalize(activityLevel);
  if (value === 'sedentary' || value.includes('it van dong') || /\b2\s*(ngay|buoi)/.test(value)) return 2;
  if (value === 'lightly_active' || value.includes('van dong nhe') || /\b3\s*(ngay|buoi)/.test(value)) return 3;
  if (value === 'moderately_active' || value.includes('van dong deu') || /\b4\s*(ngay|buoi)/.test(value)) return 4;
  if (value === 'very_active' || value.includes('van dong nhieu') || /\b[5-6]\s*(ngay|buoi)/.test(value)) return 5;
  return 3;
};

const isBeginner = (experienceLevel: unknown) => {
  const value = normalize(experienceLevel);
  return value.includes('nguoi moi') || value.includes('duoi 6 thang') || value.includes('beginner');
};

/**
 * The only authority for a user's weekly training cadence.  Survey answers are
 * inputs; Groq receives this result but is never allowed to change it.
 */
export const prescribeTrainingSchedule = ({
  activityLevel,
  experienceLevel,
  safety,
}: {
  activityLevel?: unknown;
  experienceLevel?: unknown;
  safety?: TrainingSafetyLimits;
}): TrainingPrescription => {
  const reasonCodes: string[] = [];
  const baseline = resolveActivityBaseline(activityLevel);
  let weeklyWorkouts = baseline;
  let durationMinutes = baseline <= 2 ? 30 : baseline >= 5 ? 60 : 45;

  if (isBeginner(experienceLevel)) {
    if (weeklyWorkouts > 3) reasonCodes.push('beginner_max_3_days');
    weeklyWorkouts = Math.min(weeklyWorkouts, 3);
    durationMinutes = Math.min(durationMinutes, 45);
  }

  if (safety?.maxTrainingDays !== null && safety?.maxTrainingDays !== undefined) {
    if (weeklyWorkouts > safety.maxTrainingDays) reasonCodes.push('health_or_injury_day_cap');
    weeklyWorkouts = Math.min(weeklyWorkouts, safety.maxTrainingDays);
    durationMinutes = Math.min(durationMinutes, 35);
  }

  if (Number(safety?.rpeCap) <= 6) {
    durationMinutes = Math.min(durationMinutes, 35);
    reasonCodes.push('high_risk_low_intensity');
  }

  return {
    weeklyWorkouts: Math.max(2, Math.min(5, Math.round(weeklyWorkouts))),
    durationMinutes: Math.max(20, Math.min(60, Math.round(durationMinutes))),
    reasonCodes,
  };
};
