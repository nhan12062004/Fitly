export type PersonalizationContext = {
  profile?: Record<string, unknown> | null;
  lifestyle?: Record<string, unknown> | null;
  health?: Record<string, unknown> | null;
};

export type SafetyProfile = {
  rawText: string;
  cardiacRisk: boolean;
  acuteWarningSigns: boolean;
  postpartumOrPregnancy: boolean;
  lowerBodyLimited: boolean;
  upperBodyLimited: boolean;
  spineOrCoreLimited: boolean;
  fractureOrSurgery: boolean;
  lowBudget: boolean;
  vegetarian: boolean;
  rpeCap: number;
  maxSets: number;
  minRestSeconds: number;
  maxTrainingDays: number | null;
  zeroExternalLoad: boolean;
  notes: string[];
};

export type ExerciseSafetyDecision = {
  allowed: boolean;
  reasons: string[];
};

export type FoodSafetyDecision = {
  allowed: boolean;
  reasons: string[];
};

type ExerciseLike = {
  exercise_id?: string | null;
  id?: string | null;
  name?: string | null;
  body_part?: string | null;
  target_muscle?: string | null;
  equipment?: string | null;
  difficulty?: string | null;
  movement_pattern?: string | null;
  contraindications?: unknown;
  sets?: number | null;
  reps?: string | null;
  weight_kg?: number | null;
  rest_seconds?: number | null;
  target_rpe?: number | null;
  load_instruction?: string | null;
  note?: string | null;
};

type FoodLike = {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  allergens?: unknown;
  price_level?: string | null;
  goal_type?: unknown;
};

type WorkoutPlanLike = {
  explanation?: string;
  days: Array<{
    day_of_week: number;
    is_rest_day: boolean;
    duration_minutes: number;
    exercises: ExerciseLike[];
  }>;
};

const normalizeText = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/[^a-z0-9\s/|,.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const asTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return normalizeText(value)
    .split(/[|,/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const hasAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

const CARDIAC_TERMS = [
  'benh tim',
  'tim mach',
  'suy tim',
  'dau nguc',
  'nhoi mau',
  'heart',
  'cardiac',
  'angina',
  'arrhythmia',
  'loan nhip',
  'huyet ap',
  'cao huyet ap',
  'blood pressure',
  'stent',
  'pacemaker',
  'dot quy',
  'stroke',
];

const ACUTE_WARNING_TERMS = [
  'dau nguc',
  'kho tho',
  'shortness of breath',
  'choang',
  'chong mat',
  'ngat',
  'xiu',
  'faint',
  'dizzy',
  'tim dap nhanh',
  'fast heartbeat',
  'uneven heartbeat',
];

const POSTPARTUM_TERMS = [
  'sau sinh',
  'vua sinh',
  'postpartum',
  'sinh mo',
  'sinh thuong',
  'cesarean',
  'c section',
  'cho con bu',
  'breastfeeding',
  'mang thai',
  'co thai',
  'pregnant',
  'pregnancy',
];

const FRACTURE_OR_SURGERY_TERMS = [
  'gay chan',
  'gay tay',
  'gay xuong',
  'ran xuong',
  'nut xuong',
  'fracture',
  'broken',
  'bo bot',
  'cast',
  'nep',
  'phau thuat',
  'surgery',
  'moi mo',
];

const INJURY_TERMS = [
  'dau',
  'nhuc',
  'sung',
  'viem',
  'te',
  'buot',
  'chan thuong',
  'injury',
  'weak',
  'yeu',
  'khong chiu luc',
];

const LOWER_BODY_TERMS = [
  'chan',
  'goi',
  'dau goi',
  'co chan',
  'mat ca',
  'ban chan',
  'dui',
  'bap chan',
  'hamstring',
  'quad',
  'quadriceps',
  'calf',
  'achilles',
  'hip',
  'hang',
  'glute',
  'mong',
  'knee',
  'ankle',
  'foot',
  'leg',
];

const UPPER_BODY_TERMS = [
  'vai',
  'co tay',
  'khuu tay',
  'tay',
  'canh tay',
  'ban tay',
  'nguc',
  'shoulder',
  'wrist',
  'elbow',
  'arm',
  'hand',
  'chest',
];

const SPINE_CORE_TERMS = [
  'lung',
  'cot song',
  'thoat vi',
  'dia dem',
  'than kinh toa',
  'core',
  'bung',
  'spine',
  'back',
  'disc',
  'sciatica',
];

const HIGH_IMPACT_EXERCISE_TERMS = [
  'jump',
  'nhay',
  'plyo',
  'burpee',
  'box jump',
  'jump rope',
  'skipping',
  'sprint',
  'running',
  'run',
  'chay',
  'hiit',
  'tabata',
  'mountain climber',
];

const HEAVY_OR_COMPLEX_TERMS = [
  'deadlift',
  'squat',
  'clean',
  'snatch',
  'jerk',
  'barbell',
  'ta don lon',
  'smith',
  'heavy',
  'advanced',
  'kho',
];

const CORE_PRESSURE_TERMS = [
  'crunch',
  'sit up',
  'sit-up',
  'leg raise',
  'plank',
  'russian twist',
  'hollow',
  'toes to bar',
  'v up',
  'v-up',
  'gap bung',
  'xoay bung',
];

const GENTLE_EXERCISE_TERMS = [
  'walk',
  'walking',
  'di bo',
  'mobility',
  'stretch',
  'gian co',
  'yoga',
  'breathing',
  'tho',
  'warm up',
  'khoi dong',
  'easy',
  'beginner',
  'de',
  'bodyweight',
];

const EXPENSIVE_FOOD_TERMS = [
  'kobe',
  'wagyu',
  'sashimi',
  'caviar',
  'truffle',
  'foie',
  'steak',
  'tom hum',
  'lobster',
  'king crab',
  'cua hoang de',
];

const NON_VEGETARIAN_FOOD_TERMS = [
  'thit',
  'thit bo',
  'thit ga',
  'uc ga',
  'dui ga',
  'thit heo',
  'thit lon',
  'ca hoi',
  'ca ngu',
  'ca thu',
  'tom',
  'muc',
  'cua',
  'hai san',
  'salmon',
  'chicken',
  'beef',
  'pork',
  'fish',
  'shrimp',
  'seafood',
  'egg',
  'trung',
];

const ALLERGEN_GROUPS = [
  ['dau phong', 'lac', 'peanut'],
  ['sua', 'milk', 'lactose', 'dairy'],
  ['trung', 'egg'],
  ['tom', 'shrimp', 'shellfish', 'hai san', 'seafood'],
  ['ca hoi', 'ca ngu', 'ca thu', 'fish', 'salmon'],
  ['dau nanh', 'soy', 'soya'],
  ['lua mi', 'wheat', 'gluten'],
  ['me', 'sesame'],
  ['hat dieu', 'cashew'],
  ['hanh nhan', 'almond'],
];

const getContextText = (context: PersonalizationContext): string =>
  normalizeText([
    context.profile?.gender,
    context.profile?.job,
    context.lifestyle?.fitness_goal,
    context.lifestyle?.diet_preference,
    context.lifestyle?.current_diet,
    context.lifestyle?.budget_level,
    context.lifestyle?.workout_location,
    context.lifestyle?.equipment_available,
    context.health?.health_condition,
    context.health?.injuries,
    context.health?.medical_history,
    context.health?.allergies,
    context.health?.medications,
    context.health?.smoke_drink,
  ].filter(Boolean).join(' '));

export const buildUserSafetyProfile = (context: PersonalizationContext = {}): SafetyProfile => {
  const rawText = getContextText(context);
  const cardiacRisk = hasAny(rawText, CARDIAC_TERMS);
  const acuteWarningSigns = hasAny(rawText, ACUTE_WARNING_TERMS);
  const postpartumOrPregnancy = hasAny(rawText, POSTPARTUM_TERMS);
  const fractureOrSurgery = hasAny(rawText, FRACTURE_OR_SURGERY_TERMS);
  const injurySignal = hasAny(rawText, INJURY_TERMS) || fractureOrSurgery;
  const lowerBodyLimited = injurySignal && hasAny(rawText, LOWER_BODY_TERMS);
  const upperBodyLimited = injurySignal && hasAny(rawText, UPPER_BODY_TERMS);
  const spineOrCoreLimited = injurySignal && hasAny(rawText, SPINE_CORE_TERMS);
  const lowBudget = hasAny(rawText, ['sinh vien', 'tiet kiem', 'gia re', 'low budget', 'cheap']) || /\bre\b/.test(rawText);
  const vegetarian = hasAny(rawText, ['an chay', 'vegetarian', 'vegan']);
  const highRisk = cardiacRisk || acuteWarningSigns || postpartumOrPregnancy;

  const notes: string[] = [];
  if (cardiacRisk) notes.push('cardiac_or_blood_pressure_risk');
  if (acuteWarningSigns) notes.push('acute_warning_signs_need_medical_clearance');
  if (postpartumOrPregnancy) notes.push('postpartum_or_pregnancy_low_impact_only');
  if (lowerBodyLimited) notes.push('lower_body_limited');
  if (upperBodyLimited) notes.push('upper_body_limited');
  if (spineOrCoreLimited) notes.push('spine_or_core_limited');
  if (lowBudget) notes.push('low_budget_foods_only');
  if (vegetarian) notes.push('vegetarian_foods_only');

  return {
    rawText,
    cardiacRisk,
    acuteWarningSigns,
    postpartumOrPregnancy,
    lowerBodyLimited,
    upperBodyLimited,
    spineOrCoreLimited,
    fractureOrSurgery,
    lowBudget,
    vegetarian,
    rpeCap: highRisk ? 6 : (lowerBodyLimited || upperBodyLimited || spineOrCoreLimited ? 7 : 8),
    maxSets: highRisk ? 2 : (lowerBodyLimited || upperBodyLimited || spineOrCoreLimited ? 3 : 5),
    minRestSeconds: highRisk ? 90 : 60,
    maxTrainingDays: highRisk ? 3 : (fractureOrSurgery || lowerBodyLimited || upperBodyLimited || spineOrCoreLimited ? 3 : null),
    zeroExternalLoad: acuteWarningSigns || postpartumOrPregnancy,
    notes,
  };
};

const getExerciseDescriptor = (exercise?: ExerciseLike | null): string =>
  normalizeText([
    exercise?.name,
    exercise?.body_part,
    exercise?.target_muscle,
    exercise?.equipment,
    exercise?.difficulty,
    exercise?.movement_pattern,
    asTextList(exercise?.contraindications).join(' '),
  ].filter(Boolean).join(' '));

const contraindicationsConflict = (exerciseText: string, safety: SafetyProfile): boolean => {
  if (!exerciseText) return false;
  if (safety.cardiacRisk && hasAny(exerciseText, ['heart', 'cardiac', 'tim mach', 'huyet ap', 'blood pressure'])) return true;
  if (safety.postpartumOrPregnancy && hasAny(exerciseText, ['pregnan', 'postpartum', 'sau sinh', 'mang thai'])) return true;
  if (safety.lowerBodyLimited && hasAny(exerciseText, LOWER_BODY_TERMS)) return true;
  if (safety.upperBodyLimited && hasAny(exerciseText, UPPER_BODY_TERMS)) return true;
  if (safety.spineOrCoreLimited && hasAny(exerciseText, SPINE_CORE_TERMS)) return true;
  return false;
};

export const getExerciseSafetyDecision = (
  exercise: ExerciseLike | null | undefined,
  context: PersonalizationContext = {},
): ExerciseSafetyDecision => {
  const safety = buildUserSafetyProfile(context);
  const descriptor = getExerciseDescriptor(exercise);
  const contraindications = normalizeText(asTextList(exercise?.contraindications).join(' '));
  const reasons: string[] = [];

  if (!exercise || !String(exercise.exercise_id || exercise.id || '').trim()) {
    return { allowed: false, reasons: ['missing_exercise_id'] };
  }

  const isHighImpact = hasAny(descriptor, HIGH_IMPACT_EXERCISE_TERMS);
  const isHeavyOrComplex = hasAny(descriptor, HEAVY_OR_COMPLEX_TERMS);
  const isCorePressure = hasAny(descriptor, CORE_PRESSURE_TERMS);
  const isLowerBody = hasAny(descriptor, LOWER_BODY_TERMS);
  const isUpperBody = hasAny(descriptor, UPPER_BODY_TERMS);
  const isSpineOrCore = hasAny(descriptor, SPINE_CORE_TERMS) || isCorePressure;
  const isGentle = hasAny(descriptor, GENTLE_EXERCISE_TERMS) && !isHighImpact && !isHeavyOrComplex;

  if (contraindicationsConflict(contraindications, safety)) reasons.push('catalog_contraindication_conflict');
  if (safety.acuteWarningSigns && !isGentle) reasons.push('acute_warning_signs_only_gentle_mobility');
  if (safety.cardiacRisk && (isHighImpact || isHeavyOrComplex)) reasons.push('cardiac_risk_avoid_high_intensity_or_heavy_load');
  if (safety.postpartumOrPregnancy && (isHighImpact || isHeavyOrComplex || isCorePressure)) {
    reasons.push('postpartum_or_pregnancy_avoid_high_impact_heavy_core_pressure');
  }
  if (safety.lowerBodyLimited && (isLowerBody || isHighImpact)) reasons.push('lower_body_injury_limit');
  if (safety.upperBodyLimited && isUpperBody) reasons.push('upper_body_injury_limit');
  if (safety.spineOrCoreLimited && (isSpineOrCore || isHeavyOrComplex)) reasons.push('spine_core_injury_limit');

  return { allowed: reasons.length === 0, reasons };
};

export const filterSafeExercisesForUser = <T extends ExerciseLike>(
  exercises: T[] | null | undefined,
  context: PersonalizationContext = {},
): T[] => (exercises || []).filter((exercise) => getExerciseSafetyDecision(exercise, context).allowed);

const capExerciseIntensity = <T extends ExerciseLike>(exercise: T, context: PersonalizationContext): T => {
  const safety = buildUserSafetyProfile(context);
  const next = { ...exercise } as T;
  const currentSets = Number(next.sets || 0);
  const currentRest = Number(next.rest_seconds || 0);
  const currentRpe = Number(next.target_rpe || 0);
  const note = 'Safety guard: da giam tai theo ho so suc khoe/chan thuong.';

  if (currentSets > 0) next.sets = Math.min(currentSets, safety.maxSets);
  if (currentRest > 0) next.rest_seconds = Math.max(currentRest, safety.minRestSeconds);
  if (currentRpe > 0) next.target_rpe = Math.min(currentRpe, safety.rpeCap);
  if (safety.zeroExternalLoad) next.weight_kg = 0;
  if (safety.notes.length > 0) {
    next.load_instruction = String(next.load_instruction || note).slice(0, 160);
    next.note = String(next.note || note).slice(0, 200);
  }

  return next;
};

export const sanitizeWorkoutActionExercises = <T extends ExerciseLike>(
  exercises: T[] | null | undefined,
  context: PersonalizationContext = {},
  exerciseById?: Map<string, ExerciseLike>,
): { exercises: T[]; removedCount: number; warnings: string[] } => {
  const rows = exercises || [];
  const warnings: string[] = [];
  const safeRows = rows
    .map((exercise) => {
      const exerciseId = String(exercise.exercise_id || exercise.id || '').trim();
      const meta = exerciseById?.get(exerciseId) || {};
      const merged = { ...meta, ...exercise, id: exerciseId, exercise_id: exerciseId };
      const decision = getExerciseSafetyDecision(merged, context);
      if (!decision.allowed) {
        warnings.push(`${exerciseId || 'unknown'}:${decision.reasons.join(',')}`);
        return null;
      }
      return capExerciseIntensity(exercise, context);
    })
    .filter(Boolean) as T[];

  return {
    exercises: safeRows,
    removedCount: rows.length - safeRows.length,
    warnings,
  };
};

export const sanitizeWorkoutPlanForUser = <T extends WorkoutPlanLike>(
  workoutPlan: T,
  context: PersonalizationContext = {},
  exerciseById: Map<string, ExerciseLike> = new Map(),
): { workoutPlan: T; removedCount: number; warnings: string[] } => {
  const safety = buildUserSafetyProfile(context);
  let removedCount = 0;
  const warnings: string[] = [];
  let activeDays = 0;

  const days = workoutPlan.days.map((day) => {
    if (day.is_rest_day || !Array.isArray(day.exercises) || day.exercises.length === 0) {
      return { ...day, is_rest_day: true, exercises: [] };
    }

    const sanitized = sanitizeWorkoutActionExercises(day.exercises, context, exerciseById);
    removedCount += sanitized.removedCount;
    warnings.push(...sanitized.warnings);

    const hasReachedSafetyCap = safety.maxTrainingDays !== null && activeDays >= safety.maxTrainingDays;
    if (sanitized.exercises.length === 0 || hasReachedSafetyCap) {
      if (hasReachedSafetyCap) removedCount += sanitized.exercises.length;
      return {
        ...day,
        is_rest_day: true,
        duration_minutes: 0,
        exercises: [],
      };
    }

    activeDays += 1;
    return {
      ...day,
      exercises: sanitized.exercises,
      duration_minutes: Math.min(Math.max(10, Number(day.duration_minutes) || 20), safety.rpeCap <= 6 ? 35 : 75),
    };
  });

  const explanationSuffix = removedCount > 0 || safety.notes.length > 0
    ? ` Safety guard: ${safety.notes.join(', ') || 'personal constraints'}; removed ${removedCount} unsafe exercise(s).`
    : '';

  return {
    workoutPlan: {
      ...workoutPlan,
      explanation: String(`${workoutPlan.explanation || ''}${explanationSuffix}`).slice(0, 1500),
      days,
    },
    removedCount,
    warnings,
  };
};

const getFoodText = (food?: FoodLike | null): string =>
  normalizeText([
    food?.name,
    food?.category,
    asTextList(food?.allergens).join(' '),
    asTextList(food?.goal_type).join(' '),
    food?.price_level,
  ].filter(Boolean).join(' '));

const getFoodAllergenText = (food?: FoodLike | null): string =>
  normalizeText([
    food?.name,
    food?.category,
    asTextList(food?.allergens).join(' '),
  ].filter(Boolean).join(' '));

const getAllergenGroupsForUser = (context: PersonalizationContext): string[][] => {
  const text = normalizeText([
    context.health?.allergies,
    context.health?.medical_history,
    context.health?.health_condition,
  ].filter(Boolean).join(' '));
  if (!text || hasAny(text, ['khong di ung', 'khong co di ung', 'none', 'no allergy'])) return [];
  const groups = ALLERGEN_GROUPS.filter((group) => hasAny(text, group));
  if (/\bca\b/.test(text) && !groups.some((group) => group.includes('fish'))) {
    groups.push(['ca hoi', 'ca ngu', 'ca thu', 'fish', 'salmon']);
  }
  return groups;
};

const getFoodPriceKey = (food: FoodLike): 'low' | 'medium' | 'high' => {
  const text = normalizeText([food.price_level, food.name].filter(Boolean).join(' '));
  if (hasAny(text, ['tiet kiem', 'sinh vien', 'gia re', 'low budget', 'cheap']) || /\bre\b/.test(text)) return 'low';
  if (hasAny(text, ['thoai mai', 'cao cap', 'premium', ...EXPENSIVE_FOOD_TERMS])) return 'high';
  return 'medium';
};

export const getFoodSafetyDecision = (
  food: FoodLike | null | undefined,
  context: PersonalizationContext = {},
): FoodSafetyDecision => {
  const safety = buildUserSafetyProfile(context);
  const foodText = getFoodText(food);
  const allergenText = getFoodAllergenText(food);
  const reasons: string[] = [];

  if (!food || !String(food.id || '').trim()) {
    return { allowed: false, reasons: ['missing_food_id'] };
  }

  for (const group of getAllergenGroupsForUser(context)) {
    if (hasAny(allergenText, group)) {
      reasons.push('allergen_conflict');
      break;
    }
  }

  if (safety.lowBudget && getFoodPriceKey(food) === 'high') reasons.push('low_budget_blocks_high_price_food');
  if (safety.lowBudget && hasAny(foodText, EXPENSIVE_FOOD_TERMS)) reasons.push('low_budget_blocks_expensive_food_name');

  if (safety.vegetarian) {
    const explicitVegetarian = hasAny(foodText, ['an chay', 'vegetarian', 'vegan', 'tofu', 'dau hu', 'tempeh']);
    if (!explicitVegetarian && hasAny(foodText, NON_VEGETARIAN_FOOD_TERMS)) reasons.push('vegetarian_conflict');
  }

  return { allowed: reasons.length === 0, reasons };
};

export const filterSafeFoodsForUser = <T extends FoodLike>(
  foods: T[] | null | undefined,
  context: PersonalizationContext = {},
): T[] => (foods || []).filter((food) => getFoodSafetyDecision(food, context).allowed);

export const buildSafetyPromptAddendum = (context: PersonalizationContext = {}): string => {
  const safety = buildUserSafetyProfile(context);
  if (safety.notes.length === 0) {
    return [
      'SAFETY_CONSTRAINTS:',
      '- No explicit high-risk medical, injury, allergy, or budget constraint was detected in Fitly profile.',
      '- Still keep prescriptions conservative for the listed experience level and available equipment.',
    ].join('\n');
  }

  const rules = [
    'SAFETY_CONSTRAINTS:',
    `- Hard guard flags: ${safety.notes.join(', ')}.`,
    `- Max target RPE: ${safety.rpeCap}; max sets per exercise: ${safety.maxSets}; minimum rest: ${safety.minRestSeconds}s.`,
    '- If a safe exercise or food choice is not available in the catalog, use a rest/recovery day or omit that unsafe item. Do not improvise new ids.',
  ];

  if (safety.cardiacRisk || safety.acuteWarningSigns) {
    rules.push('- Cardiac/blood-pressure or acute warning signs: avoid high intensity, jumping/running/HIIT, heavy loads, and advise medical clearance for symptoms.');
  }
  if (safety.postpartumOrPregnancy) {
    rules.push('- Postpartum/pregnancy: low-impact only; avoid heavy lifting, intense core pressure, jumping, sprinting, and breath-holding.');
  }
  if (safety.lowerBodyLimited) rules.push('- Lower-body injury/fracture: avoid leg loading, squats, lunges, running, jumping, and lower-body impact.');
  if (safety.upperBodyLimited) rules.push('- Upper-body injury: avoid loading the painful/injured shoulder, elbow, wrist, arm, chest, or hand area.');
  if (safety.spineOrCoreLimited) rules.push('- Back/spine/core issue: avoid axial loading, heavy hinges, twisting, crunches, and hard planks.');
  if (safety.lowBudget) rules.push('- Low/student budget: choose low/medium price foods only; never choose Kobe, Wagyu, sashimi, caviar, lobster, or premium foods.');
  if (safety.vegetarian) rules.push('- Vegetarian preference: choose vegetarian-safe foods only.');

  return rules.join('\n');
};
