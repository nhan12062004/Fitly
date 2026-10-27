import { adminSupabase } from '../../config/Supabase';
import { snapshotHttpMetrics } from '../../http/requestMetrics';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError, ValidationError } from '../../http/errors';
import { callGroqJson } from '../../services/ai/groqJsonService';
import { normalizeTrainingLocation } from '../../../../shared/exerciseCatalog';
import { toMondayWeekKey } from '../../lib/weekKey';
import { aiOperationContext } from '../../lib/aiExecutionContext';
import { persistGeneratedMealPlan } from '../../services/ai/generatedMealPlanService';

const dailyWorkoutOptionsSchema = z.object({
  goal: z.enum(['Giảm mỡ', 'Tăng cơ', 'Sức khỏe']).optional(),
  durationMinutes: z.union([z.literal(20), z.literal(30), z.literal(45)]).optional(),
  location: z.enum(['Tại nhà', 'Phòng gym']).optional(),
});
type AIChatResponse = any;
type AiQuotaKey = any;
type RecipeCandidate = any;

/** AI Coach handlers with explicit dependencies from the application composition root. */
export const createAiCoachHandlers = (dependencies: any) => {
  const {
    addDays,
    AI_ACTION_FLOW_ENABLED,
    AI_CHAT_DAY_LABELS,
    AI_EXERCISE_CATALOG_FETCH_LIMIT,
    AI_EXERCISE_CATALOG_LIMIT,
    AI_FOOD_CATALOG_FETCH_LIMIT,
    aiChatService,
    aiPlannerService,
    ApiRequestError,
    balanceWorkoutDays,
    buildAiCoachProgressSummary,
    buildAiExerciseCatalog,
    buildAiQuotaLimitError,
    buildAiQuotaSnapshot,
    buildCoachDataContext,
    buildCompactRecipeCatalog,
    buildDailyExerciseSessionRow,
    buildExerciseEligibilityContext,
    buildMealPlanningCatalog,
    buildRecipeEligibilityContext,
    buildSafetyPromptAddendum,
    buildTodayStatus,
    buildWeeklyWorkoutPlanRow,
    buildWorkoutSessionExerciseRow,
    calculateNutritionMacroTargets,
    clampList,
    DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT,
    databaseMigrationRequiredResponse,
    DATE_KEY_REGEX,
    detectIntent,
    enforceTrainingPrescription,
    estimateWorkoutKcal,
    executeCoachCommand,
    ExternalProviderError,
    extractDayIndexFromText,
    filterEligibleRecipes,
    getAdjustmentApplyDecision,
    getAiCoachAccessState,
    getAuthUserId,
    getDateKeyFromWeekStartAndDayIndex,
    getEligibleExercises,
    getFoodSafetyDecision,
    getMealPlanningSlots,
    getResponseModeForIntent,
    getVietnamDateKey,
    getWeekStartKey,
    incrementMetric,
    InternalConfigurationError,
    isAdminUser,
    isDatabaseMigrationRequiredError,
    isMealFoodEligible,
    isMealIntent,
    isValidDayIndex,
    logAIEvent,
    mealAdjusterService,
    normalizeAiPlanPayload,
    normalizeVietForChat,
    parseJsonFromAiText,
    pickLatestByUpdatedAt,
    prescribeWorkoutExercise,
    processNaturalTracking,
    progressAnalyzerService,
    rankExercises,
    recordAiQuotaUsage,
    resolveAiExerciseReferences,
    resolveMealPlanningMealsPerDay,
    sanitizeAndBalanceRecipeProposal,
    sanitizeWorkoutPlanForUser,
    snapshotAIMetrics,
    startWorkoutPlanOnCreationDay,
    supabase,
    synchronizeTrainingProfileContext,
    toAiProviderRequestError,
    toDayOfWeekIndex,
    truncateText,
    validateActionPayload,
    validateExerciseProposal,
    workoutAdjusterService
  } = dependencies;
const getAiQuota: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const profileRes = await supabase
      .from('profiles')
      .select('id, membership_tier, membership_expires_at, created_at, ai_coach_free_used_at')
      .eq('id', authUserId)
      .maybeSingle();
    if (profileRes.error) throw profileRes.error;

    const accessState = await getAiCoachAccessState(profileRes.data || {}, authUserId);
    return res.json({
      membershipTier: accessState.membershipTier,
      membership: accessState.membership,
      canChat: accessState.canChat,
      canGenerate: accessState.canGenerate,
      canUseWorkoutAdjustment: accessState.canUseWorkoutAdjustment,
      canUseMealAdjustment: accessState.canUseMealAdjustment,
      quotaWindow: accessState.quotaWindow,
      trialExpired: accessState.trialExpired,
      aiQuota: buildAiQuotaSnapshot(accessState)
    });
  } catch {
    return next(new ExternalProviderError());
  }
};

const chatWithAiCoach: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  const startedAt = Date.now();
  const traceId = `ai-chat-${startedAt}-${Math.floor(Math.random() * 10000)}`;
  let success = false;
  let authUserId: string | null = null;
  let detectedIntent: string | undefined;
  let detectedActionType: string | null | undefined;
  try {
    authUserId = await getAuthUserId(req);
    const { message, selectedDayIndex, weekStartDate, clientHistory } = req.body || {};
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
    const normalizedClientHistory = Array.isArray(clientHistory)
      ? clientHistory
          .filter((item: any) => {
            const role = String(item?.role || '');
            const content = String(item?.content || '').trim();
            return (role === 'user' || role === 'assistant') && content.length > 0;
          })
          .slice(-10)
          .map((item: any) => ({
            role: String(item.role) === 'assistant' ? 'assistant' as const : 'user' as const,
            content: String(item.content || '').trim().slice(0, 1200)
          }))
      : [];
    const hasSelectedDayIndex = Object.prototype.hasOwnProperty.call(req.body || {}, 'selectedDayIndex');
    const hasWeekStartDate = Object.prototype.hasOwnProperty.call(req.body || {}, 'weekStartDate');

    if (!normalizedMessage) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (normalizedMessage.length > 1000) {
      return res.status(400).json({ error: 'message is too long' });
    }
    if (hasSelectedDayIndex && !isValidDayIndex(Number(selectedDayIndex))) {
      return res.status(400).json({ error: 'selectedDayIndex must be an integer between 0 and 6' });
    }
    if (hasWeekStartDate) {
      const normalizedWeekStartDate = String(weekStartDate || '').trim();
      if (normalizedWeekStartDate && !DATE_KEY_REGEX.test(normalizedWeekStartDate)) {
        return res.status(400).json({ error: 'weekStartDate must match YYYY-MM-DD' });
      }
    }

    const todayKey = getVietnamDateKey();
    const today = new Date(`${todayKey}T00:00:00`);
    const recentDateKeys = Array.from({ length: 7 }, (_, index) => getVietnamDateKey(addDays(today, -index)));
    const day = today.getDay();
    const todayDayIndex = day === 0 ? 6 : day - 1;
    const requestDayIndex = isValidDayIndex(Number(selectedDayIndex)) ? Number(selectedDayIndex) : null;
    const referencedDayIndex = extractDayIndexFromText(normalizedMessage, todayDayIndex);
    const dayIndex = referencedDayIndex ?? requestDayIndex ?? todayDayIndex;
    const requestedWeekStartDate = toMondayWeekKey(weekStartDate || todayKey);
    if (!requestedWeekStartDate) return res.status(400).json({ error: 'weekStartDate must be a valid calendar date' });
    const isCurrentWeek = requestedWeekStartDate === toMondayWeekKey(todayKey);
    let trackingActionLog = '';
    let todayStatusContext = '';
    let coachDataContext = '';

    incrementMetric('totalChatRequests');
    const weeklyPlanQuery = supabase
      .from('weekly_plans')
      .select('id, weekly_plan_exercises(day_of_week, exercise_id, sets, reps, rest_seconds, weight_kg, planned_sets, planned_reps, planned_weight_kg, planned_rest_seconds, target_rpe, estimated_kcal, load_instruction, exercises:exercise_id(name, body_part, target_muscle))')
      .eq('user_id', authUserId)
      .eq('week_start_date', requestedWeekStartDate)
      .eq('plan_status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const weeklyFoodPlanQuery = supabase
      .from('weekly_food_plans')
      .select('id, weekly_food_items(id, day_of_week, meal_type, recipe_id, quantity, calories, protein, carbs, fat, recipes:recipe_id(id, name, meal_type, calories, protein, carbs, fat, goal_type, price_level))')
      .eq('user_id', authUserId)
      .eq('week_start_date', requestedWeekStartDate)
      .eq('plan_status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const [
      todayWorkoutRes,
      todayMealRes,
      weekPlanRes,
      feedbackRes,
      profileRes,
      bodyMetricsRes,
      healthRes,
      recentChatRes,
      dailyExerciseSessionsRes,
      recentProgressLogsRes,
      recentExerciseSessionsRes,
      recentMealLogsRes,
    ] = await Promise.all([
      weeklyPlanQuery,
      weeklyFoodPlanQuery,
      supabase
        .from('lifestyle_settings')
        .select('*')
        .eq('user_id', authUserId)
        .maybeSingle(),
      supabase
        .from('daily_workout_sessions')
        .select('id, status')
        .eq('user_id', authUserId)
        .eq('status', 'completed')
        .gte('log_date', getWeekStartKey(today)),
      supabase
        .from('profiles')
        .select('id, full_name, gender, birthday, membership_tier, membership_expires_at, created_at')
        .eq('id', authUserId)
        .maybeSingle(),
      supabase
        .from('body_metrics')
        .select('*')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('health_conditions')
        .select('*')
        .eq('user_id', authUserId)
        .maybeSingle(),
      supabase
        .from('ai_chat_messages')
        .select('role, content, created_at')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('daily_exercise_sessions')
        .select('id, exercise_id, order_index, sets, reps, weight_kg, rest_seconds, planned_sets, planned_reps, planned_weight_kg, planned_rest_seconds, actual_sets, actual_reps, actual_weight_kg, actual_rest_seconds, target_rpe, estimated_kcal, actual_kcal_estimated, completed_sets, exercises:exercise_id(name, body_part, target_muscle)')
        .eq('user_id', authUserId)
        .eq('log_date', todayKey)
        .order('order_index', { ascending: true }),
      supabase
        .from('daily_progress_logs')
        .select('log_date, water_intake_ml, calories_consumed, calories_burned, sleep_hours')
        .eq('user_id', authUserId)
        .in('log_date', recentDateKeys)
        .order('log_date', { ascending: false }),
      supabase
        .from('daily_exercise_sessions')
        .select('log_date, is_completed, sets, planned_sets, completed_sets')
        .eq('user_id', authUserId)
        .in('log_date', recentDateKeys),
      supabase
        .from('daily_meal_logs')
        .select('log_date, meal_type, recipe_id, quantity, calories, protein, carbs, fat, custom_food_name, recipes:recipe_id(id, name, meal_type, calories, protein, carbs, fat, goal_type, price_level)')
        .eq('user_id', authUserId)
        .in('log_date', recentDateKeys)
        .order('log_date', { ascending: false })
    ]);

    const firstDataError = [
      todayWorkoutRes.error,
      todayMealRes.error,
      weekPlanRes.error,
      feedbackRes.error,
      profileRes.error,
      bodyMetricsRes.error,
      healthRes.error,
      recentChatRes.error,
      dailyExerciseSessionsRes.error,
      recentProgressLogsRes.error,
      recentExerciseSessionsRes.error,
      recentMealLogsRes.error
    ].find(Boolean);
    if (firstDataError) throw firstDataError;

    const chatTrainingContext = await synchronizeTrainingProfileContext({
      userId: authUserId,
      profile: profileRes.data,
      lifestyle: weekPlanRes.data,
      health: healthRes.data,
    });
    const normalizedChatLifestyle = chatTrainingContext.lifestyle;

    const chatAccessState = await getAiCoachAccessState(profileRes.data || {}, authUserId);
    if (!chatAccessState.canChat) {
      return res.status(403).json(buildAiQuotaLimitError(chatAccessState, 'chatMessages'));
    }

    try {
      trackingActionLog = (await processNaturalTracking(authUserId, normalizedMessage)).actionLog;
    } catch (trackingError: any) {
      console.warn('[ai-chat] natural tracking skipped:');
    }

    const workoutRows = (todayWorkoutRes.data as any)?.weekly_plan_exercises || [];
    const mealRows = (todayMealRes.data as any)?.weekly_food_items || [];
    const planWorkoutRows = workoutRows.filter((row: any) => Number(row.day_of_week) === dayIndex && row.exercise_id);
    const dailyWorkoutRows = ((dailyExerciseSessionsRes.data || []) as any[])
      .filter((row: any) => row.exercise_id)
      .map((row: any) => ({
        ...row,
        day_of_week: todayDayIndex
      }));
    const targetWorkoutRows =
      isCurrentWeek && dayIndex === todayDayIndex && dailyWorkoutRows.length > 0 ? dailyWorkoutRows : planWorkoutRows;
    const targetMealRows = mealRows.filter((row: any) => Number(row.day_of_week) === dayIndex && (row.recipe_id || row.food_id));
    const targetWorkoutContext = targetWorkoutRows.map((row: any) => ({
      exercise_id: row.exercise_id,
      name: row.exercises?.name || null,
      sets: row.actual_sets ?? row.planned_sets ?? row.sets,
      reps: row.actual_reps ?? row.planned_reps ?? row.reps,
      rest_seconds: row.actual_rest_seconds ?? row.planned_rest_seconds ?? row.rest_seconds,
      weight_kg: row.actual_weight_kg ?? row.planned_weight_kg ?? row.weight_kg,
      planned_sets: row.planned_sets ?? row.sets,
      planned_reps: row.planned_reps ?? row.reps,
      planned_weight_kg: row.planned_weight_kg ?? row.weight_kg,
      completed_sets: row.completed_sets ?? 0,
      estimated_kcal: row.estimated_kcal ?? 0,
      actual_kcal_estimated: row.actual_kcal_estimated ?? 0,
      target_rpe: row.target_rpe ?? null,
      body_part: row.exercises?.body_part || null,
      target_muscle: row.exercises?.target_muscle || null
    }));
    const aiCoachProgressSummary = buildAiCoachProgressSummary({
      todayKey,
      recentDateKeys,
      profile: profileRes.data || null,
      bodyMetrics: bodyMetricsRes.data || null,
      lifestyle: normalizedChatLifestyle,
      health: healthRes.data || null,
      progressLogs: (recentProgressLogsRes.data || []) as any[],
      exerciseSessions: (recentExerciseSessionsRes.data || []) as any[],
    });
    try {
      [todayStatusContext, coachDataContext] = await Promise.all([
        buildTodayStatus(authUserId),
        buildCoachDataContext(authUserId)
      ]);
    } catch (contextError: any) {
      console.warn('[ai-chat] extended coach context skipped:');
    }
    const dbChatHistory = ((recentChatRes.data || []) as any[])
      .reverse()
      .map((item: any) => ({
        role: item.role === 'assistant' || item.role === 'system' ? item.role : 'user',
        content: String(item.content || '').trim(),
      }))
      .filter((item: any) => item.content);
    const mergedChatHistory = [...dbChatHistory, ...normalizedClientHistory]
      .reduce((items: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, item) => {
        const previous = items[items.length - 1];
        if (!previous || previous.role !== item.role || previous.content !== item.content) {
          items.push(item);
        }
        return items;
      }, [])
      .slice(-10);

    const { intent, confidence } = detectIntent(normalizedMessage, {
      todayWorkoutCount: targetWorkoutRows.length,
      todayMealCount: targetMealRows.length,
      todayDayIndex: todayDayIndex,
      targetDayIndex: dayIndex
    });
    detectedIntent = intent;

    let aiResponse: AIChatResponse;
    const chatSafetyContext = {
      profile: profileRes.data || null,
      lifestyle: normalizedChatLifestyle,
      health: healthRes.data || null
    };
    if (intent === 'adjust_workout') {
      aiResponse = await workoutAdjusterService({
        dayOfWeek: dayIndex,
        todayExercises: targetWorkoutContext,
        safetyContext: chatSafetyContext
      });
    } else if (intent === 'adjust_meal') {
      const currentMeal = targetMealRows[0] || null;
      const mealType = String(currentMeal?.meal_type || 'dinner');
      const candidateFoodsRes = await supabase
        .from('recipes')
        .select('id, name, meal_type, calories, protein, carbs, fat, serving_unit, is_active, price_level, cooking_time_minutes, region')
        .contains('meal_type', [mealType])
        .order('created_at', { ascending: false })
        .limit(300);
      if (candidateFoodsRes.error) throw candidateFoodsRes.error;
      const candidateFoods = buildMealPlanningCatalog(candidateFoodsRes.data as any[], {
        profile: profileRes.data || {},
        lifestyle: normalizedChatLifestyle,
        health: healthRes.data || {},
        mealsPerDay: Number(normalizedChatLifestyle.meals_per_day || 3),
        recentMealFoodIds: [
          ...((recentMealLogsRes.data || []) as any[]),
          ...mealRows,
        ]
          .map((item: any) => String(item.recipe_id || item.food_id || ''))
          .filter((foodId) => foodId && foodId !== String(currentMeal?.recipe_id || currentMeal?.food_id || '')),
      }, 24);

      aiResponse = await mealAdjusterService({
        dayOfWeek: dayIndex,
        currentMeal,
        candidateFoods: candidateFoods.map((item: any) => ({
          id: String(item.id),
          name: String(item.name || ''),
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat
        }))
      });
    } else if (intent === 'create_workout_plan' || intent === 'create_meal_plan') {
      aiResponse = await aiPlannerService(intent, {
        weeklyWorkouts: chatTrainingContext.trainingPrescription.weeklyWorkouts,
        mealsPerDay: Number(normalizedChatLifestyle.meals_per_day || 3),
        fitnessGoal: String(normalizedChatLifestyle.fitness_goal || 'general_fitness')
      });
    } else if (intent === 'analyze_progress') {
      aiResponse = await progressAnalyzerService({
        completedWorkouts: (feedbackRes.data || []).length,
        targetWorkouts: chatTrainingContext.trainingPrescription.weeklyWorkouts,
        completedMeals: targetMealRows.length,
        targetMeals: Number(normalizedChatLifestyle.meals_per_day || 0)
      });
    } else {
      aiResponse = await aiChatService(normalizedMessage, intent, {
        todayWorkoutCount: targetWorkoutRows.length,
        todayMealCount: targetMealRows.length,
        todayDayIndex: todayDayIndex,
        targetDayIndex: dayIndex,
        targetDayLabel: (() => {
          if (isCurrentWeek && dayIndex === todayDayIndex) return 'Hôm nay';
          if (isCurrentWeek && dayIndex === (todayDayIndex + 1) % 7 && /\bmai\b/.test(normalizeVietForChat(normalizedMessage))) return 'Ngày mai';
          return AI_CHAT_DAY_LABELS[dayIndex] || 'Hôm nay';
        })(),
        profile: profileRes.data || null,
        bodyMetrics: bodyMetricsRes.data || null,
        lifestyle: normalizedChatLifestyle,
        health: healthRes.data || null,
        todayStatus: todayStatusContext,
        actionLog: trackingActionLog,
        extraContext: coachDataContext,
        progressSummary: aiCoachProgressSummary,
        chatHistory: mergedChatHistory,
        exercises: targetWorkoutContext,
        meals: targetMealRows.map((row: any) => ({
          id: row.id,
          meal_type: row.meal_type,
          food_id: row.recipe_id || row.food_id,
          recipe_id: row.recipe_id || row.food_id,
          name: row.recipes?.name || row.foods?.name || null,
          quantity: row.quantity,
          calories: row.calories,
          protein: row.protein,
          carbs: row.carbs,
          fat: row.fat
        }))
      });
    }

    const normalizedResponse: AIChatResponse = {
      ...aiResponse,
      intent: aiResponse.intent || intent,
      responseMode: aiResponse.responseMode || getResponseModeForIntent(aiResponse.intent || intent),
      confidence: aiResponse.confidence || confidence
    };
    detectedActionType = normalizedResponse.actionType;
    if (!AI_ACTION_FLOW_ENABLED) {
      normalizedResponse.actionRequired = false;
      normalizedResponse.actionType = null;
      normalizedResponse.actionPayload = null;
    }

    const userChatInsert = await adminSupabase.from('ai_chat_messages').insert({
      user_id: authUserId,
      role: 'user',
      content: normalizedMessage.slice(0, 3000),
      intent
    }).select('id').maybeSingle();
    if (userChatInsert.error) {
      console.warn('Failed to save user ai chat message:');
    }

    // This must be independent from ai_chat_messages: users can safely clear
    // their conversation without resetting their entitlement usage.
    await recordAiQuotaUsage(authUserId, 'chatMessages');

    const payloadValidation = normalizedResponse.actionType
      ? validateActionPayload(normalizedResponse.actionType, normalizedResponse.actionPayload)
      : { valid: true };
    if (!payloadValidation.valid) {
      normalizedResponse.actionRequired = false;
      normalizedResponse.actionType = null;
      normalizedResponse.actionPayload = null;
      normalizedResponse.reply = `Mình chưa thể áp dụng thay đổi tự động: ${payloadValidation.message}.`;
    }
    if (normalizedResponse.actionType === 'replace_today_workout' && normalizedResponse.actionPayload) {
      const workoutPayload = normalizedResponse.actionPayload as { exercises?: Array<{ exercise_id?: string }> };
      const proposedIds = (workoutPayload.exercises || [])
        .map((item) => String(item.exercise_id || '').trim())
        .filter(Boolean);
      const proposedCatalogRes = await supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, movement_pattern, goal_type, contraindications')
        .in('id', proposedIds);
      if (proposedCatalogRes.error) throw proposedCatalogRes.error;
      const proposalEligibility = validateExerciseProposal(
        normalizedResponse.actionPayload,
        buildExerciseEligibilityContext(chatSafetyContext),
        proposedCatalogRes.data as unknown[],
      );
      if (!proposalEligibility.valid) {
        normalizedResponse.actionRequired = false;
        normalizedResponse.actionType = null;
        normalizedResponse.actionPayload = null;
        normalizedResponse.reply = 'Mình chưa tạo đề xuất vì các bài được chọn không còn phù hợp với địa điểm, dụng cụ, kinh nghiệm hoặc điều kiện an toàn hiện tại.';
      }
    }

    const assistantChatInsert = await adminSupabase.from('ai_chat_messages').insert({
      user_id: authUserId,
      role: 'assistant',
      content: String(normalizedResponse.reply || '').slice(0, 5000),
      intent: normalizedResponse.intent,
      confidence: normalizedResponse.confidence,
      action_type: normalizedResponse.actionType,
      action_payload: normalizedResponse.actionPayload
    }).select('id').maybeSingle();
    if (assistantChatInsert.error) {
      console.warn('Failed to save assistant ai chat message:');
    }

    let adjustmentId: string | undefined;
    if (normalizedResponse.actionRequired && normalizedResponse.actionType) {
      incrementMetric('actionRequiredCount');
      const oldData = isMealIntent(normalizedResponse.intent)
        ? {
            weekly_food_plan_id: (todayMealRes.data as any)?.id || null,
            day_of_week: dayIndex,
            meal_items: targetMealRows.map((row: any) => ({
              id: row.id,
              meal_type: row.meal_type,
              food_id: row.recipe_id || row.food_id,
              recipe_id: row.recipe_id || row.food_id,
              name: row.recipes?.name || row.foods?.name || null,
              quantity: row.quantity,
              calories: row.calories,
              protein: row.protein,
              carbs: row.carbs,
              fat: row.fat,
            })),
          }
        : {
            weekly_plan_id: (todayWorkoutRes.data as any)?.id || null,
            day_of_week: dayIndex,
            exercises: targetWorkoutContext,
          };
      const adjustmentInsert = await adminSupabase.from('ai_plan_adjustments').insert({
        user_id: authUserId,
        plan_type: isMealIntent(normalizedResponse.intent) ? 'meal' : 'workout',
        source_type: 'chat',
        old_data: oldData,
        new_data: normalizedResponse.actionPayload,
        reason: normalizedMessage.slice(0, 300),
        created_by: 'ai',
        status: 'proposed',
        chat_message_id: assistantChatInsert.data?.id || null
      }).select('id').maybeSingle();
      if (adjustmentInsert.error) {
        console.warn('Failed to save proposed ai adjustment:');
        normalizedResponse.actionRequired = false;
        normalizedResponse.actionType = null;
        normalizedResponse.actionPayload = null;
        normalizedResponse.reply = 'Mình chưa lưu được đề xuất thay đổi. Bạn vui lòng thử lại.';
      } else {
        adjustmentId = adjustmentInsert.data?.id;
      }
    }

    success = true;
    return res.json({
      ...normalizedResponse,
      adjustmentId: adjustmentId || null,
      aiQuota: buildAiQuotaSnapshot(chatAccessState, 'chatMessages')
    });
  } catch (error: any) {
    incrementMetric('errorCount');
    logAIEvent({
      event: 'ai_chat_failed',
      intent: detectedIntent,
      actionType: detectedActionType,
      success: false,
      traceId,
      latencyMs: Date.now() - startedAt
    });
    console.error(`[ai-chat] failed traceId=${traceId}:`);
    return next(new ExternalProviderError());
  } finally {
    logAIEvent({
      event: 'ai_chat',
      intent: detectedIntent,
      actionType: detectedActionType,
      success,
      traceId,
      latencyMs: Date.now() - startedAt
    });
  }
};

const executeAiCoachCommand: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const command = String(req.body?.command || '').replace(/^\//, '').trim().toLowerCase();
    if (!command) {
      return res.status(400).json({ error: 'command is required' });
    }

    const result = await executeCoachCommand({
      userId: authUserId,
      command,
      amountMl: req.body?.amountMl,
      sleepHours: req.body?.sleepHours,
    });

    const userCommandText = req.body?.amountMl
      ? `/water +${Math.round(Number(req.body.amountMl))}ml`
      : req.body?.sleepHours
        ? `/sleep ${Number(req.body.sleepHours)}h`
        : `/${command}`;

    if (!result.clearHistory) {
      const userInsert = await adminSupabase.from('ai_chat_messages').insert({
        user_id: authUserId,
        role: 'user',
        content: userCommandText.slice(0, 3000),
        intent: 'view_day_plan'
      });
      if (userInsert.error) {
        console.warn('Failed to save user coach command:');
      }
    }

    const assistantInsert = await adminSupabase.from('ai_chat_messages').insert({
      user_id: authUserId,
      role: 'assistant',
      content: String(result.reply || '').slice(0, 5000),
      intent: 'view_day_plan',
      confidence: 1
    });
    if (assistantInsert.error) {
      console.warn('Failed to save assistant coach command:');
    }

    return res.json(result);
  } catch (error: any) {
    console.error('[ai-coach-command] failed:');
    return next(new ExternalProviderError());
  }
};

const clearAiCoachChat: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { error } = await supabase
      .from('ai_chat_messages')
      .delete()
      .eq('user_id', authUserId);

    if (error) throw error;
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[ai-chat-clear] failed:');
    return next(new ExternalProviderError());
  }
};

const applyAiAdjustment: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  const startedAt = Date.now();
  const traceId = `ai-apply-${startedAt}-${Math.floor(Math.random() * 10000)}`;
  let success = false;
  let authUserId: string | null = null;
  try {
    authUserId = await getAuthUserId(req);
    const { adjustmentId } = req.body || {};
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!adjustmentId) {
      return res.status(400).json({ error: 'adjustmentId is required' });
    }
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency-Key header is required' });
    }

    const adjustmentRes = await supabase
      .from('ai_plan_adjustments')
      .select('*')
      .eq('id', adjustmentId)
      .eq('user_id', authUserId)
      .maybeSingle();
    if (adjustmentRes.error) throw adjustmentRes.error;
    if (!adjustmentRes.data) return res.status(404).json({ error: 'Adjustment not found' });
    const applyDecision = getAdjustmentApplyDecision({
      status: adjustmentRes.data.status,
      storedIdempotencyKey: adjustmentRes.data.apply_idempotency_key,
      idempotencyKey,
    });
    if (applyDecision.kind === 'already_applied') {
      return res.json({ success: true, adjustmentId, alreadyApplied: true });
    }
    if (applyDecision.kind === 'conflict') {
      return res.status(409).json({ error: applyDecision.message });
    }

    const newData = adjustmentRes.data.new_data || {};
    const oldData = adjustmentRes.data.old_data || {};
    const actionType = adjustmentRes.data.plan_type === 'meal' ? 'replace_today_meal' : 'replace_today_workout';
    const payloadValidation = validateActionPayload(actionType, newData);
    if (!payloadValidation.valid) {
      return res.status(400).json({ error: payloadValidation.message || 'Invalid action payload' });
    }
    const dayOfWeek = Number(newData.day_of_week);
    const [applyProfileRes, applyLifestyleRes, applyHealthRes] = await Promise.all([
      supabase.from('profiles').select('id, updated_at, gender, birthday, membership_tier, membership_expires_at, created_at').eq('id', authUserId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle()
    ]);
    const applyFirstError = [applyProfileRes.error, applyLifestyleRes.error, applyHealthRes.error].find(Boolean);
    if (applyFirstError) throw applyFirstError;
    const applySafetyContext = {
      profile: applyProfileRes.data || null,
      lifestyle: applyLifestyleRes.data || null,
      health: applyHealthRes.data || null
    };
    const applyEligibilityContext = buildExerciseEligibilityContext(applySafetyContext);
    const applyAccessState = await getAiCoachAccessState(applyProfileRes.data || {}, authUserId);
    const adjustmentQuotaKey: AiQuotaKey = adjustmentRes.data.plan_type === 'meal'
      ? 'mealAdjustments'
      : 'workoutAdjustments';
    const canUseAdjustment = adjustmentQuotaKey === 'mealAdjustments'
      ? applyAccessState.canUseMealAdjustment
      : applyAccessState.canUseWorkoutAdjustment;
    if (!canUseAdjustment) {
      return res.status(403).json(buildAiQuotaLimitError(applyAccessState, adjustmentQuotaKey));
    }

    if (adjustmentRes.data.plan_type === 'workout') {
      const requestedWorkoutPlanId = String((oldData as any).weekly_plan_id || '').trim();
      const planQuery = requestedWorkoutPlanId
        ? supabase
            .from('weekly_plans')
            .select('id, week_start_date')
            .eq('id', requestedWorkoutPlanId)
            .eq('user_id', authUserId)
            .eq('plan_status', 'active')
            .maybeSingle()
        : supabase
            .from('weekly_plans')
            .select('id, week_start_date')
            .eq('user_id', authUserId)
            .eq('plan_status', 'active')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
      const planRes = await planQuery;
      if (planRes.error) throw planRes.error;
      if (!planRes.data?.id) {
        return res.status(404).json({
          error: requestedWorkoutPlanId ? 'Original workout plan not found for user' : 'Active workout plan not found'
        });
      }
      const workoutPlanId = planRes.data.id;
      const workoutWeekStartKey = DATE_KEY_REGEX.test(String(planRes.data.week_start_date || ''))
        ? String(planRes.data.week_start_date)
        : getWeekStartKey(new Date(`${getVietnamDateKey()}T00:00:00`));
      const targetLogDate = getDateKeyFromWeekStartAndDayIndex(workoutWeekStartKey, dayOfWeek);

      const exercises = Array.isArray(newData.exercises) ? newData.exercises : [];
      const exerciseIds: string[] = [...new Set<string>(
        exercises
          .map((item: any) => String(item?.exercise_id || '').trim())
          .filter((id: string) => Boolean(id))
      )];
      const validExercisesRes = await supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, movement_pattern, goal_type, contraindications, calories_per_minute')
        .in('id', exerciseIds);
      if (validExercisesRes.error) throw validExercisesRes.error;
      const exerciseMetaById = new Map<string, any>((validExercisesRes.data || []).map((item: any) => [String(item.id), item]));
      const existingExerciseIds = new Set<string>((validExercisesRes.data || []).map((item: any) => String(item.id)));
      const missingExerciseIds = exerciseIds.filter((id) => !existingExerciseIds.has(id));
      if (missingExerciseIds.length > 0) {
        return res.status(400).json({ error: `Invalid exercise_id: ${missingExerciseIds.join(', ')}` });
      }
      const proposalValidation = validateExerciseProposal(
        newData,
        applyEligibilityContext,
        validExercisesRes.data as unknown[],
      );
      if (!proposalValidation.valid) {
        return res.status(422).json({
          error: 'Adjustment failed current exercise eligibility validation.',
          details: proposalValidation.errors,
        });
      }

      const rows = (await Promise.all(
        exercises.map(async (item: any, index: number) => {
          const exerciseId = String(item.exercise_id || '').trim();
          if (!exerciseId) return null;
          const exerciseMeta = exerciseMetaById.get(exerciseId);
          const prescription = await prescribeWorkoutExercise({
            userId: String(authUserId),
            exerciseId,
            exercise: exerciseMeta,
            source: 'ai_adjustment',
            suggestedSets: item.sets,
            suggestedReps: item.reps,
            suggestedWeightKg: item.weight_kg,
            suggestedRestSeconds: item.rest_seconds,
            suggestedTargetRpe: item.target_rpe
          });
          return buildDailyExerciseSessionRow({
            userId: String(authUserId),
            logDate: targetLogDate,
            exerciseId,
            orderIndex: index,
            plannedSets: prescription.sets,
            plannedReps: prescription.reps,
            plannedWeightKg: prescription.weightKg,
            plannedRestSeconds: prescription.restSeconds,
            targetRpe: prescription.targetRpe,
            estimatedKcal: prescription.estimatedKcal,
            loadAdjustmentNote: String(item.load_instruction || item.note || prescription.loadInstruction || '').slice(0, 160) || null
          });
        })
      )).filter(Boolean) as any[];

      const atomicApplyRes = await adminSupabase.rpc('apply_workout_adjustment_atomically', {
        p_adjustment_id: adjustmentId,
        p_user_id: authUserId,
        p_idempotency_key: idempotencyKey,
        p_weekly_plan_id: workoutPlanId,
        p_day_of_week: dayOfWeek,
        p_log_date: targetLogDate,
        p_rows: rows,
      });
      if (atomicApplyRes.error) {
        const message = atomicApplyRes.error.message || 'Failed to apply workout adjustment';
        if (/already started|already completed|not proposed|another idempotency/i.test(message)) {
          return res.status(409).json({ error: message });
        }
        throw atomicApplyRes.error;
      }

      const atomicResult = atomicApplyRes.data as { already_applied?: boolean } | null;
      // The RPC is the source of truth for whether this mutation was newly
      // applied. Only charge quota after a fresh apply; a replay with the same
      // idempotency key must not consume another adjustment.
      if (!atomicResult?.already_applied) {
        await recordAiQuotaUsage(authUserId, adjustmentQuotaKey);
      }
      success = true;
      return res.json({
        success: true,
        adjustmentId,
        alreadyApplied: Boolean(atomicResult?.already_applied),
        aiQuota: buildAiQuotaSnapshot(applyAccessState, adjustmentQuotaKey)
      });
    } else if (adjustmentRes.data.plan_type === 'meal') {
      const requestedFoodPlanId = String((oldData as any).weekly_food_plan_id || '').trim();
      const planQuery = requestedFoodPlanId
        ? supabase
            .from('weekly_food_plans')
            .select('id')
            .eq('id', requestedFoodPlanId)
            .eq('user_id', authUserId)
            .eq('plan_status', 'active')
            .maybeSingle()
        : supabase
            .from('weekly_food_plans')
            .select('id')
            .eq('user_id', authUserId)
            .eq('plan_status', 'active')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
      const planRes = await planQuery;
      if (planRes.error) throw planRes.error;
      if (!planRes.data?.id) {
        return res.status(404).json({
          error: requestedFoodPlanId ? 'Original meal plan not found for user' : 'Active meal plan not found'
        });
      }
      const foodPlanId = planRes.data.id;

      const mealType = String(newData.meal_type || 'dinner');
      const oldWeeklyFoodItemId = String(newData.old_weekly_food_item_id || '');
      const newFoodId = String(newData.new_food_id || '');
      const existingMealRes = await supabase
        .from('weekly_food_items')
        .select('id, order_index')
        .eq('food_plan_id', foodPlanId)
        .eq('id', oldWeeklyFoodItemId)
        .maybeSingle();
      if (existingMealRes.error) throw existingMealRes.error;
      if (!existingMealRes.data?.id) {
        return res.status(404).json({ error: 'Original meal item not found' });
      }

      const foodRes = await supabase
        .from('recipes')
        .select('id, updated_at, name, meal_type, calories, protein, carbs, fat, allergens, dietary_restrictions, diet_styles, is_active, price_level, goal_type')
        .eq('id', newFoodId)
        .maybeSingle();
      if (foodRes.error) throw foodRes.error;
      if (!foodRes.data?.id) {
        return res.status(400).json({ error: 'new_food_id does not exist' });
      }
      const foodSafety = getFoodSafetyDecision(foodRes.data as any, applySafetyContext);
      if (!foodSafety.allowed) {
        return res.status(400).json({
          error: `Adjustment blocked by food safety guard: ${foodSafety.reasons.join(', ')}`
        });
      }
      if (!isMealFoodEligible(foodRes.data as any, mealType, applySafetyContext)) {
        return res.status(400).json({
          error: 'Adjustment food is not eligible for this meal slot or profile.'
        });
      }

      const applied = await adminSupabase.rpc('apply_meal_adjustment_atomically', {
        p_user_id: authUserId, p_adjustment_id: adjustmentId, p_key: idempotencyKey,
        p_plan_id: foodPlanId, p_item_id: oldWeeklyFoodItemId, p_recipe_id: newFoodId,
        p_day: dayOfWeek, p_meal_type: mealType, p_quantity: Number(newData.quantity || 1),
        p_profile_updated_at: applyProfileRes.data?.updated_at,
        p_health_updated_at: applyHealthRes.data?.updated_at ?? null,
        p_lifestyle_updated_at: applyLifestyleRes.data?.updated_at ?? null,
        p_recipe_updated_at: foodRes.data.updated_at,
      });
      if (applied.error?.code === '40001') return res.status(409).json({ error: 'Thực đơn hoặc hồ sơ đã thay đổi. Hãy tạo lại đề xuất.' });
      if (applied.error) throw applied.error;
      success = true;
      return res.json({ success: true, adjustmentId, alreadyApplied: Boolean(applied.data?.already_applied), aiQuota: buildAiQuotaSnapshot(applyAccessState, adjustmentQuotaKey) });
    }
    return res.status(400).json({ error: 'Unsupported adjustment type' });
  } catch (error: any) {
    incrementMetric('errorCount');
    logAIEvent({
      event: 'ai_apply_failed',
      actionType: 'apply_adjustment',
      success: false,
      traceId,
      latencyMs: Date.now() - startedAt
    });
    console.error(`[ai-apply] failed traceId=${traceId}:`);
    return next(new ExternalProviderError());
  } finally {
    logAIEvent({
      event: 'ai_apply',
      actionType: 'apply_adjustment',
      success,
      traceId,
      latencyMs: Date.now() - startedAt
    });
  }
};

const rejectAiAdjustment: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  const startedAt = Date.now();
  const traceId = `ai-reject-${startedAt}-${Math.floor(Math.random() * 10000)}`;
  let success = false;
  let authUserId: string | null = null;
  try {
    authUserId = await getAuthUserId(req);
    const { adjustmentId } = req.body || {};
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!adjustmentId) {
      return res.status(400).json({ error: 'adjustmentId are required' });
    }

    const updateRes = await adminSupabase
      .from('ai_plan_adjustments')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString()
      })
      .eq('id', adjustmentId)
      .eq('user_id', authUserId)
      .eq('status', 'proposed')
      .select('id')
      .maybeSingle();

    if (updateRes.error) throw updateRes.error;
    if (!updateRes.data?.id) {
      return res.status(409).json({ error: 'Adjustment is not in proposed status' });
    }
    success = true;
    return res.json({ success: true, adjustmentId });
  } catch (error: any) {
    incrementMetric('errorCount');
    logAIEvent({
      event: 'ai_reject_failed',
      actionType: 'reject_adjustment',
      success: false,
      traceId,
      latencyMs: Date.now() - startedAt
    });
    console.error(`[ai-reject] failed traceId=${traceId}:`);
    return next(new ExternalProviderError());
  } finally {
    logAIEvent({
      event: 'ai_reject',
      actionType: 'reject_adjustment',
      success,
      traceId,
      latencyMs: Date.now() - startedAt
    });
  }
};

const getAiMetrics: RequestHandler = async (req, res) => {
  const supabase = req.supabase!;
  const authUserId = await getAuthUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const isAdmin = await isAdminUser(authUserId);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.json({
    success: true,
    data: {
      ...snapshotAIMetrics(), http:snapshotHttpMetrics(),
      operations: await adminSupabase.rpc('operational_snapshot').then((result) => result.error ? {status:'unavailable'} : result.data),
    },
    actionFlowEnabled: AI_ACTION_FLOW_ENABLED
  });
};

const generateAiDailyWorkout: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  let createdWorkoutSessionId: string | null = null;
  let createdDailyExerciseIds: string[] = [];
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) return res.status(401).json({ error: 'Unauthorized' });

    const logDate = String(req.body?.logDate || getVietnamDateKey()).trim();
    if (!DATE_KEY_REGEX.test(logDate)) {
      return res.status(400).json({ error: 'logDate must be YYYY-MM-DD' });
    }
    const optionsResult = dailyWorkoutOptionsSchema.safeParse(req.body || {});
    if (!optionsResult.success) return next(new ValidationError('Thông tin buổi tập không hợp lệ.'));
    const options = optionsResult.data;

    const existingRes = await supabase
      .from('daily_exercise_sessions')
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('order_index', { ascending: true });
    if (existingRes.error) throw existingRes.error;
    if ((existingRes.data || []).length > 0) {
      return res.json({ success: true, data: { exercises: existingRes.data, logDate, source: 'existing' } });
    }
    if (!process.env.GROQ_API_KEY) return next(new InternalConfigurationError());

    const [profileRes, bodyMetricsRes, lifestyleRes, healthRes, catalogRes, recentRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle(),
      supabase.from('body_metrics').select('*').eq('user_id', authUserId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('exercises').select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern').limit(AI_EXERCISE_CATALOG_FETCH_LIMIT),
      supabase.from('daily_exercise_sessions').select('exercise_id').eq('user_id', authUserId).order('log_date', { ascending: false }).limit(20),
    ]);
    const firstError = [profileRes.error, bodyMetricsRes.error, lifestyleRes.error, healthRes.error, catalogRes.error, recentRes.error].find(Boolean);
    if (firstError) throw firstError;
    if (!profileRes.data?.id) {
      return res.status(403).json({ code: 'PROFILE_REQUIRED', error: 'Vui long hoan thanh ho so truoc khi tao lich tap.' });
    }

    let profile = profileRes.data || {};
    let lifestyle = lifestyleRes.data || {};
    let health = healthRes.data || {};
    const trainingContext = await synchronizeTrainingProfileContext({ userId: authUserId, profile, lifestyle, health });
    profile = trainingContext.profile;
    lifestyle = trainingContext.lifestyle;
    health = trainingContext.health;
    // Quick setup applies only to this session; retain health and experience safeguards.
    const durationMinutes = Math.min(options.durationMinutes ?? trainingContext.trainingPrescription.durationMinutes,
      trainingContext.trainingPrescription.durationMinutes);
    lifestyle = {
      ...lifestyle,
      ...(options.goal ? { fitness_goal: options.goal } : {}),
      ...(options.location ? {
        workout_location: options.location,
        equipment_available: normalizeTrainingLocation(options.location) === normalizeTrainingLocation(lifestyle.workout_location)
          ? lifestyle.equipment_available : 'bodyweight',
      } : {}),
      workout_duration: durationMinutes,
    };
    trainingContext.safetyContext = { profile, lifestyle, health };
    const accessState = await getAiCoachAccessState(profile, authUserId);
    if (accessState.membershipTier === 'free') {
      return next(new AppError(403, 'PREMIUM_REQUIRED', 'Gói Free chỉ có lịch tập 7 ngày được tạo khi hoàn tất khảo sát. Nâng cấp Plus hoặc Pro để tạo buổi tập mới.'));
    }
    if (!accessState.canGenerate) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'planGenerations'));
    }

    const eligibilityContext = buildExerciseEligibilityContext(trainingContext.safetyContext);
    const recentExerciseIds = new Set((recentRes.data || []).map((item: any) => String(item.exercise_id || '')).filter(Boolean));
    const exercises = rankExercises(
      getEligibleExercises(catalogRes.data as unknown[], eligibilityContext),
      eligibilityContext,
      { recentExerciseIds },
    ).slice(0, AI_EXERCISE_CATALOG_LIMIT).map(({ exercise }: any) => exercise);
    if (exercises.length === 0) {
      return res.status(422).json({ error: 'Khong co bai tap nao phu hop voi ho so va dieu kien an toan hien tai.' });
    }

    const { text: exerciseCatalog, referenceIds: exerciseReferenceIds } = buildAiExerciseCatalog(exercises);
    const prompt = `
Generate exactly one personalized workout session for ${logDate}. Return valid JSON only.

USER_PROFILE:
gender=${truncateText(profile.gender, 12)}
fitness_goal=${truncateText(lifestyle.fitness_goal, 40)}
experience_level=${truncateText(lifestyle.experience_level, 20)}
workout_location=${truncateText(lifestyle.workout_location, 24)}
equipment_available=${truncateText(lifestyle.equipment_available, 60)}
injuries=${truncateText(health.injuries, 80)}
health_condition=${truncateText(health.health_condition, 80)}
target_duration_minutes=${durationMinutes}

${buildSafetyPromptAddendum(trainingContext.safetyContext)}

EXERCISE_CATALOG:
${exerciseCatalog}

Rules:
- Return exactly one entry in workout_plan.days; do not create a weekly plan.
- Use only EX## references from EXERCISE_CATALOG. Never invent exercises.
- Select 4 to 6 eligible exercises, suitable for the goal, equipment and safety constraints.
- duration_minutes must be exactly ${durationMinutes}.
- Every exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, target_rpe, load_instruction and order_index.
- Use 3 or 4 sets and exactly "12-13" reps for every exercise. Distribute the exercises, rest and transitions so the complete session fits the target duration.
- Use conservative weight_kg; use 0 for bodyweight exercises.

JSON schema:
{
  "workout_plan": {
    "plan_name": "Lich tap hom nay",
    "explanation": "short Vietnamese explanation",
    "days": [{
      "day_of_week": 0,
      "type": "workout",
      "duration_minutes": ${durationMinutes},
      "exercises": [{
        "exercise_id": "EX01", "sets": 4, "reps": "12-13", "weight_kg": 0,
        "rest_seconds": 90, "target_rpe": 7, "load_instruction": "short cue", "order_index": 0
      }]
    }]
  }
}`;

    const groqResult = await callGroqJson({
      messages: [
        { role: 'system', content: 'You are Fitly AI Coach. Return valid JSON only, with no markdown or commentary.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.35,
      max_tokens: 1400,
    });

    const parsed = resolveAiExerciseReferences(
      parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || ''),
      exerciseReferenceIds,
    );
    const proposalValidation = validateExerciseProposal(parsed, eligibilityContext, exercises);
    if (!proposalValidation.valid) {
      return res.status(422).json({ error: 'AI workout proposal contains an ineligible or invalid exercise.', details: proposalValidation.errors });
    }
    const normalizedPlan = normalizeAiPlanPayload(parsed, { requireMealPlan: false });
    if (normalizedPlan.workoutPlan.days.length !== 1) {
      return res.status(422).json({ error: 'AI must return exactly one workout day.' });
    }
    const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
    const guardedWorkout = sanitizeWorkoutPlanForUser(normalizedPlan.workoutPlan, trainingContext.safetyContext, exerciseById);
    if (guardedWorkout.removedCount > 0) {
      return res.status(422).json({ error: 'AI workout proposal failed safety revalidation.', details: guardedWorkout.warnings });
    }
    const workoutDay = guardedWorkout.workoutPlan.days[0];
    if (workoutDay.is_rest_day || workoutDay.exercises.length === 0) {
      return res.status(422).json({ error: 'AI must create at least one exercise for this daily workout.' });
    }

    const dailyWorkoutRes = await supabase
      .from('daily_workout_sessions')
      .insert({
        user_id: authUserId,
        weekly_plan_id: null,
        log_date: logDate,
        title: truncateText(guardedWorkout.workoutPlan.plan_name || 'AI Daily Workout', 120),
        duration_minutes: durationMinutes,
        calories_burned: 0,
        status: 'planned',
      })
      .select('id')
      .single();
    if (dailyWorkoutRes.error) throw dailyWorkoutRes.error;
    createdWorkoutSessionId = String(dailyWorkoutRes.data.id);

    const bodyWeightKg = Number(bodyMetricsRes.data?.weight || 70);
    const dailyRows = await Promise.all(workoutDay.exercises.map(async (item: any, index: number) => {
      const exerciseId = String(item.exercise_id || '');
      const exercise = exerciseById.get(exerciseId);
      if (!exercise) throw new ApiRequestError(422, { error: `AI selected an invalid exercise id: ${exerciseId}` });
      const prescription = await prescribeWorkoutExercise({
        userId: authUserId,
        exerciseId,
        exercise,
        source: 'ai_plan',
        suggestedSets: item.sets,
        suggestedReps: item.reps,
        suggestedWeightKg: item.weight_kg,
        suggestedRestSeconds: item.rest_seconds,
        suggestedTargetRpe: item.target_rpe,
      });
      return buildDailyExerciseSessionRow({
        userId: authUserId,
        logDate,
        exerciseId,
        orderIndex: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : index,
        plannedSets: prescription.sets,
        plannedReps: prescription.reps,
        plannedWeightKg: prescription.weightKg,
        plannedRestSeconds: prescription.restSeconds,
        targetRpe: prescription.targetRpe,
        estimatedKcal: prescription.estimatedKcal || estimateWorkoutKcal({ exercise, bodyWeightKg, sets: prescription.sets, repsText: prescription.reps, weightKg: prescription.weightKg || 0, restSeconds: prescription.restSeconds }),
        loadAdjustmentNote: prescription.loadInstruction || String(item.load_instruction || item.note || '').slice(0, 160) || null,
      });
    }));
    const insertedDailyRes = await supabase.from('daily_exercise_sessions').insert(dailyRows).select('*');
    if (insertedDailyRes.error) throw insertedDailyRes.error;
    createdDailyExerciseIds = (insertedDailyRes.data || []).map((item: any) => String(item.id));

    const snapshotRes = await supabase.from('daily_workout_session_exercises').insert(
      (insertedDailyRes.data || []).map((dailyExerciseSession: any) => buildWorkoutSessionExerciseRow({
        sessionId: createdWorkoutSessionId!,
        dailyExerciseSession,
      })),
    );
    if (snapshotRes.error) throw snapshotRes.error;

    const quotaRes = await adminSupabase.from('ai_plan_adjustments').insert({
      user_id: authUserId,
      plan_type: 'workout',
      source_type: 'ai_coach_generate',
      source_id: createdWorkoutSessionId,
      old_data: { log_date: logDate },
      new_data: { log_date: logDate, daily_workout_session_id: createdWorkoutSessionId },
      reason: truncateText(guardedWorkout.workoutPlan.explanation || 'AI created a daily workout.', 300),
      created_by: 'ai',
      status: 'applied',
      applied_at: new Date().toISOString(),
    });
    if (quotaRes.error) throw quotaRes.error;

    const dailyRowsRes = await supabase
      .from('daily_exercise_sessions')
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('order_index', { ascending: true });
    if (dailyRowsRes.error) throw dailyRowsRes.error;
    const nextAccessState = await getAiCoachAccessState(profile, authUserId);
    return res.json({
      success: true,
      data: {
        exercises: dailyRowsRes.data || [],
        workoutSessionId: createdWorkoutSessionId,
        logDate,
        source: 'ai_daily_workout',
        aiQuota: buildAiQuotaSnapshot(nextAccessState),
      },
    });
  } catch (error: any) {
    if (createdWorkoutSessionId) {
      await supabase.from('daily_workout_session_exercises').delete().eq('session_id', createdWorkoutSessionId);
    }
    if (createdDailyExerciseIds.length > 0) {
      await supabase.from('daily_exercise_sessions').delete().in('id', createdDailyExerciseIds);
    }
    if (createdWorkoutSessionId) {
      await supabase.from('daily_workout_sessions').delete().eq('id', createdWorkoutSessionId);
    }
    console.error('[ai-coach-generate-daily-workout] failed:');
    if (error instanceof AppError) return next(error);
    if (error instanceof ApiRequestError) return res.status(error.status).json(error.body);
    if (isDatabaseMigrationRequiredError(error)) return res.status(503).json(databaseMigrationRequiredResponse);
    return res.status(500).json({ code: 'AI_GENERATION_FAILED', error: 'Khong the tao lich tap hom nay. Vui long thu lai sau.' });
  }
};

const callGroqWithRetry = callGroqJson;

const generateAiWeeklyPlan: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { weekStartDate } = req.body || {};
    const userId = authUserId;
    const weekStartKey = toMondayWeekKey(weekStartDate || getVietnamDateKey());
    if (!weekStartKey) return res.status(400).json({ error: 'weekStartDate must be a valid calendar date' });

    const [
      profileRes,
      bodyMetricsRes,
      lifestyleRes,
      healthRes,
      exerciseCatalogRes,
      recentSessionsRes,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('body_metrics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern')
        .limit(AI_EXERCISE_CATALOG_FETCH_LIMIT),
      supabase
        .from('daily_exercise_sessions')
        .select('log_date, exercise_id, sets, reps, weight_kg, rest_seconds, is_completed, exercises:exercise_id(name, body_part, target_muscle)')
        .eq('user_id', userId)
        .order('log_date', { ascending: false })
        .limit(20),
    ]);

    const firstError = [
      profileRes.error,
      bodyMetricsRes.error,
      lifestyleRes.error,
      healthRes.error,
      exerciseCatalogRes.error,
      recentSessionsRes.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    let profile = profileRes.data || {};
    const bodyMetrics = bodyMetricsRes.data || {};
    let lifestyle = lifestyleRes.data || {};
    let health = healthRes.data || {};
    const trainingContext = await synchronizeTrainingProfileContext({ userId, profile, lifestyle, health });
    profile = trainingContext.profile;
    lifestyle = trainingContext.lifestyle;
    health = trainingContext.health;
    const { safetyContext, trainingPrescription } = trainingContext;
    const eligibilityContext = buildExerciseEligibilityContext(safetyContext);
    const recentExerciseIds: Set<string> = new Set<string>(
      (recentSessionsRes.data || []).map((item: any) => String(item.exercise_id || '')).filter(Boolean)
    );
    const exercises = rankExercises(
      getEligibleExercises(exerciseCatalogRes.data as unknown[], eligibilityContext),
      eligibilityContext,
      { recentExerciseIds },
    )
      .slice(0, AI_EXERCISE_CATALOG_LIMIT)
      .map(({ exercise }: any) => exercise);

    const weeklyWorkoutDays = trainingPrescription.weeklyWorkouts;
    const exerciseIds = new Set(exercises.map((item: any) => String(item.id)));
    const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
    const accessState = await getAiCoachAccessState(profile, userId);

    if (!profileRes.data?.id) {
      return res.status(403).json({
        code: 'PROFILE_REQUIRED',
        error: 'Vui long hoan thanh ho so de AI Coach co the tao lo trinh cho ban.'
      });
    }

    if (accessState.membershipTier === 'free') {
      if (req.body?.planScope !== 'workout_only') {
        return next(new AppError(403, 'PREMIUM_REQUIRED', 'Gói Free chỉ tạo lịch tập 7 ngày trong khảo sát ban đầu. Nâng cấp Plus hoặc Pro để tạo kế hoạch mới.'));
      }
      const priorPlans = await supabase.from('weekly_plans')
        .select('id, week_start_date, plan_status')
        .eq('user_id', userId)
        .in('plan_status', ['active', 'completed', 'adjusted'])
        .order('created_at', { ascending: true })
        .limit(1);
      if (priorPlans.error) throw priorPlans.error;
      const priorPlan = priorPlans.data?.[0];
      if (priorPlan) {
        if (priorPlan.plan_status === 'active' && priorPlan.week_start_date === weekStartKey) {
          return res.json({ success: true, data: {
            weeklyPlanId: priorPlan.id,
            weekStartDate: weekStartKey,
            trainingPrescription,
            membershipTier: 'free',
            aiQuota: buildAiQuotaSnapshot(accessState),
            source: 'existing',
          } });
        }
        return next(new AppError(403, 'PREMIUM_REQUIRED', 'Gói Free chỉ được tạo lịch tập và thực đơn 7 ngày một lần khi hoàn tất khảo sát. Nâng cấp Plus hoặc Pro để tạo kế hoạch mới.'));
      }
    }

    if (!accessState.canGenerate) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'planGenerations'));
    }
    if (!process.env.GROQ_API_KEY) return next(new InternalConfigurationError());

    const { text: exerciseCatalog, referenceIds: exerciseReferenceIds } = buildAiExerciseCatalog(exercises);

    const recentTraining = clampList(recentSessionsRes.data as any[], 6)
      .map((item: any) => `${item.log_date}|${truncateText(item.exercises?.name || item.exercise_id, 32)}|${item.sets}x${item.reps}|${item.weight_kg || 0}kg|done=${!!item.is_completed}`)
      .join('\n') || 'No recent training history.';

    const todayKey = getVietnamDateKey();
    const todayDate = new Date(`${todayKey}T00:00:00`);
    const todayDay = todayDate.getDay();
    const todayDayIndex = todayDay === 0 ? 6 : todayDay - 1;

    const promptHeader = 'Generate one personalized 7-day workout plan only.\nUse only EX## references from EXERCISE_CATALOG. Return valid JSON only.';
    const rulesPrompt = `
Rules:
- Respect SAFETY_CONSTRAINTS above. They override weekly_workouts and all other goals.
- Exactly 7 days, day_of_week 0..6 where 0 is Monday and 6 is Sunday.
- Today's day_of_week index is ${todayDayIndex} (0=Monday, 6=Sunday). Ensure scheduled workout days prioritize starting on or after day_of_week ${todayDayIndex} (i.e. starting from TODAY), so the user gets workout sessions starting today and upcoming days rather than on days that have already passed in the current week.
- Never create new exercises. Use the EX## reference code from EXERCISE_CATALOG for every exercise_id.
- Prefer exercise difficulty, goal_type, movement_pattern, equipment and duration that match the user profile.
- Avoid exercises whose contraindications conflict with injuries or health conditions.
- Create exactly ${weeklyWorkoutDays} training days. All other days must be rest days with is_rest_day=true and no exercises.
- Every day must include an exercises array. For every rest day, return "exercises": [].
- Every training day must have duration_minutes exactly ${trainingPrescription.durationMinutes}; rest days must have duration_minutes=0.
- Each exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, target_rpe, load_instruction, order_index.
- weight_kg should be conservative. Use 0 for bodyweight.
- Do not include meal_plan. The app handles meals in a dedicated step.
`;
    const jsonSchemaPrompt = `
JSON schema (fixed):
{
  "workout_plan": {
    "plan_name": "Beginner Fat Loss - Week 1",
    "goal": "fat_loss",
    "days": [
      {
        "day": "Monday",
        "type": "workout",
        "duration_minutes": 25,
        "exercises": [
           {
             "exercise_id": "EX01",
             "sets": 3,
             "reps": 12,
             "weight_kg": 12.5,
             "rest_seconds": 60,
             "target_rpe": 7,
             "load_instruction": "chon muc ta con du 2 reps",
             "note": "short coaching note"
           }
        ]
      }
    ],
    "explanation": "short explanation in Vietnamese"
  }
}
`;

    const prompt = `
${promptHeader}

USER_PROFILE:
name=${truncateText(profile.full_name, 40)}
gender=${truncateText(profile.gender, 12)}
birthday=${truncateText(profile.birthday, 20)}
weight_kg=${bodyMetrics.weight || ''}
height_cm=${bodyMetrics.height || ''}
target_weight_kg=${bodyMetrics.target_weight || ''}
body_fat=${bodyMetrics.body_fat || bodyMetrics.body_fat_percentage || ''}
fitness_goal=${truncateText(lifestyle.fitness_goal, 40)}
experience_level=${truncateText(lifestyle.experience_level, 20)}
activity_level=${truncateText(lifestyle.activity_level, 20)}
weekly_workouts=${weeklyWorkoutDays}
workout_duration_minutes=${lifestyle.workout_duration || ''}
workout_location=${truncateText(lifestyle.workout_location, 24)}
equipment_available=${truncateText(lifestyle.equipment_available, 60)}
health_condition=${truncateText(health.health_condition, 80)}
injuries=${truncateText(health.injuries, 80)}
medications=${truncateText(health.medications, 60)}
sleep_hours=${health.sleep_hours || ''}
sleep_quality=${truncateText(health.sleep_quality, 20)}
stress_level=${truncateText(health.stress_level, 20)}

RECENT_TRAINING:
${recentTraining}

${buildSafetyPromptAddendum(safetyContext)}

EXERCISE_CATALOG:
${exerciseCatalog || 'No safe exercise ids available after hard safety filtering. Use rest/recovery days only.'}

${rulesPrompt}
${jsonSchemaPrompt}
`;

    const groqResult = await callGroqWithRetry({
      messages: [
        {
          role: 'system',
          content: 'You are Fitly AI Coach. Return valid JSON only, with no markdown or commentary.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.35,
      max_tokens: 1800,
    });

    const parsed = resolveAiExerciseReferences(
      parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || ''),
      exerciseReferenceIds,
    );
    const proposalValidation = validateExerciseProposal(parsed, eligibilityContext, exercises, {
      allowEmpty: true,
      requireSevenDays: true,
    });
    if (!proposalValidation.valid) {
      return res.status(422).json({
        error: 'AI workout proposal contains an ineligible or invalid exercise.',
        details: proposalValidation.errors,
      });
    }
    const normalizedPlan = normalizeAiPlanPayload(parsed, { requireMealPlan: false });
    const guardedWorkout = sanitizeWorkoutPlanForUser(
      normalizedPlan.workoutPlan,
      safetyContext,
      exerciseById
    );
    if (guardedWorkout.removedCount > 0) {
      return res.status(422).json({
        error: 'AI workout proposal failed safety revalidation.',
        details: guardedWorkout.warnings,
      });
    }
    normalizedPlan.workoutPlan = enforceTrainingPrescription(guardedWorkout.workoutPlan, trainingPrescription);
    normalizedPlan.workoutPlan = balanceWorkoutDays(normalizedPlan.workoutPlan, trainingPrescription.weeklyWorkouts);
    normalizedPlan.workoutPlan = startWorkoutPlanOnCreationDay(normalizedPlan.workoutPlan, weekStartKey);

    const weeklyPlanId = crypto.randomUUID();

    const workoutRows: any[] = [];
    for (const day of normalizedPlan.workoutPlan.days || []) {
      const dayIndex = Math.max(0, Math.min(6, Number(day.day_of_week) || 0));
      if (day.is_rest_day || !Array.isArray(day.exercises) || day.exercises.length === 0) {
        workoutRows.push({
          weekly_plan_id: weeklyPlanId,
          day_of_week: dayIndex,
          exercise_id: null,
          sets: 0,
          reps: '0',
          weight_kg: 0,
          rest_seconds: 0,
          order_index: 0,
          is_rest_day: true,
          planned_sets: 0,
          planned_reps: '0',
          planned_weight_kg: 0,
          planned_rest_seconds: 0,
          target_rpe: 0,
          estimated_kcal: 0,
          ai_note: null,
          load_instruction: null
        });
        continue;
      }

      for (const [index, item] of day.exercises.entries()) {
        const exerciseId = String(item.exercise_id || '');
        if (!exerciseIds.has(exerciseId)) {
          return res.status(422).json({ error: `AI selected an invalid exercise id: ${exerciseId}` });
        }
        const exercise = exerciseById.get(exerciseId);
        const prescription = await prescribeWorkoutExercise({
          userId,
          exerciseId,
          exercise,
          source: 'ai_plan',
          suggestedSets: item.sets,
          suggestedReps: item.reps,
          suggestedWeightKg: item.weight_kg,
          suggestedRestSeconds: item.rest_seconds,
          suggestedTargetRpe: item.target_rpe
        });
        workoutRows.push(
          buildWeeklyWorkoutPlanRow({
            weeklyPlanId,
            dayIndex,
            item: { ...item, exercise_id: exerciseId },
            orderIndex: index,
            exercise,
            bodyWeightKg: Number(bodyMetrics.weight || 70),
            prescription
          })
        );
      }
    }
    const publication = await adminSupabase.rpc('publish_coach_plan_atomically', {
      p_user_id: userId, p_week_start: weekStartKey,
      p_workout_id: weeklyPlanId, p_workout_meta: { name: normalizedPlan.workoutPlan.plan_name || 'AI Coach Week Plan', explanation: truncateText(normalizedPlan.workoutPlan.explanation || '',500) },
      p_workout_rows: workoutRows, p_meal_id: null, p_meal_meta: null, p_meal_rows: null, p_source: 'ai_coach_generate',
      p_safety: { profile: profile.updated_at, health: health.updated_at ?? null, lifestyle: lifestyle.updated_at ?? null },
    });
    if (publication.error?.code === '40001') return res.status(409).json({ error: 'Hồ sơ đã thay đổi trong lúc tạo kế hoạch. Hãy tải lại và thử lại.' });
    if (publication.error) throw publication.error;

    return res.json({
      success: true,
      data: {
        weeklyPlanId,
        workoutItems: workoutRows.length,
        weekStartDate: weekStartKey,
        trainingPrescription,
        membershipTier: accessState.membershipTier,
        aiQuota: buildAiQuotaSnapshot(accessState, 'planGenerations'),
        ai_json: {
          workout_plan: normalizedPlan.workoutPlan
        }
      }
    });
  } catch (error: any) {
    console.error('[ai-coach-generate] failed:');
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    if (isDatabaseMigrationRequiredError(error)) {
      return res.status(503).json(databaseMigrationRequiredResponse);
    }
    return res.status(500).json({
      code: 'AI_GENERATION_FAILED',
      error: 'Không thể tạo lịch AI 7 ngày lúc này. Vui lòng thử lại sau.'
    });
  }
};

type AiMealGenerationScope = 'day' | 'week';

// Shared meal-generation primitive. The survey asks it for a whole week while
// the Diet page asks for just the selected day; both use the same user context,
// safety filters, food catalog, prompt rules, and result normalisation.
const generateAiMealDraft = async (params: {
  userId: string;
  weekStartKey: string;
  scope: AiMealGenerationScope;
  targetDayIndex?: number;
}) => {
  const { userId, weekStartKey, scope } = params;
  const targetDayIndex = Math.max(0, Math.min(6, Number(params.targetDayIndex) || 0));
  if (!process.env.GROQ_API_KEY) {
    throw new InternalConfigurationError();
  }

  const [profileRes, bodyMetricsRes, lifestyleRes, healthRes, recipeRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('body_metrics').select('weight').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('recipes')
      .select('id, name, name_en, description, meal_type, dietary_restrictions, diet_styles, goal_type, price_level, estimated_cost_min_vnd, estimated_cost_max_vnd, calories, protein, carbs, fat, serving_size, serving_unit, cooking_time_minutes, cooking_difficulty, allergens, instructions, image_url, region, is_active, recipe_ingredients(id, recipe_id, ingredient_name, amount, unit, preparation_note, is_optional, order_index)')
      .eq('is_active', true)
      .limit(AI_FOOD_CATALOG_FETCH_LIMIT),
  ]);
  const firstError = [profileRes.error, bodyMetricsRes.error, lifestyleRes.error, healthRes.error, recipeRes.error].find(Boolean);
  if (firstError) throw firstError;

  if (!profileRes.data?.id) {
    throw new ApiRequestError(403, { code: 'PROFILE_REQUIRED', error: 'Vui lòng hoàn thành hồ sơ trước.' });
  }

  const lifestyle = lifestyleRes.data || {};
  const health = healthRes.data || {};
  const safetyContext = { profile: profileRes.data || {}, lifestyle, health };
  const mealsPerDay = resolveMealPlanningMealsPerDay(lifestyle.meals_per_day);
  const mealSlots = getMealPlanningSlots(mealsPerDay);
  // Recipe mode is selected only when the database has an active recipe catalog.
  // Once selected, an empty hard-filtered pool is an explicit error; it must not
  // fall through to the full foods catalog and undo an allergy/restriction gate.
  const recipeRows = (recipeRes.data || []) as RecipeCandidate[];
  const recipeContext = buildRecipeEligibilityContext(safetyContext);
  const eligibleRecipes = recipeRows.length > 0 ? filterEligibleRecipes(recipeRows, recipeContext) : [];

  if (recipeRows.length > 0 && eligibleRecipes.length > 0) {
    try {
      // Shuffle eligible recipes slightly to give varied recommendations when clicking generate multiple times
      const shuffledEligibleRecipes = [...eligibleRecipes].sort(() => Math.random() - 0.5);
      const compactRecipes = buildCompactRecipeCatalog(shuffledEligibleRecipes, 20);
      const recipeById = new Map(recipeRows.map((recipe: any) => [String(recipe.id || ''), recipe]));
      const dayRule = scope === 'week'
        ? 'exactly 7 days indexed 0..6, each day exactly once'
        : `exactly one day with day_of_week=${targetDayIndex}`;
      const requestLabel = scope === 'week' ? 'a 7-day recipe meal plan' : `the recipe meal plan for day index ${targetDayIndex}`;
      const recipeCatalog = compactRecipes.map((recipe: any) => (
        `${recipe.id}|${truncateText(recipe.name, 36)}|meal=${recipe.meal_type.join(',')}|diet=${recipe.dietary_restrictions.join(',')}|style=${recipe.diet_styles.join(',')}|k=${recipe.calories}|p=${recipe.protein}|c=${recipe.carbs}|f=${recipe.fat}|price=${recipe.price_level}|time=${recipe.cooking_time_minutes}`
      )).join('\n');
      const prompt = `Generate ${requestLabel} only. Return valid JSON only.\nUSER: cooking=${lifestyle.cooking_ability || ''}; budget=${lifestyle.budget_level || ''}; goal=${lifestyle.fitness_goal || ''}; target_calories=${lifestyle.target_calories || ''}; meals_per_day=${mealsPerDay}.\n${buildSafetyPromptAddendum(safetyContext)}\nRULES: ${dayRule}; exactly ${mealsPerDay} meals/day using only ${mealSlots.join(', ')}; use only RECIPE_CATALOG recipe_id values; select varied and diverse recipes across days/meals; a recipe is already a complete dish, so never return food_ids or add carb/protein/vegetable components; do not invent IDs.\nRECIPE_CATALOG:\n${recipeCatalog}\nJSON: {"meal_plan":{"target_calories":1800,"days":[{"day_of_week":${scope === 'week' ? 0 : targetDayIndex},"meals":[{"meal_type":"breakfast","recipe_id":"exact id from catalog","servings":1,"notes":"optional"}]}]}}`;
      const result = await callGroqWithRetry({
        messages: [
          { role: 'system', content: 'You are Fitly AI Coach. Return valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.65,
        max_tokens: scope === 'week' ? 950 : 400,
      });
      const mealPlan = parseJsonFromAiText(result.choices?.[0]?.message?.content || '')?.meal_plan || {};
      const rawDays = Array.isArray(mealPlan.days) ? mealPlan.days : [];
      const expectedDays = scope === 'week' ? [0, 1, 2, 3, 4, 5, 6] : [targetDayIndex];
      const compactRecipeCandidates = compactRecipes.map((item: any) => recipeById.get(item.id)!).filter(Boolean);
      const targetCalories = Number(lifestyle.target_calories || mealPlan.target_calories || 1800);

      const daysByExpectedIndex = new Map<number, any>();
      rawDays.forEach((rawDay: any, idx: number) => {
        let dayIndex = toDayOfWeekIndex(rawDay?.day_of_week ?? rawDay?.day);
        if (dayIndex < 0 || dayIndex > 6) dayIndex = expectedDays[idx % expectedDays.length];
        if (!daysByExpectedIndex.has(dayIndex)) {
          daysByExpectedIndex.set(dayIndex, rawDay);
        }
      });

      const firstRawDay = rawDays[0] || { meals: [] };
      const rows: any[] = [];
      const normalizedDays: any[] = [];

      for (const expectedDayIndex of expectedDays) {
        const rawDay = daysByExpectedIndex.get(expectedDayIndex) || firstRawDay;
        const repairedMeals = sanitizeAndBalanceRecipeProposal(
          rawDay?.meals,
          compactRecipeCandidates,
          recipeContext,
          mealSlots as any,
          targetCalories,
        );

        normalizedDays.push({ day_of_week: expectedDayIndex, is_rest_day: false, meals: repairedMeals });
        repairedMeals.forEach((item: any, index: number) => {
          const recipe = recipeById.get(item.recipe_id) || compactRecipeCandidates[0];
          if (!recipe) return;
          rows.push({
            day_of_week: expectedDayIndex, meal_type: item.meal_type, recipe_id: String(recipe.id),
            name: String(recipe.name || 'Món ăn AI chọn'), image_url: String(recipe.image_url || ''), category: 'recipe',
            serving_unit: String(recipe.serving_unit || 'serving'), quantity: item.servings,
            servings: item.servings, notes: item.notes || '', calories: Number(recipe.calories || 0),
            protein: Number(recipe.protein || 0), carbs: Number(recipe.carbs || 0), fat: Number(recipe.fat || 0),
            estimated_cost_min_vnd: recipe.estimated_cost_min_vnd === null || recipe.estimated_cost_min_vnd === undefined ? null : Number(recipe.estimated_cost_min_vnd),
            recipe_ingredients: Array.isArray(recipe.recipe_ingredients)
              ? recipe.recipe_ingredients.map((ing: any) => ({
                  ingredient_name: String(ing.ingredient_name || 'Nguyên liệu'),
                  amount: ing.amount === null || ing.amount === undefined ? null : Number(ing.amount),
                  unit: ing.unit || null,
                  preparation_note: ing.preparation_note || null,
                  food: ing.foods || null,
                }))
              : [],
            order_index: index, is_rest_day: false,
          });
        });
      }
      return {
        mealPlan: { target_calories: targetCalories, explanation: '', days: normalizedDays },
        rows,
        nutritionTargets: calculateNutritionMacroTargets({ targetCalories, fitnessGoal: lifestyle.fitness_goal, dietPreference: lifestyle.diet_preference, weightKg: bodyMetricsRes.data?.weight }),
        mode: 'recipe' as const,
        safetyVersion: { profile: profileRes.data.updated_at, health: healthRes.data?.updated_at ?? null, lifestyle: lifestyleRes.data?.updated_at ?? null },
      };
    } catch (recipeError: any) {
      if (recipeError instanceof ApiRequestError) throw recipeError;
      throw toAiProviderRequestError(recipeError?.message || 'Groq AI request failed');
    }
  }

  throw new ApiRequestError(500, { error: 'Không tìm thấy công thức ăn uống phù hợp trong danh mục.' });
};

const generateAiMealPlan: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const profileRes = await supabase.from('profiles').select('id, membership_tier, membership_expires_at, created_at').eq('id', userId).maybeSingle();
    const accessState = await getAiCoachAccessState(profileRes.data || {}, userId);
    if (accessState.membershipTier === 'free') {
      return next(new AppError(403, 'PREMIUM_REQUIRED', 'Gói Free chỉ nhận thực đơn 7 ngày khi hoàn tất khảo sát ban đầu. Nâng cấp Plus hoặc Pro để tạo thực đơn mới bằng AI.'));
    }
    if (!accessState.canUseMealAdjustment) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'mealAdjustments'));
    }

    const scopeInput = String(req.body?.scope || 'day').toLowerCase();
    if (scopeInput !== 'day' && scopeInput !== 'week') return res.status(400).json({ error: 'scope must be day or week' });
    const scope: AiMealGenerationScope = scopeInput;
    const weekStartKey = toMondayWeekKey(req.body?.weekStartDate || getVietnamDateKey());
    if (!weekStartKey) return res.status(400).json({ error: 'weekStartDate must be a valid calendar date' });
    const targetDayIndex = scope === 'day' ? Number(req.body?.dayIndex) : 0;
    if (!Number.isInteger(targetDayIndex) || targetDayIndex < 0 || targetDayIndex > 6) {
      return res.status(400).json({ error: 'dayIndex must be an integer between 0 and 6' });
    }
    const draft = await generateAiMealDraft({ userId, weekStartKey, scope, targetDayIndex });
    const operationId = aiOperationContext.getStore()?.id;
    if (!operationId) throw new Error('AI operation context unavailable');
    const saved = await persistGeneratedMealPlan({
      userId, weekStartKey, scope, targetDayIndex, generatedRows: draft.rows,
      safetyVersion: draft.safetyVersion, operationId,
    });

    const generationRecord = await adminSupabase.from('ai_plan_adjustments').insert({
      user_id: userId,
      plan_type: 'meal',
      source_type: 'ai_meal_generate',
      old_plan_id: saved.oldPlanId,
      new_plan_id: saved.planId,
      old_data: {},
      new_data: { day_index: targetDayIndex, scope, plan_id: saved.planId, version: saved.version },
      reason: 'Tạo thực đơn AI cho ngày',
      created_by: 'user',
      status: 'applied',
      applied_at: new Date().toISOString()
    });
    if (generationRecord.error) console.error('[ai-coach-generate-meal] audit insert failed:', generationRecord.error.code);
    void recordAiQuotaUsage(userId, 'mealAdjustments').catch(() => null);

    return res.json({
      success: true,
      data: {
        scope,
        weekStartDate: weekStartKey,
        dayIndex: scope === 'day' ? targetDayIndex : null,
        planId: saved.planId,
        version: saved.version,
        mealItems: draft.rows,
        nutritionTargets: draft.nutritionTargets,
        ai_json: { meal_plan: draft.mealPlan },
      },
    });
  } catch (error: any) {
    console.error('[ai-coach-generate-meal] failed:', error?.code || error?.name || 'unknown');
    if (error instanceof ApiRequestError) return res.status(error.status).json(error.body);
    return next(error);
  }
};

const recordAiMealSwap: RequestHandler = (_req, _res, next) => next(new AppError(410, 'CLIENT_UPDATE_REQUIRED', 'Hãy tải lại Fitly để đổi món bằng luồng lưu mới.'));

// The onboarding flow deliberately generates meals in a second, smaller request.
// Workout generation already happened after the training survey; regenerating it
// here wastes Groq tokens and replaces a plan the user has just reviewed.
const generateAiOnboardingMealPlan: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const weekStartKey = toMondayWeekKey(req.body?.weekStartDate || getVietnamDateKey());
    if (!weekStartKey) return res.status(400).json({ error: 'weekStartDate must be a valid calendar date' });
    const [profileRes, workoutPlanRes, foodPlanRes] = await Promise.all([
      supabase.from('profiles').select('id, membership_tier, membership_expires_at, created_at').eq('id', userId).maybeSingle(),
      supabase.from('weekly_plans').select('id').eq('user_id', userId).eq('week_start_date', weekStartKey).eq('plan_status', 'active').limit(1),
      supabase.from('weekly_food_plans').select('id').eq('user_id', userId).eq('week_start_date', weekStartKey).eq('plan_status', 'active').limit(1),
    ]);
    const firstError = [profileRes.error, workoutPlanRes.error, foodPlanRes.error].find(Boolean);
    if (firstError) throw firstError;
    const accessState = await getAiCoachAccessState(profileRes.data || {}, userId);
    const existingFoodPlanId = foodPlanRes.data?.[0]?.id;
    if (existingFoodPlanId) {
      const [lifestyleRes, bodyMetricsRes] = await Promise.all([
        supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('body_metrics').select('weight').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const lifestyle = lifestyleRes.data || {};
      const targetCalories = Number(lifestyle.target_calories || 1800);
      const nutritionTargets = calculateNutritionMacroTargets({
        targetCalories,
        fitnessGoal: lifestyle.fitness_goal,
        dietPreference: lifestyle.diet_preference,
        weightKg: bodyMetricsRes.data?.weight,
      });
      return res.json({
        success: true,
        data: {
          weeklyPlanId: workoutPlanRes.data?.[0]?.id || null,
          foodPlanId: existingFoodPlanId,
          weekStartDate: weekStartKey,
          nutritionTargets,
          ai_json: { meal_plan: { target_calories: targetCalories } },
        },
      });
    }

    if (accessState.membershipTier === 'free') {
      const priorFoodPlans = await supabase.from('weekly_food_plans')
        .select('id')
        .eq('user_id', userId)
        .in('plan_status', ['active', 'completed', 'adjusted'])
        .limit(1);
      if (priorFoodPlans.error) throw priorFoodPlans.error;
      if (priorFoodPlans.data?.length) {
        return next(new AppError(403, 'PREMIUM_REQUIRED', 'Gói Free chỉ được tạo thực đơn 7 ngày một lần khi hoàn tất khảo sát. Nâng cấp Plus hoặc Pro để tạo thực đơn mới.'));
      }
      if (!workoutPlanRes.data?.[0]?.id) {
        return res.status(409).json({ error: 'Lịch tập 7 ngày chưa sẵn sàng. Vui lòng hoàn tất khảo sát trước.' });
      }
    }
    if (!process.env.GROQ_API_KEY) return next(new InternalConfigurationError());

    const draft = await generateAiMealDraft({ userId, weekStartKey, scope: 'week' });
    const foodPlanId = crypto.randomUUID();
    const publication = await adminSupabase.rpc('publish_coach_plan_atomically', {
      p_user_id: userId, p_week_start: weekStartKey,
      p_workout_id: null, p_workout_meta: null, p_workout_rows: null,
      p_meal_id: foodPlanId, p_meal_meta: { name: 'AI Coach Meal Plan', explanation: truncateText(draft.mealPlan.explanation || '',500) },
      p_meal_rows: draft.rows, p_source: 'onboarding_meal_generate', p_safety: draft.safetyVersion,
    });
    if (publication.error?.code === '40001') return res.status(409).json({ error: 'Hồ sơ đã thay đổi trong lúc tạo kế hoạch. Hãy tải lại và thử lại.' });
    if (publication.error) throw publication.error;
    return res.json({
      success: true,
      data: {
        weeklyPlanId: workoutPlanRes.data?.[0]?.id || null,
        foodPlanId,
        mealItems: draft.rows.length,
        weekStartDate: weekStartKey,
        nutritionTargets: draft.nutritionTargets,
        ai_json: { meal_plan: draft.mealPlan },
      },
    });

  } catch (error: any) {
    console.error('[ai-coach-onboarding-meal] failed:');
    if (error instanceof ApiRequestError) return res.status(error.status).json(error.body);
    return res.status(500).json({ code: 'AI_MEAL_GENERATION_FAILED', error: 'Không thể tạo thực đơn AI 7 ngày lúc này.' });
  }
};

  return {
    getQuota: getAiQuota,
    chat: chatWithAiCoach,
    coachCommand: executeAiCoachCommand,
    clearChat: clearAiCoachChat,
    applyAdjustment: applyAiAdjustment,
    rejectAdjustment: rejectAiAdjustment,
    metrics: getAiMetrics,
    generateDailyWorkout: generateAiDailyWorkout,
    generateWeeklyPlan: generateAiWeeklyPlan,
    generateMealPlan: generateAiMealPlan,
    recordMealSwap: recordAiMealSwap,
    generateOnboardingMealPlan: generateAiOnboardingMealPlan,
  };
};
