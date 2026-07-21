import { supabase } from '../config/Supabase';
import { validateRecipeCatalog } from '../../../shared/recipeCatalogImport';

const main = async () => {
  const recipes = await supabase.from('recipes').select('*, recipe_ingredients(food_id, ingredient_name, amount, unit, preparation_note, is_optional, foods:food_id(id, category, allergens, dietary_tags, ingredient_metadata, animal_source))').eq('is_active', true);
  if (recipes.error) throw recipes.error;
  const source = (recipes.data || []).map((recipe: any) => ({ ...recipe, ingredients: recipe.recipe_ingredients || [] }));
  const validation = validateRecipeCatalog(source, { foodMetadataById: new Map((recipes.data || []).flatMap((recipe: any) => (recipe.recipe_ingredients || []).filter((ingredient: any) => ingredient.foods?.id).map((ingredient: any) => [String(ingredient.foods.id), ingredient.foods]))) });
  const weekly = await supabase.from('weekly_food_items').select('id, recipe_id, recipes:recipe_id(id)').not('recipe_id', 'is', null);
  if (weekly.error) throw weekly.error;
  const brokenWeekly = (weekly.data || []).filter((item: any) => !item.recipes);
  validation.summary.errors.push(...brokenWeekly.map((item: any) => ({ path: `weekly_food_items.${item.id}.recipe_id`, message: `broken recipe id: ${item.recipe_id}`, severity: 'error' as const })));
  validation.valid = validation.summary.errors.length === 0;
  console.log(`active recipes verified: ${validation.summary.total}; broken weekly recipe refs: ${brokenWeekly.length}`);
  validation.summary.warnings.forEach((issue) => console.warn(`warning ${issue.path}: ${issue.message}`));
  validation.summary.errors.forEach((issue) => console.error(`error ${issue.path}: ${issue.message}`));
  if (!validation.valid) process.exitCode = 1;
};
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
