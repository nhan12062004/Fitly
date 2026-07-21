import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { supabase } from '../config/Supabase';

type SqlIngredient = { recipeId: string; name: string; amount: number | null; unit: string | null; preparationNote: string | null; isOptional: boolean; orderIndex: number };

const usage = 'Usage: npm run foods:import-ingredients -- --sql path/to/catalog.sql';

const splitValues = (input: string): string[] => {
  const values: string[] = []; let token = ''; let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === "'") {
      token += character;
      if (quoted && input[index + 1] === "'") token += input[++index]; else quoted = !quoted;
    } else if (!quoted && character === ',') {
      values.push(token.trim()); token = '';
    } else token += character;
  }
  if (quoted) throw new Error('Malformed SQL string value.');
  values.push(token.trim());
  return values;
};

const sqlText = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed === 'NULL') return null;
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) throw new Error(`Expected SQL text value, received ${trimmed.slice(0, 50)}`);
  return trimmed.slice(1, -1).replace(/''/g, "'");
};

const parseRecipeNames = (sql: string) => {
  const names = new Map<string, string>();
  const pattern = /INSERT INTO public\.recipes\s*\([\s\S]*?\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON CONFLICT \(id\) DO UPDATE SET/g;
  for (const match of sql.matchAll(pattern)) {
    const values = splitValues(match[1]);
    const id = sqlText(values[0]); const name = sqlText(values[1]);
    if (!id || !name) throw new Error('Recipe row is missing id or name.');
    names.set(id, name);
  }
  return names;
};

const parseIngredients = (sql: string): SqlIngredient[] => {
  const rows: SqlIngredient[] = [];
  const pattern = /INSERT INTO public\.recipe_ingredients\s*\([^)]*\)\s*VALUES\s*\(([\s\S]*?)\);/g;
  for (const match of sql.matchAll(pattern)) {
    const values = splitValues(match[1]);
    if (values.length !== 8) throw new Error(`Expected 8 ingredient values, received ${values.length}.`);
    const recipeId = sqlText(values[0]); const name = sqlText(values[2]);
    if (!recipeId || !name) throw new Error('Ingredient row is missing recipe id or name.');
    rows.push({
      recipeId,
      name,
      amount: values[3].trim() === 'NULL' ? null : Number(values[3]),
      unit: sqlText(values[4]),
      preparationNote: sqlText(values[5]),
      isOptional: values[6].trim() === 'TRUE',
      orderIndex: Number(values[7]),
    });
  }
  return rows;
};

const main = async () => {
  const sqlFlag = process.argv.indexOf('--sql');
  if (sqlFlag === -1 || !process.argv[sqlFlag + 1]) throw new Error(usage);
  const sql = await readFile(path.resolve(process.cwd(), process.argv[sqlFlag + 1]), 'utf8');
  const recipeNames = parseRecipeNames(sql);
  const ingredients = parseIngredients(sql);
  if (recipeNames.size !== 200 || ingredients.length !== 1162) throw new Error(`Expected 200 recipes and 1162 ingredients, found ${recipeNames.size} and ${ingredients.length}.`);

  const { data: foods, error: foodsError } = await supabase.from('foods').select('id, name').eq('category', 'Món ăn').in('name', [...recipeNames.values()]);
  if (foodsError) throw foodsError;
  const foodIdByName = new Map((foods || []).map((food) => [String(food.name), String(food.id)]));
  if (foodIdByName.size !== recipeNames.size) throw new Error(`Expected ${recipeNames.size} matching foods, found ${foodIdByName.size}.`);

  const foodIdByRecipeId = new Map([...recipeNames].map(([recipeId, name]) => [recipeId, foodIdByName.get(name)!]));
  const foodIds = [...foodIdByRecipeId.values()];
  const removed = await supabase.from('food_ingredients').delete().in('food_id', foodIds);
  if (removed.error) throw removed.error;
  const rows = ingredients.map((ingredient) => ({
    food_id: foodIdByRecipeId.get(ingredient.recipeId), ingredient_name: ingredient.name, amount: ingredient.amount,
    unit: ingredient.unit, preparation_note: ingredient.preparationNote, is_optional: ingredient.isOptional, order_index: ingredient.orderIndex,
  }));
  for (let start = 0; start < rows.length; start += 200) {
    const inserted = await supabase.from('food_ingredients').insert(rows.slice(start, start + 200));
    if (inserted.error) throw inserted.error;
  }
  const verified = await supabase.from('food_ingredients').select('id', { count: 'exact', head: true }).in('food_id', foodIds);
  if (verified.error || verified.count !== ingredients.length || foodIdByRecipeId.size !== 200) {
    throw new Error(`Verification failed: expected 1162 ingredients across 200 foods, found ${verified.count || 0}.`);
  }
  console.log(`Imported ${verified.count} food ingredients for 200 foods.`);
};

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
