# Recipe catalog design

`foods` remains the catalog of ingredients and single/basic foods, such as chicken breast, rice, egg, tofu, banana, and broccoli. Its UUID primary key is unchanged.

`recipes` is the catalog of complete dishes. A recipe has its own text ID, nutrition per serving, dietary metadata, cost/time metadata, structured instructions, and active state. It is not a replacement for `foods`.

`recipe_ingredients` defines recipe composition. Main ingredients should link to `foods.id` when available; seasonings or other free-form ingredients can leave `food_id` null while retaining `ingredient_name`.

## Instructions

Instructions are always stored as a JSON object with this shape:

```ts
type RecipeInstructions = {
  preparation: string[];
  steps: string[];
  tips: string[];
};
```

The shared normalizer accepts future legacy strings or arrays at the boundary and converts them to `steps`; catalog writes must persist the structured object.

## Canonical taxonomy and validation

The single source of truth is `shared/recipeCatalog.ts`, which re-exports the shared food taxonomy: dietary restrictions (`vegetarian`, `vegan`), styles (`balanced`, `clean`, `high_protein`, `low_carb`), budgets (`low`, `medium`, `high`), meal slots, cooking difficulty, and the canonical allergen taxonomy. UI labels are Vietnamese while database values remain canonical keys. Recipe goals reuse `GOAL_TYPES` and `normalizeGoalType` from `shared/exerciseCatalog.ts`.

`normalizeRecipe` and the field normalizers accept arrays, JSON arrays, comma/semicolon-separated text, safe Vietnamese/English aliases, and null values. They do not use fuzzy matching. `validateRecipe` permits incomplete drafts, but an active recipe requires all core nutrition/cooking fields, structured steps, and at least one ingredient.

Dietary semantic validation is metadata-first: `animal_source`, `ingredient_metadata`, dietary tags, and category can prove a vegetarian or vegan conflict. A required ingredient with no food metadata creates a warning rather than a guess from its name. Vegan additionally excludes metadata for egg, milk/dairy, and honey. Clear conflicts are validation errors.

`deriveRecipeAllergens` unions manual recipe allergens with allergens from linked foods. Nutrition and cost aggregation are advisory helpers: they return no aggregate when a quantity/unit conversion or source nutrition/cost is incomplete, and never overwrite manually entered recipe values.

## Weekly-plan compatibility

`weekly_food_items.food_id` remains intact for all legacy plans and food-based items. `recipe_id` is nullable and adds recipe references without altering food history, daily meal logs, AI proposal JSON, or current meal-generation flows. The row check permits a rest-day marker with neither reference, otherwise requires `food_id` or `recipe_id`; it deliberately does not require XOR so a future item may retain both a recipe and an ingredient reference.

## Publishing and security

Draft recipes may omit nutrition while `is_active = false`. Application code must run `validateRecipeForActivation` before publishing an active recipe. Authenticated users can read only active recipes and their ingredients; catalog writes are restricted to admins (and service-role server access).

## Official catalog import contract

The future official input is a JSON array of `RecipeCatalogItem` from `shared/recipeCatalogImport.ts`. Each item contains the canonical recipe fields plus an `ingredients` array. The source-of-truth template is [Backend/catalog/recipe-catalog.template.json](../Backend/catalog/recipe-catalog.template.json); it intentionally contains only `[]` and is a valid no-op catalog, not a seed.

Catalog IDs are stable lowercase kebab-case identifiers. Active catalog records need at least one meal type, a non-negative nutrition/cost profile, at least one ingredient, and at least two instruction steps. Food links are optional for a free-form ingredient, but use `food_id` when a known ingredient exists. `--check-food-ids` asks the validator to load those food IDs from the database and enables metadata-based vegetarian/vegan checks.

```bash
cd Backend
npm run recipes:validate -- --file path/to/recipes.json
npm run recipes:validate -- --file path/to/recipes.json --expected-count 200 --check-food-ids
npm run recipes:upsert -- --file path/to/recipes.json --dry-run --check-food-ids
npm run recipes:upsert -- --file path/to/recipes.json --check-food-ids
npm run recipes:verify
```

Validation reports distributions for meal type, restrictions, styles, budget and cooking difficulty; average ingredient count; unlinked ingredients; warnings; and errors. It exits `0` only when valid and `1` for invalid input.

`recipes:upsert` validates before any write. `--dry-run` never writes and reports inserts, updates, and ingredient changes. Real upserts use the stable `recipes.id`; ingredients are replaced only for the specific recipe being imported. The script never truncates `recipes`, never deletes another recipe, and does not touch legacy `weekly_food_items.food_id` rows. Supabase client writes are per recipe rather than a cross-table SQL transaction, so use staging and the verify command before production.

Recommended workflow: create catalog → validate → dry-run → import staging → verify → manual QA (Diet Plan/detail/Admin) → production import. Roll back by importing the previously versioned catalog, or deactivate a specific recipe through Admin; never use a destructive catalog-wide delete.
