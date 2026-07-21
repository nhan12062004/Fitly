-- Phase 1 food-personalisation contract. Legacy free-text fields stay intact.
alter table public.lifestyle_settings
  add column if not exists dietary_restrictions text[] not null default '{}'::text[],
  add column if not exists diet_styles text[] not null default '{}'::text[];

alter table public.health_conditions
  add column if not exists allergies text[] not null default '{}'::text[];

-- Metadata is optional for old catalog rows, but gives the eligibility service
-- structured evidence instead of relying only on a displayed food name.
alter table public.foods
  add column if not exists dietary_tags text[] not null default '{}'::text[],
  add column if not exists ingredient_metadata text[] not null default '{}'::text[],
  add column if not exists animal_source text[] not null default '{}'::text[],
  add column if not exists is_active boolean not null default true;

with legacy as (
  select
    user_id,
    lower(concat_ws(' ', diet_preference, current_diet)) as source_text
  from public.lifestyle_settings
), mapped as (
  select
    user_id,
    array_remove(array[
      case when source_text like '%vegan%' or source_text like '%thuần chay%' then 'vegan' end,
      case when source_text like '%vegetarian%' or source_text like '%ăn chay%' then 'vegetarian' end
    ], null) as restrictions,
    array_remove(array[
      case when source_text like '%clean%' then 'clean' end,
      case when source_text like '%high protein%' or source_text like '%giàu protein%' or source_text like '%nhiều đạm%' then 'high_protein' end,
      case when source_text like '%low carb%' or source_text like '%keto%' then 'low_carb' end,
      case when source_text like '%normal%' or source_text like '%balanced%' or source_text like '%bình thường%' or source_text like '%cân bằng%' then 'balanced' end
    ], null) as styles
  from legacy
)
update public.lifestyle_settings settings
set
  dietary_restrictions = array(select distinct unnest(settings.dietary_restrictions || mapped.restrictions)),
  diet_styles = array(select distinct unnest(settings.diet_styles || mapped.styles))
from mapped
where settings.user_id = mapped.user_id;

-- Only values that can be identified safely are backfilled. The existing
-- medical_history text is deliberately retained as the source for ambiguous raw data.
update public.health_conditions health
set allergies = array(select distinct unnest(health.allergies || array_remove(array[
  case when lower(coalesce(health.medical_history, '')) ~ '(peanut|dau phong|lac)' then 'peanut' end,
  case when lower(coalesce(health.medical_history, '')) ~ '(tree nut|hat dieu|cashew|hanh nhan|almond|\mnuts?\M)' then 'tree_nuts' end,
  case when lower(coalesce(health.medical_history, '')) ~ '(milk|dairy|lactose|sua)' then 'milk' end,
  case when lower(coalesce(health.medical_history, '')) ~ '(egg|trung)' then 'egg' end,
  case when lower(coalesce(health.medical_history, '')) ~ '(soy|soya|dau nanh)' then 'soy' end,
  case when lower(coalesce(health.medical_history, '')) ~ '(wheat|gluten|lua mi)' then 'wheat' end,
  case when lower(coalesce(health.medical_history, '')) ~ '(fish|ca hoi|ca ngu|ca thu|salmon)' then 'fish' end,
  case when lower(coalesce(health.medical_history, '')) ~ '(shellfish|shrimp|tom|cua)' then 'shellfish' end,
  case when lower(coalesce(health.medical_history, '')) ~ '(sesame|\mme\M)' then 'sesame' end
], null)));
