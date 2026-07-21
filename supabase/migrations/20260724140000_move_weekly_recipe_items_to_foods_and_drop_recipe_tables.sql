-- Complete the catalog move to public.foods before retiring the recipe schema.
do $move$
declare
  unresolved_count integer;
begin
  update public.weekly_food_items item
  set food_id = food.id
  from public.recipes recipe
  join public.foods food
    on food.name = recipe.name
   and food.category = 'Món ăn'
  where item.recipe_id = recipe.id
    and item.food_id is null;

  select count(*) into unresolved_count
  from public.weekly_food_items
  where recipe_id is not null and food_id is null;

  if unresolved_count <> 0 then
    raise exception 'Could not move % weekly recipe item(s) to foods', unresolved_count;
  end if;
end
$move$;

alter table public.weekly_food_items
  drop constraint if exists weekly_food_items_food_or_recipe_check;
alter table public.weekly_food_items
  drop column if exists recipe_id;
alter table public.weekly_food_items
  add constraint weekly_food_items_food_required_check
  check (is_rest_day = true or food_id is not null) not valid;

drop table if exists public.recipe_ingredients;
drop table if exists public.recipes;
