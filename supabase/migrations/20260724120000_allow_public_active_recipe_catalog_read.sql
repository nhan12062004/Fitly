-- The meal picker is available before a user has saved a weekly plan. Active
-- catalog recipes are safe read-only reference data; writes remain admin-only.
drop policy if exists recipes_active_read on public.recipes;
create policy recipes_active_read on public.recipes
  for select to anon, authenticated
  using (is_active = true);

drop policy if exists recipe_ingredients_active_read on public.recipe_ingredients;
create policy recipe_ingredients_active_read on public.recipe_ingredients
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.recipes
      where recipes.id = recipe_ingredients.recipe_id
        and recipes.is_active = true
    )
  );
