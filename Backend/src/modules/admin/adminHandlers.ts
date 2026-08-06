import type { RequestHandler } from 'express';

/**
 * Admin handler implementations. Dependencies are injected by the composition
 * root so privileged Supabase operations stay explicit and testable.
 */
export const createAdminHandlers = (dependencies: any) => {
  const {
    supabase,
    getVietnamDateKey,
    addDays,
    getAuthUserId,
    isAdminUser,
    requireAdminUserId,
    loadAdminCount,
    sanitizeExercisePayload,
    validateExerciseVariationReferences,
    ensureExerciseIdAvailable,
    toExercisePayloadError,
    countCatalogUsage,
    sanitizeRecipeAdminPayload,
    recipeValidationResponse,
    withRecipeIngredientMetadata,
    RECIPE_WITH_INGREDIENTS_SELECT,
    ExternalProviderError,
  } = dependencies;
const getAdminOverview: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const today = getVietnamDateKey();
    const sevenDaysAgo = addDays(new Date(), -7).toISOString();

    const [
      usersRes,
      premiumRes,
      newUsersRes,
      exercisesRes,
      foodsRes,
      aiProposedRes,
      aiAppliedRes,
      aiRejectedRes,
      workoutDoneRes,
      mealsDoneRes
    ] = await Promise.all([
      loadAdminCount('profiles', supabase.from('profiles').select('id', { count: 'exact', head: true })),
      loadAdminCount('premium profiles', supabase.from('profiles').select('id', { count: 'exact', head: true }).in('membership_tier', ['plus', 'pro', 'premium'])),
      loadAdminCount('new users', supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo)),
      loadAdminCount('exercises', supabase.from('exercises').select('id', { count: 'exact', head: true })),
      loadAdminCount('recipes', supabase.from('recipes').select('id', { count: 'exact', head: true })),
      loadAdminCount('ai proposed adjustments', supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'proposed')),
      loadAdminCount('ai applied adjustments', supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'applied')),
      loadAdminCount('ai rejected adjustments', supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'rejected')),
      loadAdminCount('today completed workouts', supabase.from('daily_exercise_sessions').select('id', { count: 'exact', head: true }).eq('log_date', today).eq('is_completed', true)),
      loadAdminCount('today completed meals', supabase.from('daily_meal_logs').select('id', { count: 'exact', head: true }).eq('log_date', today).eq('is_completed', true))
    ]);

    res.json({
      success: true,
      data: {
        users: usersRes,
        premiumUsers: premiumRes,
        newUsers7d: newUsersRes,
        exercises: exercisesRes,
        foods: foodsRes,
        aiAdjustments: {
          proposed: aiProposedRes,
          applied: aiAppliedRes,
          rejected: aiRejectedRes
        },
        todayCompletedWorkouts: workoutDoneRes,
        todayCompletedMeals: mealsDoneRes
      }
    });
  } catch {
    return next(new ExternalProviderError());
  }
};

const getAdminUsers: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
    const buildProfilesRequest = (columns: string) => {
      let request = supabase
        .from('profiles')
        .select(columns)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (query) {
        request = request.or(`full_name.ilike.%${query}%,email.ilike.%${query}%`);
      }

      return request;
    };

    const fullColumns = 'id, full_name, email, gender, birthday, role, membership_tier, membership_expires_at, created_at, updated_at';
    const fallbackColumns = 'id, full_name, email, role, membership_tier, created_at, updated_at';
    let { data, error } = await buildProfilesRequest(fullColumns);

    if (error) {
      console.warn('[admin-users] full profile query failed, retrying with minimal columns:', error.message || error);
      const fallbackResult = await buildProfilesRequest(fallbackColumns);
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch {
    return next(new ExternalProviderError());
  }
};

const listAdminExercises: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 120));
    let request = supabase
      .from('exercises')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (query) {
      request = request.or(`name.ilike.%${query}%,body_part.ilike.%${query}%,target_muscle.ilike.%${query}%,equipment.ilike.%${query}%`);
    }

    const { data, error } = await request;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch {
    return next(new ExternalProviderError());
  }
};

const createAdminExercise: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const payload = sanitizeExercisePayload(req.body, true);
    await ensureExerciseIdAvailable(String(payload.id));
    await validateExerciseVariationReferences(payload);
    const { data, error } = await supabase.from('exercises').insert(payload).select('*').single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    return next(toExercisePayloadError(error));
  }
};

const updateAdminExercise: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const exerciseId = String(req.params.id || '').trim();
    const payload = sanitizeExercisePayload(req.body, false, exerciseId);
    await validateExerciseVariationReferences(payload);
    payload.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('exercises')
      .update(payload)
      .eq('id', exerciseId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Exercise not found' });
    res.json({ success: true, data });
  } catch (error: unknown) {
    return next(toExercisePayloadError(error));
  }
};

const deleteAdminExercise: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const exerciseId = String(req.params.id || '').trim();
    const [weeklyUsage, dailyUsage] = await Promise.all([
      countCatalogUsage('weekly_plan_exercises', 'exercise_id', exerciseId),
      countCatalogUsage('daily_exercise_sessions', 'exercise_id', exerciseId)
    ]);
    if (weeklyUsage + dailyUsage > 0) {
      return res.status(409).json({
        error: 'Exercise is used in workout plans or logs and cannot be deleted safely.',
        usage: { weeklyUsage, dailyUsage }
      });
    }

    const { error } = await supabase.from('exercises').delete().eq('id', exerciseId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    return next(new ExternalProviderError());
  }
};

const listAdminRecipes: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;
    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 120));
    let request = supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).order('updated_at', { ascending: false }).limit(limit);
    if (query) request = request.or(`id.ilike.%${query}%,name.ilike.%${query}%,name_en.ilike.%${query}%,region.ilike.%${query}%`);
    const { data, error } = await request;
    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch {
    return next(new ExternalProviderError());
  }
};

const createAdminRecipe: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;
    const { recipe, ingredients } = sanitizeRecipeAdminPayload(req.body);
    const validationError = recipeValidationResponse(recipe, await withRecipeIngredientMetadata(ingredients));
    if (validationError) return res.status(422).json(validationError);
    const { data, error } = await supabase.from('recipes').insert(recipe).select('*').single();
    if (error) throw error;
    if (ingredients.length) {
      const inserted = await supabase.from('recipe_ingredients').insert(ingredients);
      if (inserted.error) throw inserted.error;
    }
    const result = await supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).eq('id', data.id).single();
    if (result.error) throw result.error;
    return res.status(201).json({ success: true, data: result.data });
  } catch {
    return next(new ExternalProviderError());
  }
};

const updateAdminRecipe: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;
    const id = String(req.params.id || '').trim();
    const { recipe, ingredients } = sanitizeRecipeAdminPayload({ ...(req.body || {}), id });
    const validationError = recipeValidationResponse(recipe, await withRecipeIngredientMetadata(ingredients));
    if (validationError) return res.status(422).json(validationError);
    const updated = await supabase.from('recipes').update({ ...recipe, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return res.status(404).json({ error: 'Recipe not found' });
    const removed = await supabase.from('recipe_ingredients').delete().eq('recipe_id', id);
    if (removed.error) throw removed.error;
    if (ingredients.length) {
      const inserted = await supabase.from('recipe_ingredients').insert(ingredients);
      if (inserted.error) throw inserted.error;
    }
    const result = await supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).eq('id', id).single();
    if (result.error) throw result.error;
    return res.json({ success: true, data: result.data });
  } catch {
    return next(new ExternalProviderError());
  }
};

const listAdminFoods: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 120));
    let request = supabase
      .from('recipes')
      .select('id, name, meal_type, calories, protein, carbs, fat, serving_unit, is_active')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (query) {
      request = request.or(`name.ilike.%${query}%`);
    }

    const { data, error } = await request;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error: any) {
    return next(new ExternalProviderError());
  }
};

const createAdminFood: RequestHandler = async (req, res) => {
  return res.status(400).json({ error: 'Bảng foods đã được hợp nhất sang kho công thức recipes.' });
};

const updateAdminFood: RequestHandler = async (req, res) => {
  return res.status(400).json({ error: 'Bảng foods đã được hợp nhất sang kho công thức recipes.' });
};

const deleteAdminFood: RequestHandler = async (req, res) => {
  return res.status(400).json({ error: 'Bảng foods đã được hợp nhất sang kho công thức recipes.' });
};

  return {
    overview: getAdminOverview,
    users: getAdminUsers,
    listExercises: listAdminExercises,
    createExercise: createAdminExercise,
    updateExercise: updateAdminExercise,
    deleteExercise: deleteAdminExercise,
    listRecipes: listAdminRecipes,
    createRecipe: createAdminRecipe,
    updateRecipe: updateAdminRecipe,
    listFoods: listAdminFoods,
    createFood: createAdminFood,
    updateFood: updateAdminFood,
    deleteFood: deleteAdminFood,
  };
};
