/**
 * Shared Exercise Catalog contract.
 *
 * This module intentionally has no framework or database dependency so the
 * browser, API and import tooling apply the same taxonomy and normalization.
 */

export const TRAINING_LOCATIONS = ['home', 'gym'] as const;
export type TrainingLocation = typeof TRAINING_LOCATIONS[number];

export const EXERCISE_DIFFICULTIES = [
  'easy',
  'medium',
  'hard',
] as const;
export type ExerciseDifficulty = typeof EXERCISE_DIFFICULTIES[number];

export const EXERCISE_DIFFICULTY_LABELS = {
  easy: 'Dễ',
  medium: 'Trung bình',
  hard: 'Khó',
} as const satisfies Record<ExerciseDifficulty, string>;

export const BODY_PARTS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'full_body',
  'mobility',
] as const;
export type BodyPart = typeof BODY_PARTS[number];

export const EQUIPMENT_TYPES = [
  'none',
  'chair',
  'bench',
  'resistance_band',
  'dumbbell',
  'kettlebell',
  'barbell',
  'cable',
  'machine',
  'pull_up_bar',
  'stability_ball',
  'foam_roller',
] as const;
export type Equipment = typeof EQUIPMENT_TYPES[number];

export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'knee_extension',
  'knee_flexion',
  'hip_abduction',
  'horizontal_push',
  'horizontal_pull',
  'vertical_push',
  'vertical_pull',
  'elbow_flexion',
  'elbow_extension',
  'calf_raise',
  'core_flexion',
  'anti_extension',
  'anti_rotation',
  'rotation',
  'carry',
  'locomotion',
  'mobility',
] as const;
export type MovementPattern = typeof MOVEMENT_PATTERNS[number];

// This covers the goals already used in Fitly UI while giving imported items a
// stable vocabulary. Legacy labels are normalized by normalizeGoalType.
export const GOAL_TYPES = [
  'general_fitness',
  'weight_loss',
  'muscle_gain',
  'strength',
  'endurance',
  'mobility',
  'recovery',
] as const;
export type GoalType = typeof GOAL_TYPES[number];

export type ExerciseInstructions = {
  setup: string[];
  steps: string[];
  breathing: string[];
  coaching_cues: string[];
  common_mistakes: string[];
  easier_variation_id?: string;
  harder_variation_id?: string;
};

export type Exercise = {
  id: string;
  name: string;
  body_part: string | null;
  target_muscle: string | null;
  secondary_muscles: string[];
  equipment: string | null;
  training_locations: TrainingLocation[];
  difficulty: string | null;
  min_experience_months: number;
  progression_level: number;
  movement_pattern: string | null;
  goal_type: string[];
  contraindications: string[];
  estimated_duration_seconds: number | null;
  calories_per_minute: number | null;
  /** Direct, browser-playable exercise video URL (MP4/WebM). */
  video_url: string | null;
  instructions: ExerciseInstructions;
};

export type ExerciseCatalogItem = Omit<Exercise, 'body_part' | 'target_muscle' | 'equipment' | 'difficulty' | 'movement_pattern'> & {
  body_part: string;
  target_muscle: string;
  equipment: string;
  difficulty: ExerciseDifficulty;
  movement_pattern: string;
};

export type ExerciseEligibilityContext = {
  workoutLocation: TrainingLocation | null;
  availableEquipment: Set<string>;
  experienceMonths: number;
  fitnessGoal: string | null;
  healthConditions: string[];
  injuries: string[];
  excludedExerciseIds?: Set<string>;
  /** Backend-only source retained so hard safety guards see the full profile. */
  safetyContext?: {
    profile?: Record<string, unknown> | null;
    lifestyle?: Record<string, unknown> | null;
    health?: Record<string, unknown> | null;
  };
};

export type CatalogValidationIssue = {
  path: string;
  message: string;
};

export type CatalogValidationResult = {
  valid: boolean;
  issues: CatalogValidationIssue[];
  normalizedItems: ExerciseCatalogItem[];
  counts: Record<string, Record<string, number>>;
};

const EMPTY_INSTRUCTIONS: ExerciseInstructions = {
  setup: [],
  steps: [],
  breathing: [],
  coaching_cues: [],
  common_mistakes: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeTextKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const trimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

export const normalizeStringArray = (value: unknown): string[] => {
  const candidates = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return uniqueStrings(
    candidates
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  );
};

const LOCATION_ALIASES: Record<string, TrainingLocation> = {
  home: 'home',
  at_home: 'home',
  house: 'home',
  tai_nha: 'home',
  tap_tai_nha: 'home',
  tap_tai_nha_home_workout: 'home',
  home_workout: 'home',
  gym: 'gym',
  fitness_center: 'gym',
  fitness_centre: 'gym',
  phong_gym: 'gym',
  phong_gym_chuyen_nghiep: 'gym',
};

const DIFFICULTY_ALIASES: Record<string, ExerciseDifficulty> = {
  absolute_beginner: 'easy',
  absolute_beginner_level: 'easy',
  novice: 'easy',
  easy: 'easy',
  de: 'easy',
  beginner: 'medium',
  intermediate: 'medium',
  medium: 'medium',
  trung_binh: 'medium',
  hard: 'hard',
  kho: 'hard',
  beginner_plus: 'hard',
  advanced: 'hard',
};

const EQUIPMENT_ALIASES: Record<string, Equipment> = {
  none: 'none',
  bodyweight: 'none',
  body_weight: 'none',
  no_equipment: 'none',
  khong_dung_cu: 'none',
  khong_co_dung_cu: 'none',
  calisthenics: 'none',
  chair: 'chair',
  ghe: 'chair',
  bench: 'bench',
  ghe_tap: 'bench',
  resistance_band: 'resistance_band',
  resistance_bands: 'resistance_band',
  band: 'resistance_band',
  bands: 'resistance_band',
  day_khang_luc: 'resistance_band',
  dumbbell: 'dumbbell',
  dumbbells: 'dumbbell',
  ta_don: 'dumbbell',
  ta_don_tham: 'dumbbell',
  kettlebell: 'kettlebell',
  ta_am: 'kettlebell',
  barbell: 'barbell',
  barbells: 'barbell',
  ta_don_dai: 'barbell',
  thanh_don: 'barbell',
  cable: 'cable',
  cap: 'cable',
  machine: 'machine',
  machines: 'machine',
  may_tap: 'machine',
  pull_up_bar: 'pull_up_bar',
  pullup_bar: 'pull_up_bar',
  pull_up_bars: 'pull_up_bar',
  xa_don: 'pull_up_bar',
  stability_ball: 'stability_ball',
  swiss_ball: 'stability_ball',
  bong_tap: 'stability_ball',
  foam_roller: 'foam_roller',
  con_lan: 'foam_roller',
};

const BODY_PART_ALIASES: Record<string, BodyPart> = {
  chest: 'chest',
  nguc: 'chest',
  back: 'back',
  lung: 'back',
  shoulders: 'shoulders',
  shoulder: 'shoulders',
  vai: 'shoulders',
  biceps: 'biceps',
  bicep: 'biceps',
  tay_truoc: 'biceps',
  triceps: 'triceps',
  tricep: 'triceps',
  tay_sau: 'triceps',
  quadriceps: 'quadriceps',
  quads: 'quadriceps',
  dui_truoc: 'quadriceps',
  hamstrings: 'hamstrings',
  hamstring: 'hamstrings',
  dui_sau: 'hamstrings',
  glutes: 'glutes',
  glute: 'glutes',
  mong: 'glutes',
  calves: 'calves',
  calf: 'calves',
  bap_chan: 'calves',
  core: 'core',
  abs: 'core',
  bung: 'core',
  full_body: 'full_body',
  whole_body: 'full_body',
  toan_than: 'full_body',
  mobility: 'mobility',
  linh_hoat: 'mobility',
};

const MOVEMENT_PATTERN_ALIASES: Record<string, MovementPattern> = {
  squat: 'squat',
  hinge: 'hinge',
  hip_hinge: 'hinge',
  lunge: 'lunge',
  knee_extension: 'knee_extension',
  knee_ext: 'knee_extension',
  leg_extension: 'knee_extension',
  leg_extensions: 'knee_extension',
  duoi_goi: 'knee_extension',
  duoi_khop_goi: 'knee_extension',
  knee_flexion: 'knee_flexion',
  knee_flex: 'knee_flexion',
  leg_curl: 'knee_flexion',
  leg_curls: 'knee_flexion',
  hamstring_curl: 'knee_flexion',
  hamstring_curls: 'knee_flexion',
  gap_goi: 'knee_flexion',
  gap_khop_goi: 'knee_flexion',
  hip_abduction: 'hip_abduction',
  hip_abductor: 'hip_abduction',
  hip_abductors: 'hip_abduction',
  abduction: 'hip_abduction',
  clamshell: 'hip_abduction',
  clamshells: 'hip_abduction',
  side_lying_hip_abduction: 'hip_abduction',
  dang_hong: 'hip_abduction',
  dang_khop_hang: 'hip_abduction',
  horizontal_push: 'horizontal_push',
  horizontal_press: 'horizontal_push',
  horizontal_pull: 'horizontal_pull',
  horizontal_row: 'horizontal_pull',
  vertical_push: 'vertical_push',
  vertical_press: 'vertical_push',
  vertical_pull: 'vertical_pull',
  elbow_flexion: 'elbow_flexion',
  elbow_extension: 'elbow_extension',
  calf_raise: 'calf_raise',
  core_flexion: 'core_flexion',
  anti_extension: 'anti_extension',
  anti_rotation: 'anti_rotation',
  rotation: 'rotation',
  carry: 'carry',
  locomotion: 'locomotion',
  mobility: 'mobility',
};

const GOAL_ALIASES: Record<string, GoalType> = {
  general_fitness: 'general_fitness',
  general: 'general_fitness',
  giu_dang: 'general_fitness',
  weight_loss: 'weight_loss',
  fat_loss: 'weight_loss',
  giam_can: 'weight_loss',
  giam_mo: 'weight_loss',
  muscle_gain: 'muscle_gain',
  hypertrophy: 'muscle_gain',
  tang_co: 'muscle_gain',
  strength: 'strength',
  suc_manh: 'strength',
  endurance: 'endurance',
  suc_ben: 'endurance',
  mobility: 'mobility',
  deo_dai: 'mobility',
  recovery: 'recovery',
  phuc_hoi: 'recovery',
  phuc_hoi_tai_tao: 'recovery',
};

export const normalizeTrainingLocation = (value: unknown): TrainingLocation | null =>
  LOCATION_ALIASES[normalizeTextKey(value)] || null;

export const normalizeDifficulty = (value: unknown): ExerciseDifficulty | null =>
  DIFFICULTY_ALIASES[normalizeTextKey(value)] || null;

export const normalizeEquipment = (value: unknown): Equipment | null =>
  EQUIPMENT_ALIASES[normalizeTextKey(value)] || null;

export const normalizeBodyPart = (value: unknown): BodyPart | null =>
  BODY_PART_ALIASES[normalizeTextKey(value)] || null;

export const normalizeMovementPattern = (value: unknown): MovementPattern | null =>
  MOVEMENT_PATTERN_ALIASES[normalizeTextKey(value)] || null;

export const normalizeGoalType = (value: unknown): GoalType | null =>
  GOAL_ALIASES[normalizeTextKey(value)] || null;

export const normalizeTrainingLocations = (
  value: unknown,
  fallback: TrainingLocation[] = [...TRAINING_LOCATIONS],
): TrainingLocation[] => {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const normalized = uniqueStrings(
    values
      .map(normalizeTrainingLocation)
      .filter((item): item is TrainingLocation => item !== null),
  ) as TrainingLocation[];
  return normalized.length > 0 ? normalized : [...fallback];
};

export const parseAvailableEquipment = (value: unknown): Set<Equipment> => {
  let rawValues: unknown[] = [];

  if (Array.isArray(value)) {
    rawValues = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        rawValues = Array.isArray(parsed) ? parsed : [trimmed];
      } catch {
        rawValues = [trimmed];
      }
    } else {
      rawValues = trimmed.split(/[;,]/g);
    }
  }

  const resolved = new Set<Equipment>(['none']);
  for (const rawValue of rawValues) {
    const key = normalizeTextKey(rawValue);
    // Legacy survey option: it is a bundle, not a literal equipment value.
    if (key === 'day_du_ta_may_moc' || key === 'full_gym_equipment') {
      ['dumbbell', 'barbell', 'cable', 'machine', 'bench'].forEach((item) => resolved.add(item as Equipment));
      continue;
    }
    const equipment = normalizeEquipment(rawValue);
    if (equipment) resolved.add(equipment);
  }
  return resolved;
};

export const experienceLevelToMonths = (value: unknown): number => {
  const key = normalizeTextKey(value);
  if (!key) return 0;
  if (['never', 'none', 'absolute_beginner', 'chua_tap', 'nguoi_moi', 'moi_tap'].includes(key)) return 0;
  if (['beginner', 'less_than_3_months', 'duoi_3_thang'].includes(key)) return 1;
  if (['3_to_6_months', 'under_6_months', 'beginner_plus', 'da_tap_duoi_6_thang'].includes(key)) return 4;
  if (['6_to_12_months', 'intermediate', 'trung_cap'].includes(key)) return 8;
  if (['over_1_year', 'experienced', 'advanced', 'nang_cao'].includes(key)) return 12;
  return 0;
};

/** Unknown legacy difficulty deliberately stays conservative. */
export const difficultyToMinimumExperienceMonths = (value: unknown): number => {
  const key = normalizeTextKey(value);
  if (['absolute_beginner', 'absolute_beginner_level', 'novice', 'easy', 'de'].includes(key)) return 0;
  if (['beginner', 'intermediate', 'medium', 'trung_binh'].includes(key)) return 6;
  if (['beginner_plus', 'advanced', 'hard', 'kho'].includes(key)) return 12;
  return 12;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIntegerInRange = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const normalizeOptionalUrl = (value: unknown): string | null => trimmedString(value);

const normalizeVariationId = (value: unknown): string | undefined => trimmedString(value) || undefined;

export const normalizeExerciseInstructions = (value: unknown): ExerciseInstructions => {
  if (typeof value === 'string') {
    return { ...EMPTY_INSTRUCTIONS, steps: normalizeStringArray(value) };
  }
  if (Array.isArray(value)) {
    return { ...EMPTY_INSTRUCTIONS, steps: normalizeStringArray(value) };
  }
  if (!isRecord(value)) return { ...EMPTY_INSTRUCTIONS };

  const steps = normalizeStringArray(value.steps ?? value.instructions ?? value.instruction);
  return {
    setup: normalizeStringArray(value.setup),
    steps,
    breathing: normalizeStringArray(value.breathing),
    coaching_cues: normalizeStringArray(value.coaching_cues ?? value.coachingCues ?? value.technique_notes),
    common_mistakes: normalizeStringArray(value.common_mistakes ?? value.commonMistakes),
    ...(normalizeVariationId(value.easier_variation_id ?? value.easierVariationId)
      ? { easier_variation_id: normalizeVariationId(value.easier_variation_id ?? value.easierVariationId) }
      : {}),
    ...(normalizeVariationId(value.harder_variation_id ?? value.harderVariationId)
      ? { harder_variation_id: normalizeVariationId(value.harder_variation_id ?? value.harderVariationId) }
      : {}),
  };
};

export const normalizeExercise = (value: unknown): Exercise => {
  const record = isRecord(value) ? value : {};
  const rawDifficulty = trimmedString(record.difficulty);
  const rawEquipment = trimmedString(record.equipment);
  const rawBodyPart = trimmedString(record.body_part);
  const rawTargetMuscle = trimmedString(record.target_muscle);
  const rawMovementPattern = trimmedString(record.movement_pattern);
  const providedMinimum = toFiniteNumber(record.min_experience_months);
  const normalizedGoals = normalizeStringArray(record.goal_type)
    .map((item) => normalizeGoalType(item) || item)
    .filter(Boolean);

  return {
    id: trimmedString(record.id) || '',
    name: trimmedString(record.name) || '',
    body_part: normalizeBodyPart(rawBodyPart) || rawBodyPart,
    target_muscle: normalizeBodyPart(rawTargetMuscle) || rawTargetMuscle,
    secondary_muscles: normalizeStringArray(record.secondary_muscles)
      .map((item) => normalizeBodyPart(item) || item),
    equipment: normalizeEquipment(rawEquipment) || rawEquipment,
    training_locations: normalizeTrainingLocations(record.training_locations),
    difficulty: normalizeDifficulty(rawDifficulty) || rawDifficulty,
    min_experience_months: providedMinimum === null
      ? difficultyToMinimumExperienceMonths(rawDifficulty)
      : Math.min(120, Math.max(0, Math.round(providedMinimum))),
    progression_level: toIntegerInRange(record.progression_level, 1, 1, 5),
    movement_pattern: normalizeMovementPattern(rawMovementPattern) || rawMovementPattern,
    goal_type: uniqueStrings(normalizedGoals),
    contraindications: normalizeStringArray(record.contraindications),
    estimated_duration_seconds: toFiniteNumber(record.estimated_duration_seconds),
    calories_per_minute: toFiniteNumber(record.calories_per_minute),
    video_url: normalizeOptionalUrl(record.video_url),
    instructions: normalizeExerciseInstructions(record.instructions),
  };
};

export const isExerciseId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export const EXERCISE_LABELS = {
  trainingLocation: {
    home: 'Tại nhà',
    gym: 'Phòng gym',
  } satisfies Record<TrainingLocation, string>,
  equipment: {
    none: 'Không dụng cụ',
    chair: 'Ghế',
    bench: 'Ghế tập',
    resistance_band: 'Dây kháng lực',
    dumbbell: 'Tạ đơn',
    kettlebell: 'Tạ ấm',
    barbell: 'Tạ đòn',
    cable: 'Cáp',
    machine: 'Máy tập',
    pull_up_bar: 'Xà đơn',
    stability_ball: 'Bóng tập',
    foam_roller: 'Con lăn',
  } satisfies Record<Equipment, string>,
  difficulty: {
    ...EXERCISE_DIFFICULTY_LABELS,
  } satisfies Record<ExerciseDifficulty, string>,
  bodyPart: {
    chest: 'Ngực',
    back: 'Lưng',
    shoulders: 'Vai',
    biceps: 'Tay trước',
    triceps: 'Tay sau',
    quadriceps: 'Đùi trước',
    hamstrings: 'Đùi sau',
    glutes: 'Mông',
    calves: 'Bắp chân',
    core: 'Cơ bụng',
    full_body: 'Toàn thân',
    mobility: 'Linh hoạt',
  } satisfies Record<BodyPart, string>,
  movementPattern: {
    squat: 'Ngồi xổm',
    hinge: 'Gập hông',
    lunge: 'Chùng chân',
    knee_extension: 'Duỗi gối',
    knee_flexion: 'Gập gối',
    hip_abduction: 'Dang hông',
    horizontal_push: 'Đẩy ngang',
    horizontal_pull: 'Kéo ngang',
    vertical_push: 'Đẩy dọc',
    vertical_pull: 'Kéo dọc',
    elbow_flexion: 'Gập khuỷu',
    elbow_extension: 'Duỗi khuỷu',
    calf_raise: 'Nâng bắp chân',
    core_flexion: 'Gập bụng',
    anti_extension: 'Chống duỗi',
    anti_rotation: 'Chống xoay',
    rotation: 'Xoay',
    carry: 'Mang vác',
    locomotion: 'Di chuyển',
    mobility: 'Linh hoạt',
  } satisfies Record<MovementPattern, string>,
} as const;

const TARGET_MUSCLE_LABELS: Record<string, string> = {
  pectoralis_major: 'Cơ ngực lớn',
  latissimus_dorsi: 'Cơ xô',
  trapezius: 'Cơ thang',
  anterior_deltoid: 'Vai trước',
  lateral_deltoid: 'Vai giữa',
  posterior_deltoid: 'Vai sau',
  biceps: 'Cơ tay trước',
  triceps: 'Cơ tay sau',
  forearms: 'Cẳng tay',
  rectus_abdominis: 'Cơ bụng thẳng',
  obliques: 'Cơ liên sườn',
  erector_spinae: 'Cơ dựng sống',
  quadriceps: 'Cơ đùi trước',
  hamstrings: 'Cơ đùi sau',
  gluteus_maximus: 'Cơ mông lớn',
  gluteus_medius: 'Cơ mông giữa',
  calves: 'Bắp chân',
  gastrocnemius: 'Cơ bụng chân',
  soleus: 'Cơ dép',
  hip_adductors: 'Cơ khép hông',
  hip_abductors: 'Cơ dạng hông',
  hip_flexors: 'Cơ gập hông',
};

export const formatBodyPartLabel = (value: unknown): string | null => {
  const bodyPart = normalizeBodyPart(value);
  return bodyPart ? EXERCISE_LABELS.bodyPart[bodyPart] : TARGET_MUSCLE_LABELS[normalizeTextKey(value)] || null;
};

export const formatTargetMuscleLabel = (value: unknown): string | null =>
  TARGET_MUSCLE_LABELS[normalizeTextKey(value)] || formatBodyPartLabel(value);

export const formatEquipmentLabel = (value: unknown): string | null => {
  const equipment = normalizeEquipment(value);
  return equipment ? EXERCISE_LABELS.equipment[equipment] : null;
};

export const formatMovementPatternLabel = (value: unknown): string | null => {
  const pattern = normalizeMovementPattern(value);
  return pattern ? EXERCISE_LABELS.movementPattern[pattern] : null;
};

export const formatTrainingLocations = (locations: unknown): string | null => {
  const normalized = normalizeTrainingLocations(locations, []);
  if (normalized.length === 0) return null;
  if (normalized.length === 2) return 'Tại nhà & phòng gym';
  return EXERCISE_LABELS.trainingLocation[normalized[0]];
};

export const formatExperienceRequirement = (months: unknown): string | null => {
  const value = toFiniteNumber(months);
  if (value === null || value < 0) return null;
  if (value === 0) return 'Người mới';
  if (value < 3) return `Từ ${Math.round(value)} tháng`;
  if (value <= 6) return 'Từ 3 tháng';
  return `Từ ${Math.round(value)} tháng`;
};

export const formatDifficultyLabel = (value: unknown): string | null => {
  const canonical = normalizeDifficulty(value);
  if (canonical) return EXERCISE_LABELS.difficulty[canonical];
  return null;
};

const ALLOWED_CATALOG_KEYS = new Set([
  'id',
  'name',
  'body_part',
  'target_muscle',
  'secondary_muscles',
  'equipment',
  'training_locations',
  'difficulty',
  'min_experience_months',
  'progression_level',
  'movement_pattern',
  'goal_type',
  'contraindications',
  'estimated_duration_seconds',
  'calories_per_minute',
  'video_url',
  'instructions',
]);

const isOptionalUrl = (value: unknown): boolean => {
  if (value === null) return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const addCount = (target: Record<string, Record<string, number>>, group: string, value: string) => {
  if (!target[group]) target[group] = {};
  target[group][value] = (target[group][value] || 0) + 1;
};

const getCatalogItemRecord = (value: unknown): Record<string, unknown> | null => isRecord(value) ? value : null;

const validateInstructionContract = (instructions: ExerciseInstructions, path: string, issues: CatalogValidationIssue[]) => {
  if (instructions.setup.length === 0) issues.push({ path: `${path}.setup`, message: 'requires at least one setup/context item' });
  if (instructions.steps.length < 2) issues.push({ path: `${path}.steps`, message: 'requires at least two steps' });
  if (instructions.breathing.length === 0) issues.push({ path: `${path}.breathing`, message: 'requires at least one breathing cue' });
  if (instructions.coaching_cues.length === 0) issues.push({ path: `${path}.coaching_cues`, message: 'requires at least one coaching cue' });
  if (instructions.common_mistakes.length < 2) issues.push({ path: `${path}.common_mistakes`, message: 'requires at least two common mistakes' });
};

const findVariationCycle = (items: ExerciseCatalogItem[]): string[] | null => {
  const graph = new Map<string, string[]>();
  items.forEach((item) => {
    graph.set(item.id, [item.instructions.easier_variation_id, item.instructions.harder_variation_id].filter((id): id is string => Boolean(id)));
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: string[]): string[] | null => {
    if (visiting.has(id)) return [...trail, id];
    if (visited.has(id)) return null;
    visiting.add(id);
    for (const next of graph.get(id) || []) {
      const cycle = visit(next, [...trail, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const id of graph.keys()) {
    const cycle = visit(id, []);
    if (cycle) return cycle;
  }
  return null;
};

export const validateExerciseCatalog = (
  value: unknown,
  options: { expectedCount?: number } = {},
): CatalogValidationResult => {
  const issues: CatalogValidationIssue[] = [];
  const normalizedItems: ExerciseCatalogItem[] = [];
  const counts: Record<string, Record<string, number>> = {};
  if (!Array.isArray(value)) {
    return { valid: false, issues: [{ path: '$', message: 'catalog root must be a JSON array' }], normalizedItems, counts };
  }
  if (options.expectedCount !== undefined && value.length !== options.expectedCount) {
    issues.push({ path: '$', message: `expected ${options.expectedCount} exercises, received ${value.length}` });
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  value.forEach((item, index) => {
    const path = `$[${index}]`;
    const record = getCatalogItemRecord(item);
    if (!record) {
      issues.push({ path, message: 'item must be an object' });
      return;
    }
    Object.keys(record).forEach((key) => {
      if (!ALLOWED_CATALOG_KEYS.has(key)) issues.push({ path: `${path}.${key}`, message: 'unknown field' });
    });
    ALLOWED_CATALOG_KEYS.forEach((key) => {
      if (!(key in record)) issues.push({ path: `${path}.${key}`, message: 'required field is missing' });
    });

    const normalized = normalizeExercise(record);
    const catalogItem: ExerciseCatalogItem = {
      ...normalized,
      body_part: normalizeBodyPart(record.body_part) || '',
      target_muscle: normalizeBodyPart(record.target_muscle) || '',
      equipment: normalizeEquipment(record.equipment) || '',
      difficulty: normalizeDifficulty(record.difficulty) || 'easy',
      movement_pattern: normalizeMovementPattern(record.movement_pattern) || '',
    };
    normalizedItems.push(catalogItem);

    if (!isExerciseId(record.id)) issues.push({ path: `${path}.id`, message: 'must be lowercase kebab-case' });
    if (!catalogItem.name) issues.push({ path: `${path}.name`, message: 'must be non-empty' });
    if (ids.has(catalogItem.id)) issues.push({ path: `${path}.id`, message: `duplicate id: ${catalogItem.id}` });
    ids.add(catalogItem.id);
    const normalizedName = normalizeTextKey(catalogItem.name);
    if (normalizedName && names.has(normalizedName)) issues.push({ path: `${path}.name`, message: 'duplicate name after normalization' });
    if (normalizedName) names.add(normalizedName);

    if (!normalizeBodyPart(record.body_part)) issues.push({ path: `${path}.body_part`, message: 'invalid body_part taxonomy' });
    if (!normalizeBodyPart(record.target_muscle)) issues.push({ path: `${path}.target_muscle`, message: 'invalid target_muscle taxonomy' });
    if (!Array.isArray(record.secondary_muscles)) issues.push({ path: `${path}.secondary_muscles`, message: 'must be an array' });
    const secondary = normalizeStringArray(record.secondary_muscles).map((entry) => normalizeBodyPart(entry));
    if (secondary.some((entry) => !entry)) issues.push({ path: `${path}.secondary_muscles`, message: 'contains invalid muscle taxonomy' });
    if (secondary.filter(Boolean).includes(catalogItem.target_muscle as BodyPart)) {
      issues.push({ path: `${path}.secondary_muscles`, message: 'must not include target_muscle' });
    }
    if (!normalizeEquipment(record.equipment)) issues.push({ path: `${path}.equipment`, message: 'invalid equipment taxonomy' });
    if (!Array.isArray(record.training_locations) || catalogItem.training_locations.length === 0 ||
      (record.training_locations as unknown[]).some((entry) => !normalizeTrainingLocation(entry))) {
      issues.push({ path: `${path}.training_locations`, message: 'must be a non-empty array of home/gym values' });
    }
    if (typeof record.difficulty !== 'string' || !EXERCISE_DIFFICULTIES.includes(record.difficulty as ExerciseDifficulty)) {
      issues.push({ path: `${path}.difficulty`, message: 'must be one of: easy, medium, hard' });
    }
    if (!normalizeMovementPattern(record.movement_pattern)) issues.push({ path: `${path}.movement_pattern`, message: 'invalid movement_pattern taxonomy' });
    if (!Array.isArray(record.goal_type) || normalizeStringArray(record.goal_type).some((entry) => !normalizeGoalType(entry))) {
      issues.push({ path: `${path}.goal_type`, message: 'must be an array using canonical goal taxonomy' });
    }
    if (!Array.isArray(record.contraindications)) issues.push({ path: `${path}.contraindications`, message: 'must be an array' });
    if (!Number.isInteger(Number(record.min_experience_months)) || catalogItem.min_experience_months < 0 || catalogItem.min_experience_months > 6) {
      issues.push({ path: `${path}.min_experience_months`, message: 'must be an integer from 0 to 6 for this catalog phase' });
    }
    if (!Number.isInteger(Number(record.progression_level)) || catalogItem.progression_level < 1 || catalogItem.progression_level > 5) {
      issues.push({ path: `${path}.progression_level`, message: 'must be an integer from 1 to 5' });
    }
    if (record.estimated_duration_seconds !== null && (!Number.isInteger(Number(record.estimated_duration_seconds)) || Number(record.estimated_duration_seconds) <= 0)) {
      issues.push({ path: `${path}.estimated_duration_seconds`, message: 'must be a positive integer or null' });
    }
    if (record.calories_per_minute !== null && (!Number.isFinite(Number(record.calories_per_minute)) || Number(record.calories_per_minute) < 0)) {
      issues.push({ path: `${path}.calories_per_minute`, message: 'must be a non-negative number or null' });
    }
    if (!isOptionalUrl(record.video_url)) issues.push({ path: `${path}.video_url`, message: 'must be a valid http(s) URL or null' });
    validateInstructionContract(catalogItem.instructions, `${path}.instructions`, issues);

    addCount(counts, 'body_part', catalogItem.body_part || 'invalid');
    addCount(counts, 'target_muscle', catalogItem.target_muscle || 'invalid');
    addCount(counts, 'equipment', catalogItem.equipment || 'invalid');
    catalogItem.training_locations.forEach((location) => addCount(counts, 'training_location', location));
    addCount(counts, 'difficulty', catalogItem.difficulty);
    addCount(counts, 'min_experience_months', String(catalogItem.min_experience_months));
    addCount(counts, 'movement_pattern', catalogItem.movement_pattern || 'invalid');
  });

  normalizedItems.forEach((item, index) => {
    const path = `$[${index}].instructions`;
    const variationIds = [item.instructions.easier_variation_id, item.instructions.harder_variation_id].filter((id): id is string => Boolean(id));
    variationIds.forEach((variationId) => {
      if (variationId === item.id) issues.push({ path, message: 'variation id cannot reference itself' });
      else if (!ids.has(variationId)) issues.push({ path, message: `variation id does not exist: ${variationId}` });
    });
  });
  const cycle = findVariationCycle(normalizedItems);
  if (cycle) issues.push({ path: '$', message: `variation graph contains a cycle: ${cycle.join(' -> ')}` });

  return { valid: issues.length === 0, issues, normalizedItems, counts };
};

export const getExerciseForAI = (exercise: Exercise) => ({
  id: exercise.id,
  name: exercise.name,
  body_part: exercise.body_part,
  target_muscle: exercise.target_muscle,
  secondary_muscles: exercise.secondary_muscles,
  equipment: exercise.equipment,
  training_locations: exercise.training_locations,
  difficulty: exercise.difficulty,
  min_experience_months: exercise.min_experience_months,
  progression_level: exercise.progression_level,
  movement_pattern: exercise.movement_pattern,
  goal_type: exercise.goal_type,
});
