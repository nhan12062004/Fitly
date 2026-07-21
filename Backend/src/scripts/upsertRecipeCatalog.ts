import { supabase } from '../config/Supabase';
import { buildRecipeUpsertPlan } from '../../../shared/recipeCatalogImport';
import { parseRecipeCliOptions, printRecipeValidationSummary, validateCatalogFromOptions } from './recipeCatalogCli';

const main = async () => {
  const options = parseRecipeCliOptions(process.argv.slice(2), 'upsert');
  const { validation } = await validateCatalogFromOptions(options);
  printRecipeValidationSummary(validation.summary);
  if (!validation.valid) { process.exitCode = 1; return; }
  const ids = validation.items.map((item) => item.id);
  const existingRes = ids.length ? await supabase.from('recipes').select('id, recipe_ingredients(food_id, ingredient_name, amount, unit)').in('id', ids) : { data: [], error: null };
  if (existingRes.error) throw existingRes.error;
  const plan = buildRecipeUpsertPlan(validation.items, existingRes.data as any[]);
  const created = plan.filter((item) => item.operation === 'insert'); const updated = plan.filter((item) => item.operation === 'update');
  console.log(`dry run: ${options.dryRun}; new recipes: ${created.length}; updated recipes: ${updated.length}; ingredient changes: ${plan.reduce((sum, item) => sum + item.ingredientChanges, 0)}`);
  if (options.dryRun) return;
  for (const recipe of validation.items) {
    const { ingredients, ...recipeRow } = recipe;
    const recipeWrite = await supabase.from('recipes').upsert({ ...recipeRow, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (recipeWrite.error) throw recipeWrite.error;
    // Only this recipe's ingredients are replaced. Other recipe IDs are never touched.
    const removed = await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipe.id);
    if (removed.error) throw removed.error;
    if (ingredients.length) {
      const inserted = await supabase.from('recipe_ingredients').insert(ingredients.map((ingredient, order_index) => ({ ...ingredient, recipe_id: recipe.id, order_index, is_optional: ingredient.is_optional === true })));
      if (inserted.error) throw inserted.error;
    }
  }
  console.log(`upsert complete: ${validation.items.length} recipe(s).`);
};
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
