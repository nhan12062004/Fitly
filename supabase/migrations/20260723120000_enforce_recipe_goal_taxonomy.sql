-- Phase 3: recipes reuse Fitly's existing canonical fitness-goal taxonomy.
alter table public.recipes
  drop constraint if exists recipes_goal_type_check;

alter table public.recipes
  add constraint recipes_goal_type_check
  check (goal_type <@ array[
    'general_fitness', 'weight_loss', 'muscle_gain', 'strength', 'endurance', 'mobility', 'recovery'
  ]::text[]) not valid;
