# Exercise Catalog Design

## Purpose and scope

The Exercise Catalog is the controlled source for exercise metadata used by the exercise browser, admin workflow, weekly-plan generation, and AI Coach proposals. It is designed for a catalog of beginner and early-intermediate movements; it does not seed a fictional catalog or replace any existing exercise rows.

Existing exercise IDs are stable public references. They are used by weekly plans, daily workout data, and AI proposals, so an import must update an existing row in place rather than delete it and create a replacement ID.

`docs/database_schema.md` is an auto-generated Supabase schema snapshot. Do not hand-edit it after a migration. Refresh it only with the repository's schema-export process when database access is available.

## Database schema

`public.exercises` keeps its existing fields and adds these catalog fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `training_locations` | `text[]` | Locations where the movement can be performed. It is non-empty and only contains `home` and/or `gym`. Existing rows default to both. |
| `min_experience_months` | `smallint` | Minimum experience required for eligibility. It is between 0 and 120. |
| `progression_level` | `smallint` | Relative level within a progression chain, from 1 through 5. It defaults to 1 for legacy rows. |

The catalog continues to use `text` and `text[]` rather than PostgreSQL enums so the taxonomy can evolve without an enum migration. The metadata migration adds b-tree indexes for the common scalar filters and GIN indexes for `training_locations`, `goal_type`, and `contraindications`.

### Legacy backfill

Existing rows retain their IDs and receive `['home', 'gym']` for `training_locations` and level `1` for `progression_level`. The migration maps known legacy difficulty aliases to `min_experience_months`:

| Legacy difficulty | Months |
| --- | ---: |
| `absolute_beginner`, `easy`, `beginner` | 0 |
| `beginner_plus`, `novice` | 3 |
| `intermediate`, `medium` | 6 |
| `advanced`, `hard` | 12 |
| Missing or unrecognized | 12 |

Vietnamese spellings already handled by the application (`dễ`, `trung bình`, `khó`) are included in the migration aliases. An unknown difficulty is intentionally conservative and must not become beginner-safe merely because it could not be recognized.

## Canonical taxonomy and aliases

All catalog values should be normalized before validation, filtering, display, or import. The shared constants, types, aliases, and validator live in `shared/exerciseCatalog.ts`; frontend and backend code must consume that source rather than create screen-specific magic strings. Store canonical values; accept legacy aliases only at the boundary.

### Training location

Canonical values: `home`, `gym`.

| Aliases | Canonical value |
| --- | --- |
| `home`, `at_home`, `house`, `tại nhà` | `home` |
| `gym`, `fitness_center`, `phòng gym` | `gym` |

### Difficulty

New catalog rows use `absolute_beginner`, `beginner`, or `beginner_plus`. Existing values such as `easy`, `medium`, `hard`, `novice`, `intermediate`, and `advanced` remain readable for backward compatibility. Difficulty is display metadata; eligibility must use `min_experience_months`.

### Body part and muscles

Use these body-part values for new catalog rows: `chest`, `back`, `shoulders`, `biceps`, `triceps`, `quadriceps`, `hamstrings`, `glutes`, `calves`, `core`, `full_body`, and `mobility`.

`body_part` is the broad group, `target_muscle` is the primary muscle, and `secondary_muscles` is the deduplicated list of assisting muscles. A secondary muscle must not duplicate the target muscle.

### Equipment

Canonical values: `none`, `chair`, `bench`, `resistance_band`, `dumbbell`, `kettlebell`, `barbell`, `cable`, `machine`, `pull_up_bar`, `stability_ball`, and `foam_roller`.

| Aliases | Canonical value |
| --- | --- |
| `bodyweight`, `no_equipment`, `không dụng cụ` | `none` |
| `band`, `bands` | `resistance_band` |
| `dumbbells` | `dumbbell` |
| `barbells` | `barbell` |
| `machines` | `machine` |
| `pullup_bar` | `pull_up_bar` |

`equipment` stays a single `text` value. Each row represents one concrete equipment variation, such as separate bodyweight, dumbbell, and barbell Romanian deadlift rows.

### Movement pattern

Canonical values: `squat`, `hinge`, `lunge`, `knee_extension`, `knee_flexion`, `hip_abduction`, `horizontal_push`, `horizontal_pull`, `vertical_push`, `vertical_pull`, `elbow_flexion`, `elbow_extension`, `calf_raise`, `core_flexion`, `anti_extension`, `anti_rotation`, `rotation`, `carry`, `locomotion`, and `mobility`.

Use the isolated lower-body patterns where appropriate: Leg Extension is `knee_extension`, Leg Curl is `knee_flexion`, and Clamshell is `hip_abduction`. These are deliberately not aliases of `squat`, `hinge`, or `lunge`; the catalog normalizer also accepts common English and Vietnamese legacy labels for each.

### Goal type

Canonical values: `general_fitness`, `weight_loss`, `muscle_gain`, `strength`, `endurance`, `mobility`, and `recovery`. Legacy goal labels are normalized at the application boundary before filtering or ranking.

## Exercise data contract

Each catalog item is a JSON object with these fields:

```text
id, name, body_part, target_muscle, secondary_muscles, equipment,
training_locations, difficulty, min_experience_months, progression_level,
movement_pattern, goal_type, contraindications, estimated_duration_seconds,
calories_per_minute, image_url, gif_url, instructions
```

`id` is lowercase kebab-case and is never generated by an importer. Array fields contain trimmed, unique strings. Nullable media and calorie fields may be `null`; URLs must be valid whenever supplied.

The tracked empty input file is [exercise-catalog.template.json](../Backend/catalog/exercise-catalog.template.json). It contains an empty JSON array so it cannot be mistaken for a partial catalog or seed production data.

### Instructions contract

`instructions` is a structured JSON object:

```json
{
  "setup": [],
  "steps": [],
  "breathing": [],
  "coaching_cues": [],
  "common_mistakes": [],
  "easier_variation_id": "optional-existing-id",
  "harder_variation_id": "optional-existing-id"
}
```

Compatibility normalization must continue to accept legacy `instructions` values that are an object, string array, string, `null`, or an object missing some fields. A string or string array becomes `steps`; invalid fields become empty arrays; the source database value is never mutated by normalization.

Variation IDs are optional, must exist in the catalog, must not point to the same exercise, and must not create a simple progression cycle. The frontend renders a variation link only after confirming the referenced ID exists.

## Eligibility and AI safety flow

The catalog service owns normalization, hard eligibility checks, and deterministic ranking. It must run the hard checks before any score or AI prompt is produced:

1. Normalize catalog metadata and construct the user's eligibility context.
2. Confirm that each candidate ID exists.
3. Enforce `training_locations` when the user selected a location.
4. Require `none` equipment or equipment in the user's normalized available-equipment set.
5. Require `experienceMonths >= min_experience_months`.
6. Exclude contraindication conflicts, explicit exclusions, and exercises blocked by the existing personalization/safety guard.
7. Rank only the survivors, using stable ID ordering to break equal scores.

If the user has no selected workout location, the service must not invent `home` or `gym`; it still applies the equipment, experience, contraindication, and safety checks. `none` is always added to the available-equipment set because bodyweight movements require no equipment.

Only the hard-filtered, compact catalog is sent to an AI model. Model output is untrusted: validate its schema, require every ID to exist and remain eligible, validate loads/sets/reps/rest/RPE, and reject the whole proposal if one exercise is invalid. Do not partially insert a rejected plan.

At apply time, reload the stored proposal and the user's current profile, lifestyle, and health context; rebuild eligibility; revalidate every exercise; then perform the mutation only if the entire proposal remains valid. This complements—not replaces—the safety rules in `personalizationGuardService.ts`.

Workout proposal application calls the migration-provided `public.apply_workout_adjustment_atomically` function only after TypeScript validation succeeds. It is executable only by the backend service role, locks the proposal and the user's calendar day, binds that date to the Monday-based plan week/day, replaces the selected weekly-plan day and its unstarted daily-session snapshot, writes the workout-session snapshot, and marks the proposal applied in one database transaction. A repeated applied proposal returns an idempotent result only for the same idempotency key. Materializing an active weekly-plan day uses the paired service-only `public.materialize_daily_workout_from_plan_atomically` function, which shares that per-user/day lock, requires the supplied rows to belong to that exact plan day, and refuses to overwrite an already materialized day.

Weekly AI generation creates parent plans as `draft`, inserts all required workout/meal rows, then activates the new plans before marking former active plans adjusted. All plan consumers query `plan_status = 'active'`, so a failed generation leaves an invisible retry-safe draft instead of a partial active plan.

## Import and validation workflow

Run catalog commands from `Backend/` after the package scripts are installed:

```bash
npm run exercises:validate -- --file catalog/exercise-catalog.template.json
npm run exercises:validate -- --file path/to/exercises.json --expected-count 100
npm run exercises:upsert -- --file path/to/exercises.json
```

`exercises:upsert` rejects a valid empty catalog by default, so a mistaken template or incomplete export cannot silently look like a successful import. An empty catalog is permitted only as an intentional no-op with `--allow-empty`:

```bash
npm run exercises:upsert -- --file catalog/exercise-catalog.template.json --allow-empty
```

The validator rejects invalid JSON, duplicate IDs or normalized names, non-kebab-case IDs, missing required fields, invalid taxonomy values, invalid locations, invalid experience/progression values, malformed URLs, unknown fields, invalid variation references or cycles, and incomplete instructions. This catalog phase rejects any item whose `min_experience_months` exceeds 6 even though the database column permits future expansion through 120. It reports the exercise ID or item path and exits non-zero without importing data. It also reports counts by body part, target muscle, equipment, location, difficulty, experience months, and movement pattern.

The importer validates first and upserts by the existing primary key:

```sql
insert into public.exercises (...) values (...)
on conflict (id) do update set
  ...,
  updated_at = timezone('utc', now());
```

It must never truncate or delete the table, generate replacement IDs, or break references from workout history and plans. Use a validated catalog input only; do not import a partial or malformed file.

## Adding an exercise or progression

1. Start from the empty template and add a complete canonical item.
2. Select a stable lowercase kebab-case ID before any plan references it.
3. Choose one primary equipment value and at least one valid training location.
4. Set conservative experience months and a level from 1 to 5.
5. Add complete structured instructions, contraindications, and valid variation IDs where known.
6. Validate the complete file, review its taxonomy summary, then upsert it.
7. Confirm the new item is visible in the admin and exercise flows and remains eligible only for an appropriate profile.

For a progression, create distinct exercises for distinct equipment or movement variants. Link only verified easier/harder variation IDs, move from lower to higher `progression_level`, and avoid cycles. Never rename an existing ID as part of a progression change.

## Migration and rollback

Apply migrations through the repository's Supabase workflow from `Backend/`:

```bash
npm run db:migration:list
npm run db:push
```

For this release, use a confirmed staging checkout and run the following from
the repository root. Do not use the `--include-all` wrapper until migration
history has been reviewed. First run a linked migration list and dry run,
confirm that the target is staging and that only
`20260714120000_add_exercise_catalog_metadata.sql` will be applied, then push
it:

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase db query --linked --file supabase/verify_rpc_execute_privileges.sql
```

The verification query must return exactly two `PASS` rows: `anon`,
`authenticated`, and `PUBLIC` cannot execute either RPC; `service_role` can.
Database owners and superusers remain privileged by PostgreSQL design. The
query is intentionally stored in
`supabase/verify_rpc_execute_privileges.sql` and is read-only.

Before rolling back the catalog metadata migration, stop application code that reads or writes the new fields and back up any metadata added after migration. A rollback should first drop `public.apply_workout_adjustment_atomically` and `public.materialize_daily_workout_from_plan_atomically`, then drop the added indexes and named checks before dropping the three added columns. Dropping those columns discards only their metadata; it must never delete exercise rows or change IDs. After rollback, verify plan/history references are intact and refresh the generated schema snapshot only through its export process.
