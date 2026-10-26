import { adminSupabase } from '../../config/Supabase';
import type { RequestHandler } from 'express';

export const createWorkoutHandlers = (dependencies: any) => {
  const { supabase, getAuthUserId, DATE_KEY_REGEX, DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT, addDaysToDateKey, getDayOffsetBetweenDateKeys, buildExerciseEligibilityContext, getExerciseEligibilityDecision, getLatestBodyWeightKg, estimateWorkoutKcal, buildDailyExerciseSessionRow, ApiRequestError, isDatabaseMigrationRequiredError, databaseMigrationRequiredResponse, ExternalProviderError, getAiCoachAccessState, buildAiQuotaLimitError, AI_EXERCISE_CATALOG_FETCH_LIMIT, normalizeKeywordText, getEligibleExercises, prescribeWorkoutExercise, recordAiQuotaUsage, buildAiQuotaSnapshot, truncateText, getExerciseMetaForKcal, loadDailyExerciseSessionWithExerciseMeta, upsertWorkoutSessionExerciseFromDailySession, syncWorkoutCaloriesBurnedForDate, calculateCompletedExerciseKcal, parseAverageReps } = dependencies;
const materializeDailyExercisesFromPlan: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const logDate = String(req.body?.logDate || '').trim();
    if (!DATE_KEY_REGEX.test(logDate)) {
      return res.status(400).json({ error: 'logDate must be YYYY-MM-DD' });
    }

    const existingDailyRes = await supabase
      .from('daily_exercise_sessions')
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('order_index', { ascending: true });
    if (existingDailyRes.error) throw existingDailyRes.error;
    if ((existingDailyRes.data || []).length > 0) {
      return res.json({
        exercises: existingDailyRes.data || [],
        workoutSessionId: null,
        source: 'existing'
      });
    }

    const planRes = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, created_at, updated_at')
      .eq('user_id', authUserId)
      .gte('week_start_date', addDaysToDateKey(logDate, -6))
      .lte('week_start_date', logDate)
      .eq('plan_status', 'active')
      .limit(20);
    if (planRes.error) throw planRes.error;

    const plan = [...((planRes.data || []) as any[])]
      .filter((item) => {
        const planStartKey = String(item.week_start_date || '');
        const dayOffset = getDayOffsetBetweenDateKeys(planStartKey, logDate);
        return DATE_KEY_REGEX.test(planStartKey) && dayOffset >= 0 && dayOffset <= 6;
      })
      .sort((a, b) => {
        const startComparison = String(b.week_start_date || '').localeCompare(String(a.week_start_date || ''));
        return startComparison || new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
      })[0];
    if (!plan?.id) {
      return res.json({
        exercises: [],
        workoutSessionId: null,
        weeklyPlanId: null,
        source: 'no_plan'
      });
    }

    const dayIndex = getDayOffsetBetweenDateKeys(String(plan.week_start_date), logDate);

    const planExercisesRes = await supabase
      .from('weekly_plan_exercises')
      .select(`
        *,
        exercises:exercise_id (id, name, video_url, target_muscle, body_part, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, movement_pattern, goal_type, contraindications, instructions, calories_per_minute)
      `)
      .eq('weekly_plan_id', plan.id)
      .eq('day_of_week', dayIndex)
      .order('order_index', { ascending: true });
    if (planExercisesRes.error) throw planExercisesRes.error;

    const planExercises = (planExercisesRes.data || []).filter((item: any) => item.exercise_id && !item.is_rest_day);
    if (planExercises.length === 0) {
      return res.json({
        exercises: [],
        workoutSessionId: null,
        weeklyPlanId: plan.id,
        source: 'rest_day'
      });
    }

    const [profileRes, lifestyleRes, healthRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle(),
    ]);
    const eligibilityDataError = [profileRes.error, lifestyleRes.error, healthRes.error].find(Boolean);
    if (eligibilityDataError) throw eligibilityDataError;
    const eligibilityContext = buildExerciseEligibilityContext({
      profile: profileRes.data || null,
      lifestyle: lifestyleRes.data || null,
      health: healthRes.data || null,
    });
    const ineligiblePlanExercises = planExercises
      .map((item: any) => ({
        exerciseId: String(item.exercise_id || ''),
        decision: getExerciseEligibilityDecision(item.exercises || { id: item.exercise_id }, eligibilityContext),
      }))
      .filter(({ decision }: any) => !decision.eligible);
    if (ineligiblePlanExercises.length > 0) {
      return res.status(422).json({
        error: 'Weekly plan includes an exercise that is no longer eligible for the current profile.',
        details: ineligiblePlanExercises.map(({ exerciseId, decision }: any) => ({
          exerciseId,
          reasons: decision.reasons,
        })),
      });
    }

    const bodyWeightKg = await getLatestBodyWeightKg(authUserId);
    const rows = planExercises.map((item: any, index: number) => {
      const plannedSets = Math.max(1, Math.min(8, Number(item.planned_sets ?? item.sets) || 3));
      const plannedReps = truncateText(item.planned_reps ?? item.reps ?? '10-12', 20) || '10-12';
      const rawWeightKg = item.planned_weight_kg ?? item.weight_kg;
      const plannedWeightKg =
        rawWeightKg === null || rawWeightKg === undefined || String(rawWeightKg).trim() === ''
          ? null
          : Math.max(0, Number(rawWeightKg) || 0);
      const plannedRestSeconds = Math.max(30, Math.min(300, Number(item.planned_rest_seconds ?? item.rest_seconds) || 60));
      const plannedKcal = Math.max(0, Number(item.estimated_kcal) || 0);
      const estimatedKcal = plannedKcal > 0
        ? plannedKcal
        : estimateWorkoutKcal({
            exercise: item.exercises,
            bodyWeightKg,
            sets: plannedSets,
            repsText: plannedReps,
            weightKg: plannedWeightKg ?? 0,
            restSeconds: plannedRestSeconds
          });

      return buildDailyExerciseSessionRow({
        userId: authUserId,
        logDate,
        exerciseId: String(item.exercise_id),
        orderIndex: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : index,
        weeklyPlanExerciseId: item.id || null,
        plannedSets,
        plannedReps,
        plannedWeightKg,
        plannedRestSeconds,
        targetRpe: item.target_rpe ?? 7,
        estimatedKcal,
        loadAdjustmentNote: String(item.load_instruction || item.ai_note || '').slice(0, 160) || null
      });
    });

    const materializeRes = await adminSupabase.rpc('materialize_daily_workout_from_plan_atomically', {
      p_user_id: authUserId,
      p_weekly_plan_id: plan.id,
      p_log_date: logDate,
      p_rows: rows,
    });
    if (materializeRes.error) {
      const message = materializeRes.error.message || 'Failed to materialize daily workout';
      if (/already started|already completed|active workout plan not found|invalid plan exercise|plan exercise no longer exists/i.test(message)) {
        return res.status(409).json({ error: message });
      }
      throw materializeRes.error;
    }

    const materializeResult = materializeRes.data as {
      already_materialized?: boolean;
      daily_workout_session_id?: string | null;
    } | null;
    const dailyRowsRes = await supabase
      .from('daily_exercise_sessions')
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('order_index', { ascending: true });
    if (dailyRowsRes.error) throw dailyRowsRes.error;
    const dailyRows = dailyRowsRes.data || [];
    const workoutSessionId = String(materializeResult?.daily_workout_session_id || '').trim() || null;

    return res.json({
      exercises: dailyRows,
      workoutSessionId,
      weeklyPlanId: plan.id,
      source: materializeResult?.already_materialized ? 'existing' : 'weekly_plan'
    });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/create-daily-exercises-from-plan] failed:');
    if (isDatabaseMigrationRequiredError(error)) {
      return res.status(503).json(databaseMigrationRequiredResponse);
    }
    return next(new ExternalProviderError());
  }
};

const replaceDailyExercise: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) return res.status(401).json({ error: 'Unauthorized' });

    const exerciseSessionId = String(req.params.exerciseSessionId || '').trim();
    if (!exerciseSessionId) return res.status(400).json({ error: 'exercise session id is required' });

    const currentSessionRes = await supabase
      .from('daily_exercise_sessions')
      .select('id, user_id, log_date, exercise_id, order_index, sets, reps, weight_kg, rest_seconds, planned_sets, planned_reps, planned_weight_kg, planned_rest_seconds, actual_sets, actual_reps, actual_weight_kg, actual_rest_seconds, target_rpe, is_completed, completed_sets')
      .eq('id', exerciseSessionId)
      .eq('user_id', authUserId)
      .maybeSingle();
    if (currentSessionRes.error) throw currentSessionRes.error;
    const currentSession = currentSessionRes.data;
    if (!currentSession) return res.status(404).json({ error: 'Exercise session not found' });
    if (currentSession.is_completed || Number(currentSession.completed_sets || 0) > 0) {
      return res.status(409).json({ error: 'Không thể đổi bài đã bắt đầu hoặc hoàn thành.' });
    }

    const [profileRes, lifestyleRes, healthRes, sameDayRes, catalogRes] = await Promise.all([
      supabase.from('profiles').select('id, gender, birthday, membership_tier, membership_expires_at, created_at').eq('id', authUserId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('daily_exercise_sessions').select('exercise_id').eq('user_id', authUserId).eq('log_date', currentSession.log_date),
      supabase.from('exercises').select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern').limit(AI_EXERCISE_CATALOG_FETCH_LIMIT),
    ]);
    const dataError = [profileRes.error, lifestyleRes.error, healthRes.error, sameDayRes.error, catalogRes.error].find(Boolean);
    if (dataError) throw dataError;

    const accessState = await getAiCoachAccessState(profileRes.data || {}, authUserId);
    if (!accessState.canUseWorkoutAdjustment) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'workoutAdjustments'));
    }

    const sourceExercise = (catalogRes.data || []).find((exercise: any) => String(exercise.id) === String(currentSession.exercise_id));
    if (!sourceExercise) return res.status(404).json({ error: 'Original exercise is no longer in the catalog.' });

    const eligibilityContext = buildExerciseEligibilityContext({
      profile: profileRes.data || null,
      lifestyle: lifestyleRes.data || null,
      health: healthRes.data || null,
    });
    const occupiedExerciseIds = new Set((sameDayRes.data || []).map((item: any) => String(item.exercise_id || '')).filter(Boolean));
    const sourceTarget = normalizeKeywordText(sourceExercise.target_muscle);
    const sourceBodyPart = normalizeKeywordText(sourceExercise.body_part);
    const sourceMovement = normalizeKeywordText(sourceExercise.movement_pattern);
    const candidate = getEligibleExercises(catalogRes.data as unknown[], eligibilityContext)
      .filter((exercise: any) => !occupiedExerciseIds.has(String(exercise.id)))
      .map((exercise: any) => {
        const sameTarget = sourceTarget && normalizeKeywordText(exercise.target_muscle) === sourceTarget;
        const sameBodyPart = sourceBodyPart && normalizeKeywordText(exercise.body_part) === sourceBodyPart;
        const sameMovement = sourceMovement && normalizeKeywordText(exercise.movement_pattern) === sourceMovement;
        return { exercise, score: (sameTarget ? 100 : 0) + (sameBodyPart ? 20 : 0) + (sameMovement ? 8 : 0) };
      })
      .filter(({ score }: any) => score > 0)
      .sort((a: any, b: any) => b.score - a.score || String(a.exercise.name || '').localeCompare(String(b.exercise.name || '')))[0]?.exercise;
    if (!candidate) {
      return res.status(422).json({ error: 'Không tìm thấy bài thay thế cùng nhóm cơ, an toàn và không trùng trong buổi này.' });
    }

    const prescription = await prescribeWorkoutExercise({
      userId: authUserId,
      exerciseId: String(candidate.id),
      exercise: candidate,
      source: 'manual_add',
      suggestedSets: currentSession.actual_sets ?? currentSession.planned_sets ?? currentSession.sets,
      suggestedReps: currentSession.actual_reps ?? currentSession.planned_reps ?? currentSession.reps,
      suggestedWeightKg: currentSession.actual_weight_kg ?? currentSession.planned_weight_kg ?? currentSession.weight_kg,
      suggestedRestSeconds: currentSession.actual_rest_seconds ?? currentSession.planned_rest_seconds ?? currentSession.rest_seconds,
      suggestedTargetRpe: currentSession.target_rpe,
    });

    const updateValues = {
      exercise_id: String(candidate.id),
      sets: prescription.sets,
      reps: prescription.reps,
      weight_kg: prescription.weightKg,
      rest_seconds: prescription.restSeconds,
      planned_sets: prescription.sets,
      planned_reps: prescription.reps,
      planned_weight_kg: prescription.weightKg,
      planned_rest_seconds: prescription.restSeconds,
      actual_sets: prescription.sets,
      actual_reps: prescription.reps,
      actual_weight_kg: prescription.weightKg,
      actual_rest_seconds: prescription.restSeconds,
      target_rpe: prescription.targetRpe,
      estimated_kcal: prescription.estimatedKcal,
      actual_kcal_estimated: 0,
      completed_sets: 0,
      is_completed: false,
      load_adjustment_note: prescription.loadInstruction,
    };
    const updateRes = await supabase
      .from('daily_exercise_sessions')
      .update(updateValues)
      .eq('id', currentSession.id)
      .eq('user_id', authUserId)
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .single();
    if (updateRes.error) throw updateRes.error;

    const snapshotRes = await supabase
      .from('daily_workout_session_exercises')
      .update({
        exercise_id: String(candidate.id),
        sets: prescription.sets,
        reps: prescription.reps,
        weight_kg: prescription.weightKg,
        rest_seconds: prescription.restSeconds,
        planned_sets: prescription.sets,
        planned_reps: prescription.reps,
        planned_weight_kg: prescription.weightKg,
        planned_rest_seconds: prescription.restSeconds,
        actual_sets: prescription.sets,
        actual_reps: prescription.reps,
        actual_weight_kg: prescription.weightKg,
        actual_rest_seconds: prescription.restSeconds,
        target_rpe: prescription.targetRpe,
        estimated_kcal: prescription.estimatedKcal,
        actual_kcal_estimated: 0,
        completed_sets: 0,
        is_completed: false,
      })
      .eq('daily_exercise_session_id', currentSession.id);
    if (snapshotRes.error) throw snapshotRes.error;

    const auditRes = await adminSupabase.from('ai_plan_adjustments').insert({
      user_id: authUserId,
      plan_type: 'workout',
      source_type: 'chat',
      source_id: currentSession.id,
      old_data: { log_date: currentSession.log_date, exercise_id: currentSession.exercise_id },
      new_data: { log_date: currentSession.log_date, exercise_id: candidate.id },
      reason: `Quick exercise replacement: ${sourceExercise.name} -> ${candidate.name}`.slice(0, 300),
      created_by: 'ai',
      status: 'applied',
      applied_at: new Date().toISOString(),
    });
    if (auditRes.error) throw auditRes.error;
    void recordAiQuotaUsage(authUserId, 'workoutAdjustments').catch(() => null);

    return res.json({
      success: true,
      exercise: updateRes.data,
      replacedExerciseName: sourceExercise.name,
      aiQuota: buildAiQuotaSnapshot(accessState, 'workoutAdjustments'),
    });
  } catch (error: any) {
    console.error('[workout/replace-daily-exercise] failed:');
    return next(new ExternalProviderError());
  }
};

const createDailyExercise: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const logDate = String(req.body?.logDate || '').trim();
    const exerciseId = String(req.body?.exerciseId || '').trim();
    if (!DATE_KEY_REGEX.test(logDate)) {
      return res.status(400).json({ error: 'logDate must be YYYY-MM-DD' });
    }
    if (!exerciseId) {
      return res.status(400).json({ error: 'exerciseId is required' });
    }

    const defaultSets = Math.max(1, Math.min(6, Number(req.body?.sets) || 3));
    const defaultReps = truncateText(req.body?.reps || '12', 20) || '12';
    const rawWeightKg = req.body?.weightKg;
    const defaultRestSeconds = Math.max(0, Math.min(300, Number(req.body?.restSeconds) || 60));
    const targetRpe = Math.max(5, Math.min(10, Number(req.body?.targetRpe) || 7));

    let orderIndex = Number(req.body?.orderIndex);
    if (!Number.isFinite(orderIndex)) {
      const latestOrderRes = await supabase
        .from('daily_exercise_sessions')
        .select('order_index')
        .eq('user_id', authUserId)
        .eq('log_date', logDate)
        .order('order_index', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestOrderRes.error) throw latestOrderRes.error;
      orderIndex = Number(latestOrderRes.data?.order_index ?? -1) + 1;
    }

    const [exerciseMeta, profileRes, lifestyleRes, healthRes] = await Promise.all([
      getExerciseMetaForKcal(exerciseId),
      supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle(),
    ]);
    const eligibilityDataError = [profileRes.error, lifestyleRes.error, healthRes.error].find(Boolean);
    if (eligibilityDataError) throw eligibilityDataError;

    const safetyContext = {
      profile: profileRes.data || {},
      lifestyle: lifestyleRes.data || {},
      health: healthRes.data || {},
    };
    const eligibilityContext = {
      ...buildExerciseEligibilityContext(safetyContext),
      safetyContext,
    };
    const eligibility = getExerciseEligibilityDecision(exerciseMeta, eligibilityContext);
    if (!eligibility.eligible) {
      throw new ApiRequestError(422, {
        error: 'Exercise is not eligible for the current profile.',
        code: 'EXERCISE_NOT_ELIGIBLE',
        reasons: eligibility.reasons,
      });
    }

    const hasManualWeight = !(rawWeightKg === null || rawWeightKg === undefined || String(rawWeightKg).trim() === '');
    const prescription = await prescribeWorkoutExercise({
      userId: authUserId,
      exerciseId,
      exercise: exerciseMeta,
      source: 'manual_add',
      suggestedSets: defaultSets,
      suggestedReps: defaultReps,
      suggestedWeightKg: rawWeightKg,
      suggestedRestSeconds: defaultRestSeconds,
      suggestedTargetRpe: targetRpe,
      forceManualWeight: hasManualWeight
    });

    const insertRes = await supabase
      .from('daily_exercise_sessions')
      .insert(
        buildDailyExerciseSessionRow({
          userId: authUserId,
          logDate,
          exerciseId,
          orderIndex,
          weeklyPlanExerciseId: null,
          plannedSets: prescription.sets,
          plannedReps: prescription.reps,
          plannedWeightKg: prescription.weightKg,
          plannedRestSeconds: prescription.restSeconds,
          targetRpe: prescription.targetRpe,
          estimatedKcal: prescription.estimatedKcal,
          loadAdjustmentNote: hasManualWeight ? null : 'Tạ khởi điểm được hệ thống đề xuất tự động. Hãy giảm nếu mất form hoặc tăng nếu còn quá nhẹ.'
        })
      )
      .select('id')
      .single();
    if (insertRes.error) throw insertRes.error;

    const dailyExerciseSession = await loadDailyExerciseSessionWithExerciseMeta(String(insertRes.data.id), authUserId);
    await upsertWorkoutSessionExerciseFromDailySession({
      userId: authUserId,
      logDate,
      dailyExerciseSession
    });
    return res.json({ exercise: dailyExerciseSession });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/create-daily-exercise] failed:');
    return next(new ExternalProviderError());
  }
};

const updateDailyExerciseConfig: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const exerciseSessionId = String(req.params.exerciseSessionId || '').trim();
    if (!exerciseSessionId) {
      return res.status(400).json({ error: 'exerciseSessionId is required' });
    }

    const existingSession = await loadDailyExerciseSessionWithExerciseMeta(exerciseSessionId, authUserId);
    const nextSets = Math.max(1, Math.min(6, Number(req.body?.sets) || 1));
    const nextReps = truncateText(req.body?.reps || '12', 20) || '12';
    const rawWeightKg = req.body?.weightKg;
    const nextWeightKg =
      rawWeightKg === null || rawWeightKg === undefined || String(rawWeightKg).trim() === ''
        ? null
        : Math.max(0, Number(rawWeightKg) || 0);
    const nextRestSeconds = Math.max(0, Math.min(300, Number(req.body?.restSeconds) || 0));
    const nextCompletedSetCount = Math.min(nextSets, Math.max(0, Number(existingSession.completed_sets) || 0));
    const nextIsCompleted = nextCompletedSetCount >= nextSets;

    const [bodyWeightKg, exerciseMeta] = await Promise.all([
      getLatestBodyWeightKg(authUserId),
      getExerciseMetaForKcal(String(existingSession.exercise_id || ''))
    ]);
    const estimatedKcal = estimateWorkoutKcal({
      exercise: exerciseMeta,
      bodyWeightKg,
      sets: nextSets,
      repsText: nextReps,
      weightKg: nextWeightKg ?? 0,
      restSeconds: nextRestSeconds
    });
    const nextActualKcal = nextCompletedSetCount > 0
      ? estimateWorkoutKcal({
          exercise: exerciseMeta,
          bodyWeightKg,
          sets: nextCompletedSetCount,
          repsText: nextReps,
          weightKg: nextWeightKg ?? 0,
          restSeconds: nextRestSeconds,
        })
      : 0;

    const updateRes = await supabase
      .from('daily_exercise_sessions')
      .update({
        sets: nextSets,
        reps: nextReps,
        weight_kg: nextWeightKg,
        rest_seconds: nextRestSeconds,
        is_completed: nextIsCompleted,
        actual_sets: nextSets,
        actual_reps: nextReps,
        actual_weight_kg: nextWeightKg,
        actual_rest_seconds: nextRestSeconds,
        estimated_kcal: estimatedKcal,
        actual_kcal_estimated: nextActualKcal,
        completed_sets: nextCompletedSetCount
      })
      .eq('id', exerciseSessionId)
      .eq('user_id', authUserId)
      .select('id')
      .single();
    if (updateRes.error) throw updateRes.error;

    const updatedSession = await loadDailyExerciseSessionWithExerciseMeta(exerciseSessionId, authUserId);
    await upsertWorkoutSessionExerciseFromDailySession({
      userId: authUserId,
      logDate: String(updatedSession.log_date || ''),
      dailyExerciseSession: updatedSession
    });
    await syncWorkoutCaloriesBurnedForDate(authUserId, String(updatedSession.log_date || ''));

    return res.json({ exercise: updatedSession });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/update-daily-exercise-config] failed:');
    return next(new ExternalProviderError());
  }
};

const writeProgress = (mode: 'set' | 'completion'): RequestHandler => async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const sessionId = String(req.params.exerciseSessionId || '');
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return res.status(400).json({ error: 'Invalid session id' });
    const existing = await loadDailyExerciseSessionWithExerciseMeta(sessionId, userId);
    const total = Math.max(1, Number(existing.actual_sets ?? existing.sets) || 1);
    const restSeconds = Number(req.body?.restSeconds ?? existing.actual_rest_seconds ?? existing.rest_seconds ?? 0);
    const target = mode === 'completion' ? (req.body?.isCompleted === true ? total : 0)
      : Number(req.body?.setNumber ?? Number(existing.completed_sets || 0) + 1);
    if (!Number.isInteger(target) || target < (mode === 'set' ? 1 : 0) || target > total
      || !Number.isFinite(restSeconds) || restSeconds < 0 || restSeconds > 300) {
      return res.status(400).json({ error: 'Thông tin set tập không hợp lệ.' });
    }
    if (target === Number(existing.completed_sets || 0) || (mode === 'set' && target < Number(existing.completed_sets || 0))) {
      return res.json({ exercise: existing, alreadyRecorded: true });
    }
    const actualKcal = target ? await calculateCompletedExerciseKcal({ userId, session: existing, completedSets: target }) : 0;
    const result = await adminSupabase.rpc('record_workout_progress_atomically', {
      p_user_id: userId, p_session_id: sessionId, p_expected_version: Number(existing.version),
      p_target_sets: target, p_actual_kcal: actualKcal, p_rest_seconds: Math.round(restSeconds), p_mode: mode,
    });
    if (result.error?.code === '40001') return res.status(409).json({ error: 'Buổi tập đã thay đổi. Hãy tải lại trước khi tiếp tục.' });
    if (result.error) throw result.error;
    return res.json({ exercise: await loadDailyExerciseSessionWithExerciseMeta(sessionId, userId), alreadyRecorded: Boolean(result.data?.already_recorded) });
  } catch (error: any) {
    if (error instanceof ApiRequestError) return res.status(error.status).json(error.body);
    return next(new ExternalProviderError());
  }
};
const updateDailyExerciseCompletion = writeProgress('completion');
const completeDailyExerciseSet = writeProgress('set');

  return { materializeFromPlan: materializeDailyExercisesFromPlan, replaceDailyExercise, createDailyExercise, updateDailyExerciseConfig, updateDailyExerciseCompletion, completeDailyExerciseSet };
};
