import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { supabase } from '../config/Supabase';
import { normalizeRecipe } from '../../../shared/recipeCatalog';
import { buildRecipeUpsertPlan, validateRecipeCatalog } from '../../../shared/recipeCatalogImport';

type Options = { sqlFile: string; apply: boolean };
type SqlRow = Record<string, unknown>;

const recipeColumns = [
  'id', 'name', 'name_en', 'description', 'meal_type', 'dietary_restrictions', 'diet_styles', 'goal_type',
  'price_level', 'estimated_cost_min_vnd', 'estimated_cost_max_vnd', 'calories', 'protein', 'carbs', 'fat',
  'serving_size', 'serving_unit', 'cooking_time_minutes', 'cooking_difficulty', 'allergens', 'instructions',
  'image_url', 'region', 'is_active',
] as const;
const ingredientColumns = ['recipe_id', 'food_id', 'ingredient_name', 'amount', 'unit', 'preparation_note', 'is_optional', 'order_index'] as const;
const usage = 'Usage: npm run recipes:import-verified-sql -- --sql path/to/catalog.sql [--apply]';

const option = (args: string[], name: string): string => {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith('-')) throw new Error(`${name} is required.\n\n${usage}`);
  return args[index + 1];
};

const parseOptions = (args: string[]): Options => {
  if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }
  const supported = new Set(['--sql', '--apply']);
  const unknown = args.find((arg) => arg.startsWith('-') && !supported.has(arg));
  if (unknown) throw new Error(`Unknown argument: ${unknown}\n\n${usage}`);
  return { sqlFile: option(args, '--sql'), apply: args.includes('--apply') };
};

const splitValues = (input: string): string[] => {
  const values: string[] = []; let token = ''; let arrayDepth = 0; let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    if (!quoted && input.startsWith('$fitly$', index)) {
      const end = input.indexOf('$fitly$', index + '$fitly$'.length);
      if (end === -1) throw new Error('Unterminated $fitly$ JSON value.');
      token += input.slice(index, end + '$fitly$'.length); index = end + '$fitly$'.length - 1; continue;
    }
    const character = input[index];
    if (character === "'") {
      token += character;
      if (quoted && input[index + 1] === "'") { token += input[++index]; } else quoted = !quoted;
      continue;
    }
    if (!quoted && character === '[') arrayDepth += 1;
    if (!quoted && character === ']') arrayDepth -= 1;
    if (!quoted && character === ',' && arrayDepth === 0) { values.push(token.trim()); token = ''; continue; }
    token += character;
  }
  if (quoted || arrayDepth !== 0) throw new Error('Malformed SQL value list.');
  values.push(token.trim());
  return values;
};

const parseValue = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed === 'NULL') return null;
  if (trimmed === 'TRUE') return true;
  if (trimmed === 'FALSE') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'")) throw new Error(`Unterminated string: ${trimmed.slice(0, 80)}`);
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  const array = /^ARRAY\[([\s\S]*)\]::text\[\]$/.exec(trimmed);
  if (array) return array[1].trim() ? splitValues(array[1]).map((entry) => parseValue(entry)) : [];
  const json = /^\$fitly\$([\s\S]*)\$fitly\$::jsonb$/.exec(trimmed);
  if (json) return JSON.parse(json[1]);
  throw new Error(`Unsupported SQL value: ${trimmed.slice(0, 80)}`);
};

const parseRows = (sql: string, table: 'recipes' | 'recipe_ingredients', columns: readonly string[]): SqlRow[] => {
  const expression = table === 'recipes'
    ? /INSERT INTO public\.recipes \([\s\S]*?\)\s*VALUES \(([\s\S]*?)\)\s*ON CONFLICT \(id\) DO UPDATE SET[\s\S]*?;/g
    : /INSERT INTO public\.recipe_ingredients \([\s\S]*?\) VALUES \(([\s\S]*?)\);/g;
  const rows: SqlRow[] = [];
  for (const match of sql.matchAll(expression)) {
    const values = splitValues(match[1]);
    if (values.length !== columns.length) throw new Error(`Expected ${columns.length} ${table} values, received ${values.length}.`);
    rows.push(Object.fromEntries(columns.map((column, index) => [column, parseValue(values[index])])))
  }
  return rows;
};

const main = async () => {
  const options = parseOptions(process.argv.slice(2));
  const sql = await readFile(path.resolve(process.cwd(), options.sqlFile), 'utf8');
  const recipes = parseRows(sql, 'recipes', recipeColumns);
  const ingredients = parseRows(sql, 'recipe_ingredients', ingredientColumns);
  if (recipes.length !== 200) throw new Error(`Expected exactly 200 recipes, found ${recipes.length}.`);
  const recipeIds = new Set<string>();
  const source = recipes.map((recipe) => {
    const id = String(recipe.id || '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || recipeIds.has(id)) throw new Error(`Invalid or duplicate recipe id: ${id}`);
    recipeIds.add(id);
    // The supplied SQL uses legacy aliases (fat_loss, maintenance); normalizeRecipe converts them to the canonical schema values.
    const normalized = normalizeRecipe(recipe);
    // The source provides Storage object paths but no image files. Do not save a broken browser URL;
    // images can be attached later through the admin catalog once they have been uploaded.
    const imageUrl = typeof recipe.image_url === 'string' && recipe.image_url.startsWith('recipe-images/') ? null : normalized.image_url;
    return { ...recipe, ...normalized, image_url: imageUrl, is_active: recipe.is_active !== false, ingredients: ingredients.filter((ingredient) => ingredient.recipe_id === id) };
  });
  if (ingredients.some((ingredient) => !recipeIds.has(String(ingredient.recipe_id)))) throw new Error('Found ingredient row for an unknown recipe.');
  const validation = validateRecipeCatalog(source, { expectedCount: 200 });
  if (!validation.valid) {
    validation.summary.errors.forEach((issue) => console.error(`error ${issue.path}: ${issue.message}`));
    throw new Error('Catalog validation failed; no rows were written.');
  }
  const existing = await supabase.from('recipes').select('id, recipe_ingredients(food_id, ingredient_name, amount, unit)').in('id', validation.items.map((item) => item.id));
  if (existing.error) throw existing.error;
  const plan = buildRecipeUpsertPlan(validation.items, existing.data as any[]);
  console.log(`Validated ${validation.items.length} recipes and ${ingredients.length} ingredient rows.`);
  console.log(`Dry run: ${!options.apply}; new recipes: ${plan.filter((item) => item.operation === 'insert').length}; updated recipes: ${plan.filter((item) => item.operation === 'update').length}; ingredient changes: ${plan.reduce((sum, item) => sum + item.ingredientChanges, 0)}.`);
  if (!options.apply) return;

  const importRecipe = async (recipe: typeof validation.items[number]) => {
    const { ingredients: recipeIngredients, ...recipeRow } = recipe;
    const writeRecipe = await supabase.from('recipes').upsert({ ...recipeRow, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (writeRecipe.error) throw writeRecipe.error;
    const deleteIngredients = await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipe.id);
    if (deleteIngredients.error) throw deleteIngredients.error;
    const writeIngredients = await supabase.from('recipe_ingredients').insert(recipeIngredients.map((ingredient, orderIndex) => ({
      food_id: ingredient.food_id || null,
      ingredient_name: ingredient.ingredient_name,
      amount: ingredient.amount ?? null,
      unit: ingredient.unit ?? null,
      preparation_note: ingredient.preparation_note ?? null,
      is_optional: ingredient.is_optional === true,
      recipe_id: recipe.id,
      order_index: orderIndex + 1,
    })));
    if (writeIngredients.error) throw writeIngredients.error;
  };
  const batchSize = 8;
  for (let start = 0; start < validation.items.length; start += batchSize) {
    await Promise.all(validation.items.slice(start, start + batchSize).map(importRecipe));
    console.log(`Imported ${Math.min(start + batchSize, validation.items.length)}/${validation.items.length} recipes.`);
  }
  const verifiedRecipes = await supabase.from('recipes').select('id', { count: 'exact', head: true }).in('id', validation.items.map((item) => item.id));
  if (verifiedRecipes.error || verifiedRecipes.count !== 200) throw new Error(`Verification failed: expected 200 recipes, found ${verifiedRecipes.count ?? 0}.`);
  const verifiedIngredients = await supabase.from('recipe_ingredients').select('id', { count: 'exact', head: true }).in('recipe_id', validation.items.map((item) => item.id));
  if (verifiedIngredients.error || verifiedIngredients.count !== ingredients.length) throw new Error(`Verification failed: expected ${ingredients.length} ingredients, found ${verifiedIngredients.count ?? 0}.`);
  console.log(`Import complete: ${verifiedRecipes.count} recipes and ${verifiedIngredients.count} ingredient rows verified.`);
};

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
