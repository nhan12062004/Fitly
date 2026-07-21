import { supabase } from '../config/Supabase';

const RECIPE_FOOD_CATEGORY = 'Món ăn';

const main = async () => {
  const { data: recipes, error: recipesError } = await supabase
    .from('recipes')
    .select('id, name, meal_type, dietary_restrictions, goal_type, allergens, price_level, calories, protein, carbs, fat, serving_unit, image_url, cooking_time_minutes, cooking_difficulty, region, is_active')
    .eq('is_active', true)
    .order('name');
  if (recipesError) throw recipesError;
  if (!recipes?.length) throw new Error('No active recipes found to copy into foods.');

  const names = recipes.map((recipe) => String(recipe.name || '').trim()).filter(Boolean);
  const { data: existing, error: existingError } = await supabase
    .from('foods')
    .select('id, name')
    .eq('category', RECIPE_FOOD_CATEGORY)
    .in('name', names);
  if (existingError) throw existingError;
  const existingByName = new Map((existing || []).map((food) => [String(food.name), String(food.id)]));

  let inserted = 0;
  let updated = 0;
  for (const recipe of recipes) {
    const name = String(recipe.name || '').trim();
    if (!name) throw new Error(`Recipe ${recipe.id} is missing a name.`);
    const row = {
      name,
      category: RECIPE_FOOD_CATEGORY,
      calories: Number(recipe.calories || 0),
      protein: Number(recipe.protein || 0),
      carbs: Number(recipe.carbs || 0),
      fat: Number(recipe.fat || 0),
      serving_unit: recipe.serving_unit || 'phần',
      image_url: recipe.image_url || null,
      meal_type: recipe.meal_type || [],
      goal_type: recipe.goal_type || [],
      allergens: recipe.allergens || [],
      price_level: recipe.price_level || 'medium',
      cooking_time_minutes: recipe.cooking_time_minutes ?? null,
      region: recipe.region || 'Vietnam',
      is_easy_to_prepare: recipe.cooking_difficulty === 'easy',
      dietary_tags: recipe.dietary_restrictions || [],
      ingredient_metadata: [],
      animal_source: [],
      is_active: true,
    };
    const foodId = existingByName.get(name);
    const result = foodId
      ? await supabase.from('foods').update(row).eq('id', foodId)
      : await supabase.from('foods').insert(row);
    if (result.error) throw result.error;
    if (foodId) updated += 1; else inserted += 1;
  }

  const { count, error: verifyError } = await supabase
    .from('foods')
    .select('id', { count: 'exact', head: true })
    .eq('category', RECIPE_FOOD_CATEGORY)
    .in('name', names);
  if (verifyError) throw verifyError;
  if (count !== recipes.length) throw new Error(`Verification failed: expected ${recipes.length} foods, found ${count || 0}.`);
  console.log(`Recipe-to-food sync complete: ${inserted} inserted, ${updated} updated, ${count} verified.`);
};

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
