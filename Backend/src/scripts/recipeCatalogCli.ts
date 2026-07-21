import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { supabase } from '../config/Supabase';
import { validateRecipeCatalog, type RecipeCatalogItem } from '../../../shared/recipeCatalogImport';
import type { RecipeFoodMetadata } from '../../../shared/recipeCatalog';

export type RecipeCliOptions = { file: string; expectedCount?: number; dryRun: boolean; checkFoodIds: boolean };
export const parseRecipeCliOptions = (args: string[], command: 'validate' | 'upsert' | 'verify'): RecipeCliOptions => {
  let file = 'catalog/recipe-catalog.template.json'; let expectedCount: number | undefined; let dryRun = false; let checkFoodIds = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--file' && args[index + 1]) { file = args[++index]; continue; }
    if (argument === '--expected-count' && args[index + 1]) { const count = Number(args[++index]); if (!Number.isInteger(count) || count < 0) throw new Error('--expected-count must be a non-negative integer'); expectedCount = count; continue; }
    if (argument === '--dry-run') { dryRun = true; continue; }
    if (argument === '--check-food-ids') { checkFoodIds = true; continue; }
    if (argument === '--help' || argument === '-h') { console.log(`Usage: npm run recipes:${command} -- --file path/to/recipes.json [--expected-count 200] [--check-food-ids]${command === 'upsert' ? ' [--dry-run]' : ''}`); process.exit(0); }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { file, expectedCount, dryRun, checkFoodIds };
};

export const readRecipeCatalog = async (options: RecipeCliOptions): Promise<unknown> => JSON.parse(await readFile(path.resolve(process.cwd(), options.file), 'utf8'));
export const loadFoodMetadata = async (items: unknown): Promise<Map<string, RecipeFoodMetadata>> => {
  const ids = Array.from(new Set((Array.isArray(items) ? items : []).flatMap((item: any) => Array.isArray(item?.ingredients) ? item.ingredients : []).map((ingredient: any) => String(ingredient?.food_id || '')).filter(Boolean)));
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from('foods').select('id, category, allergens, dietary_tags, ingredient_metadata, animal_source, calories, protein, carbs, fat, serving_unit, estimated_cost_min_vnd, estimated_cost_max_vnd').in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((food: any) => [String(food.id), food]));
};
export const validateCatalogFromOptions = async (options: RecipeCliOptions) => {
  const source = await readRecipeCatalog(options);
  const foodMetadataById = options.checkFoodIds ? await loadFoodMetadata(source) : undefined;
  return { source, validation: validateRecipeCatalog(source, { expectedCount: options.expectedCount, foodMetadataById }) };
};
export const printRecipeValidationSummary = (summary: ReturnType<typeof validateRecipeCatalog>['summary']) => {
  console.log(`total recipes: ${summary.total}`);
  console.log(`meal type distribution: ${JSON.stringify(summary.mealTypes)}`);
  console.log(`diet restriction distribution: ${JSON.stringify(summary.dietaryRestrictions)}`);
  console.log(`diet style distribution: ${JSON.stringify(summary.dietStyles)}`);
  console.log(`budget distribution: ${JSON.stringify(summary.budgets)}`);
  console.log(`cooking difficulty distribution: ${JSON.stringify(summary.cookingDifficulties)}`);
  console.log(`average ingredient count: ${summary.averageIngredientCount.toFixed(2)}`);
  console.log(`ingredient rows without linked food IDs: ${summary.withoutLinkedFoodIds}`);
  summary.warnings.forEach((issue) => console.warn(`warning ${issue.path}: ${issue.message}`));
  summary.errors.forEach((issue) => console.error(`error ${issue.path}: ${issue.message}`));
};
export type { RecipeCatalogItem };
