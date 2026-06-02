export type KcalExerciseLike = {
  target_muscle?: string | null;
  body_part?: string | null;
};

export const parseRepsInput = (repsValue: string): number => {
  const nums = String(repsValue || '')
    .match(/\d+/g)
    ?.map(Number)
    .filter((n) => !Number.isNaN(n)) || [];
  if (nums.length === 0) return 10;
  if (nums.length === 1) return nums[0];
  return Math.round((nums[0] + nums[nums.length - 1]) / 2);
};

export const inferBaseMet = (exercise?: KcalExerciseLike | null): number => {
  const target = String(exercise?.target_muscle || '').toLowerCase();
  const bodyPart = String(exercise?.body_part || '').toLowerCase();
  const key = `${target} ${bodyPart}`;
  if (key.includes('cardio')) return 7.3;
  if (key.includes('leg') || key.includes('glute') || key.includes('thigh')) return 6.8;
  if (key.includes('back')) return 6.4;
  if (key.includes('chest')) return 6.2;
  if (key.includes('shoulder')) return 6.0;
  if (key.includes('arm') || key.includes('bicep') || key.includes('tricep')) return 5.6;
  if (key.includes('abs') || key.includes('core')) return 5.4;
  return 5.9;
};

export const estimateExerciseKcalRealistic = ({
  exercise,
  sets,
  repsText,
  externalLoadKg,
  userWeightKg,
  restSeconds = 60
}: {
  exercise?: KcalExerciseLike | null;
  sets: number;
  repsText: string;
  externalLoadKg: number;
  userWeightKg: number;
  restSeconds?: number;
}): number => {
  const safeSets = Math.max(1, Number(sets) || 1);
  const reps = Math.max(1, parseRepsInput(repsText));
  const loadKg = Math.max(0, Number(externalLoadKg) || 0);
  const bw = Math.max(40, Number(userWeightKg) || 70);

  const secondsPerRep = loadKg > 0 ? 3.2 : 2.6;
  const workSeconds = safeSets * reps * secondsPerRep;
  const rest = Math.max(0, Number(restSeconds) || 0);
  const pauseSeconds = Math.max(0, safeSets - 1) * rest;
  const totalMinutes = Math.max(1, (workSeconds + pauseSeconds) / 60);

  const baseMet = inferBaseMet(exercise);
  const relativeLoad = loadKg / bw;
  const intensityFactor = Math.min(1.35, Math.max(0.9, 0.95 + relativeLoad * 1.2));
  const densityFactor = Math.min(1.2, Math.max(0.9, 0.9 + (workSeconds / (workSeconds + pauseSeconds + 1)) * 0.35));
  const adjustedMet = baseMet * intensityFactor * densityFactor;

  const baseKcal = (adjustedMet * 3.5 * bw / 200) * totalMinutes;
  const epocBonus = baseKcal * (adjustedMet >= 6.3 ? 0.08 : 0.04);
  return Math.round(Math.min(500, Math.max(6, baseKcal + epocBonus)));
};
