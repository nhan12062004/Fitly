import { supabase } from '../config/Supabase';
import { prescribeTrainingSchedule, type TrainingPrescription } from '../lib/TrainingPrescription';
import { buildUserSafetyProfile } from './ai/personalizationGuardService';

type ProfileLike = Record<string, unknown> | null | undefined;
type LifestyleLike = Record<string, any> | null | undefined;
type HealthLike = Record<string, unknown> | null | undefined;

export type TrainingProfileContext = {
  profile: Record<string, unknown>;
  lifestyle: Record<string, any>;
  health: Record<string, unknown>;
  safetyContext: {
    profile: Record<string, unknown>;
    lifestyle: Record<string, any>;
    health: Record<string, unknown>;
  };
  trainingPrescription: TrainingPrescription;
};

/** Single normalized workout context for plan generation and AI Coach. */
export const synchronizeTrainingProfileContext = async ({
  userId,
  profile,
  lifestyle,
  health,
}: {
  userId: string;
  profile?: ProfileLike;
  lifestyle?: LifestyleLike;
  health?: HealthLike;
}): Promise<TrainingProfileContext> => {
  const safeProfile = profile || {};
  const safeLifestyle = lifestyle || {};
  const safeHealth = health || {};
  const initialSafetyContext = { profile: safeProfile, lifestyle: safeLifestyle, health: safeHealth };
  const trainingPrescription = prescribeTrainingSchedule({
    activityLevel: safeLifestyle.activity_level,
    experienceLevel: safeLifestyle.experience_level,
    safety: buildUserSafetyProfile(initialSafetyContext),
  });

  const needsSync = Number(safeLifestyle.weekly_workouts) !== trainingPrescription.weeklyWorkouts
    || Number(safeLifestyle.workout_duration) !== trainingPrescription.durationMinutes;
  if (needsSync) {
    const update = await supabase
      .from('lifestyle_settings')
      .update({
        weekly_workouts: trainingPrescription.weeklyWorkouts,
        workout_duration: trainingPrescription.durationMinutes,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (update.error) throw update.error;
  }

  const normalizedLifestyle = {
    ...safeLifestyle,
    weekly_workouts: trainingPrescription.weeklyWorkouts,
    workout_duration: trainingPrescription.durationMinutes,
  };
  return {
    profile: safeProfile,
    lifestyle: normalizedLifestyle,
    health: safeHealth,
    safetyContext: { profile: safeProfile, lifestyle: normalizedLifestyle, health: safeHealth },
    trainingPrescription,
  };
};
