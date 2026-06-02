# AI Coach Apply Flow Checklist

Use this checklist to manually verify `POST /api/ai/chat`, `POST /api/ai/apply-adjustment`, and `POST /api/ai/reject-adjustment`.

## Preconditions

- User has at least two weekly workout plans for different `week_start_date` values.
- User has at least one weekly food plan with multiple `weekly_food_items`.
- AI Coach chat can create both workout and meal adjustments.
- Requests are sent with a valid user JWT.

## 1. Apply Workout To Correct Week

- Open AI Coach on week A and select a day that already has exercises.
- Trigger a workout adjustment such as "Dieu chinh Thu 4 nhe hon".
- Confirm the created `ai_plan_adjustments.old_data.weekly_plan_id` matches the workout plan currently shown in AI Coach.
- Call `POST /api/ai/apply-adjustment` with the returned `adjustmentId`.
- Verify only `weekly_plan_exercises` rows for that exact `weekly_plan_id` and `day_of_week` were replaced.
- Verify another week's plan remains unchanged.

## 2. Apply Meal To Correct Item

- Open AI Coach on a week/day that already has meal items.
- Trigger a meal adjustment such as "Doi thuc don Thu 5 gon hon".
- Confirm `ai_plan_adjustments.old_data.weekly_food_plan_id` matches the meal plan currently shown in AI Coach.
- Confirm `new_data.old_weekly_food_item_id` points to the specific meal item being replaced.
- Call `POST /api/ai/apply-adjustment`.
- Verify only that `weekly_food_items.id` row changed.
- Verify `food_id`, `calories`, `protein`, `carbs`, and `fat` now match the selected row in `foods`.

## 3. Reapply Already Applied Adjustment

- Apply a valid workout or meal adjustment once.
- Call `POST /api/ai/apply-adjustment` again with the same `adjustmentId` and any `Idempotency-Key`.
- Expect HTTP 200 with:
  - `success: true`
  - `alreadyApplied: true`
- Verify no duplicate inserts or second mutation happened.

## 4. Rejected Adjustment Cannot Be Applied

- Create a new adjustment.
- Call `POST /api/ai/reject-adjustment`.
- Verify `status = rejected` and `rejected_at` is set.
- Call `POST /api/ai/apply-adjustment` for the same `adjustmentId`.
- Expect HTTP 409.
- Verify workout plan / meal item data remains unchanged.

## 5. Invalid IDs Are Blocked

- For a workout adjustment, tamper `new_data.exercises[*].exercise_id` to a non-existent id.
- Call `POST /api/ai/apply-adjustment`.
- Expect HTTP 400 and no delete/insert in `weekly_plan_exercises`.
- For a meal adjustment, tamper `new_data.new_food_id` to a non-existent id.
- Call `POST /api/ai/apply-adjustment`.
- Expect HTTP 400 and no update in `weekly_food_items`.
