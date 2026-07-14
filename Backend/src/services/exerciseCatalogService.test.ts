import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ExerciseEligibilityContext,
  normalizeExercise,
  normalizeExerciseInstructions,
  normalizeEquipment,
  normalizeMovementPattern,
  normalizeTrainingLocation,
  parseAvailableEquipment,
  experienceLevelToMonths,
  validateExerciseCatalog,
} from '../../../shared/exerciseCatalog';
import {
  buildExerciseEligibilityContext,
  getEligibleExercises,
  getExerciseEligibilityDecision,
  validateExerciseIds,
  validateExerciseProposal,
} from './exerciseCatalogService';

const baseExercise = (overrides: Record<string, unknown> = {}) => ({
  id: 'bodyweight-squat',
  name: 'Bodyweight Squat',
  body_part: 'quadriceps',
  target_muscle: 'quadriceps',
  secondary_muscles: ['glutes'],
  equipment: 'none',
  training_locations: ['home', 'gym'],
  difficulty: 'absolute_beginner',
  min_experience_months: 0,
  progression_level: 1,
  movement_pattern: 'squat',
  goal_type: ['general_fitness'],
  contraindications: [],
  estimated_duration_seconds: 60,
  calories_per_minute: null,
  image_url: null,
  gif_url: null,
  instructions: {
    setup: ['Stand tall.'],
    steps: ['Brace your core.', 'Sit down and stand up.'],
    breathing: ['Exhale while standing.'],
    coaching_cues: ['Keep knees tracking toes.'],
    common_mistakes: ['Knees collapse inward.', 'Heels lift.'],
  },
  ...overrides,
});

const context = (overrides: Partial<ExerciseEligibilityContext> = {}): ExerciseEligibilityContext => ({
  workoutLocation: 'home',
  availableEquipment: new Set(['none']),
  experienceMonths: 0,
  fitnessGoal: 'general_fitness',
  healthConditions: [],
  injuries: [],
  ...overrides,
});

test('normalizes location aliases, equipment aliases, parser and experience values', () => {
  assert.equal(normalizeTrainingLocation('Tập tại nhà'), 'home');
  assert.equal(normalizeTrainingLocation('fitness_center'), 'gym');
  assert.equal(normalizeEquipment('Dumbbells'), 'dumbbell');
  assert.equal(normalizeMovementPattern('Leg Extension'), 'knee_extension');
  assert.equal(normalizeMovementPattern('hamstring curl'), 'knee_flexion');
  assert.equal(normalizeMovementPattern('Clamshell'), 'hip_abduction');
  assert.deepEqual(Array.from(parseAvailableEquipment('dumbbells; Dây kháng lực')), ['none', 'dumbbell', 'resistance_band']);
  assert.deepEqual(Array.from(parseAvailableEquipment('Tạ đơn & Thảm')), ['none', 'dumbbell']);
  assert.deepEqual(Array.from(parseAvailableEquipment('["band", "BODYWEIGHT"]')), ['none', 'resistance_band']);
  assert.equal(experienceLevelToMonths('Người mới'), 0);
  assert.equal(experienceLevelToMonths('Đã tập dưới 6 tháng'), 4);
  assert.equal(experienceLevelToMonths('Trung cấp'), 8);
});

test('normalizes all legacy instruction forms without mutation', () => {
  const source = { steps: ['One', 'Two'], technique_notes: ['Keep control'] };
  assert.deepEqual(normalizeExerciseInstructions('One step').steps, ['One step']);
  assert.deepEqual(normalizeExerciseInstructions(['One', 'Two']).steps, ['One', 'Two']);
  assert.deepEqual(normalizeExerciseInstructions(null), {
    setup: [], steps: [], breathing: [], coaching_cues: [], common_mistakes: [],
  });
  const normalized = normalizeExerciseInstructions(source);
  assert.deepEqual(normalized.steps, ['One', 'Two']);
  assert.deepEqual(normalized.coaching_cues, ['Keep control']);
  assert.deepEqual(source, { steps: ['One', 'Two'], technique_notes: ['Keep control'] });
});

test('normalizes malformed legacy arrays and missing catalog metadata safely', () => {
  const normalized = normalizeExercise({
    id: 'legacy-item',
    name: 'Legacy item',
    secondary_muscles: { invalid: true },
    training_locations: { invalid: true },
    difficulty: 'unknown',
    instructions: null,
  });
  assert.deepEqual(normalized.secondary_muscles, []);
  assert.deepEqual(normalized.training_locations, ['home', 'gym']);
  assert.equal(normalized.min_experience_months, 12);
  assert.deepEqual(normalized.instructions.steps, []);
});

test('eligibility enforces home/bodyweight/zero-month requirements', () => {
  const exercises = [
    baseExercise(),
    baseExercise({ id: 'gym-machine', equipment: 'machine', training_locations: ['gym'] }),
    baseExercise({ id: 'requires-experience', min_experience_months: 3 }),
  ];
  assert.deepEqual(getEligibleExercises(exercises, context()).map((exercise) => exercise.id), ['bodyweight-squat']);
});

test('eligibility allows none and resistance band but excludes unavailable equipment and excess experience', () => {
  const exercises = [
    baseExercise(),
    baseExercise({ id: 'band-row', equipment: 'resistance_band', min_experience_months: 4 }),
    baseExercise({ id: 'dumbbell-row', equipment: 'dumbbell', min_experience_months: 0 }),
    baseExercise({ id: 'too-advanced', min_experience_months: 5 }),
  ];
  const eligible = getEligibleExercises(exercises, context({
    availableEquipment: new Set(['none', 'resistance_band']),
    experienceMonths: 4,
  }));
  assert.deepEqual(eligible.map((exercise) => exercise.id), ['bodyweight-squat', 'band-row']);
});

test('eligibility supports gym dumbbell/machine and excludes mismatches', () => {
  const exercises = [
    baseExercise(),
    baseExercise({ id: 'gym-dumbbell', equipment: 'dumbbell', training_locations: ['gym'], min_experience_months: 5 }),
    baseExercise({ id: 'gym-machine', equipment: 'machine', training_locations: ['gym'], min_experience_months: 5 }),
    baseExercise({ id: 'band-only', equipment: 'resistance_band', training_locations: ['gym'] }),
    baseExercise({ id: 'requires-six-months', min_experience_months: 6 }),
  ];
  const eligible = getEligibleExercises(exercises, context({
    workoutLocation: 'gym',
    availableEquipment: new Set(['none', 'dumbbell', 'machine']),
    experienceMonths: 5,
  }));
  assert.deepEqual(eligible.map((exercise) => exercise.id), ['bodyweight-squat', 'gym-dumbbell', 'gym-machine']);
});

test('eligibility excludes a location mismatch, contraindication conflict, and unknown difficulty', () => {
  assert.equal(getExerciseEligibilityDecision(baseExercise({ training_locations: ['gym'] }), context()).eligible, false);
  assert.equal(getExerciseEligibilityDecision(baseExercise({ contraindications: ['knee'] }), context({ injuries: ['knee pain'] })).eligible, false);
  assert.equal(getExerciseEligibilityDecision(baseExercise({ difficulty: 'mystery', min_experience_months: undefined }), context()).eligible, false);
});

test('eligibility retains full health context for the existing safety guard', () => {
  const eligibilityContext = buildExerciseEligibilityContext({
    lifestyle: { workout_location: 'gym', equipment_available: 'barbell', experience_level: 'experienced' },
    health: { medications: 'blood pressure medication' },
  });
  const decision = getExerciseEligibilityDecision(
    baseExercise({
      id: 'barbell-squat',
      name: 'Barbell Squat',
      equipment: 'barbell',
      training_locations: ['gym'],
      min_experience_months: 0,
    }),
    eligibilityContext,
  );
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.some((reason) => reason.startsWith('safety:')));
});

test('invalid AI exercise ids and mixed proposals are rejected as a whole', () => {
  const catalog = [baseExercise()];
  const ids = validateExerciseIds(['bodyweight-squat', 'invented-exercise'], catalog, context());
  assert.equal(ids.valid, false);
  assert.deepEqual(ids.invalidIds, ['invented-exercise']);

  const proposal = {
    day_of_week: 0,
    duration_minutes: 20,
    exercises: [
      { exercise_id: 'bodyweight-squat', sets: 3, reps: '10-12', rest_seconds: 60, weight_kg: 0, target_rpe: 6 },
      { exercise_id: 'invented-exercise', sets: 3, reps: '10-12', rest_seconds: 60, weight_kg: 0, target_rpe: 6 },
    ],
  };
  const validation = validateExerciseProposal(proposal, context(), catalog);
  assert.equal(validation.valid, false);
  assert.equal(validation.exerciseIds.length, 2);
});

test('weekly AI proposals require seven distinct days before any plan write', () => {
  const days = Array.from({ length: 6 }, (_, day) => ({
    day_of_week: day,
    duration_minutes: 0,
    exercises: [],
  }));
  const validation = validateExerciseProposal(
    { workout_plan: { plan_name: 'Rest week', goal: 'recovery', explanation: '', days } },
    context(),
    [],
    { allowEmpty: true, requireSevenDays: true },
  );
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('exactly seven days')));
});

test('catalog validator accepts a complete canonical item and rejects unexpected fields', () => {
  const valid = validateExerciseCatalog([baseExercise()]);
  assert.equal(valid.valid, true);
  const invalid = validateExerciseCatalog([{ ...baseExercise(), misspelled_field: true }]);
  assert.equal(invalid.valid, false);
  assert.match(invalid.issues[0].path, /misspelled_field/);
  const numericId = validateExerciseCatalog([{ ...baseExercise(), id: 123 }]);
  assert.equal(numericId.valid, false);
  assert.ok(numericId.issues.some((issue) => issue.path.endsWith('.id')));
});
