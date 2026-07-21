import { useCallback, useEffect, useMemo, useState, type ElementType, type FormEvent } from 'react';
import {
  Activity,
  BarChart3,
  Brain,
  Crown,
  Dumbbell,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Shield,
  Trash2,
  Users,
  Utensils,
  X
} from 'lucide-react';
import { fetchWithAuth } from '../lib/Api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ToastProvider';
import { getApiErrorMessage } from '../lib/ErrorMessage';
import { AdminRecipesPanel, type AdminRecipe } from '../components/AdminRecipesPanel';
import {
  BODY_PARTS,
  EQUIPMENT_TYPES,
  EXERCISE_DIFFICULTIES,
  EXERCISE_LABELS,
  formatDifficultyLabel,
  GOAL_TYPES,
  MOVEMENT_PATTERNS,
  TRAINING_LOCATIONS,
  isExerciseId,
  normalizeBodyPart,
  normalizeDifficulty,
  normalizeEquipment,
  normalizeExercise,
  normalizeExerciseInstructions,
  normalizeGoalType,
  normalizeMovementPattern,
  normalizeStringArray,
  normalizeTrainingLocation,
  type ExerciseInstructions,
} from '../lib/exerciseCatalog';

type AdminTab = 'overview' | 'users' | 'exercises' | 'foods' | 'recipes';

type OverviewStats = {
  users: number;
  premiumUsers: number;
  newUsers7d: number;
  telegramLinkedUsers: number;
  exercises: number;
  foods: number;
  aiAdjustments: {
    proposed: number;
    applied: number;
    rejected: number;
  };
  todayCompletedWorkouts: number;
  todayCompletedMeals: number;
};

type AdminUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  membership_tier: string | null;
  membership_expires_at?: string | null;
  telegram_chat_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ExerciseRow = {
  id: string;
  name: string;
  body_part?: string | null;
  equipment?: string | null;
  target_muscle?: string | null;
  video_url?: string | null;
  difficulty?: string | null;
  instructions?: unknown;
  secondary_muscles?: string[] | null;
  goal_type?: string[] | null;
  contraindications?: string[] | null;
  estimated_duration_seconds?: number | null;
  calories_per_minute?: number | null;
  movement_pattern?: string | null;
  training_locations?: string[] | null;
  min_experience_months?: number | null;
  progression_level?: number | null;
};

type FoodRow = {
  id: string;
  name: string;
  category?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  serving_unit?: string | null;
  image_url?: string | null;
  meal_type?: string[] | null;
  goal_type?: string[] | null;
  allergens?: string[] | null;
  dietary_tags?: string[] | null;
  ingredient_metadata?: string[] | null;
  animal_source?: string[] | null;
  is_active?: boolean | null;
  price_level?: string | null;
  cooking_time_minutes?: number | null;
  region?: string | null;
  is_easy_to_prepare?: boolean | null;
};

type ExerciseInstructionsForm = {
  setup: string;
  steps: string;
  breathing: string;
  coaching_cues: string;
  common_mistakes: string;
  easier_variation_id: string;
  harder_variation_id: string;
};

type ExerciseForm = {
  id: string;
  name: string;
  body_part: string;
  equipment: string;
  target_muscle: string;
  video_url: string;
  difficulty: string;
  instructions: ExerciseInstructionsForm;
  secondary_muscles: string[];
  goal_type: string[];
  training_locations: string[];
  min_experience_months: string;
  progression_level: string;
  contraindications: string;
  estimated_duration_seconds: string;
  calories_per_minute: string;
  movement_pattern: string;
};

type ExerciseFieldErrors = Record<string, string[]>;

type ExerciseOption = {
  value: string;
  label: string;
};

type FoodForm = {
  name: string;
  category: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  serving_unit: string;
  image_url: string;
  meal_type: string;
  goal_type: string;
  allergens: string;
  dietary_tags: string;
  ingredient_metadata: string;
  animal_source: string;
  is_active: boolean;
  price_level: string;
  cooking_time_minutes: string;
  region: string;
  is_easy_to_prepare: boolean;
};

const emptyExerciseForm: ExerciseForm = {
  id: '',
  name: '',
  body_part: '',
  equipment: '',
  target_muscle: '',
  video_url: '',
  difficulty: '',
  instructions: {
    setup: '',
    steps: '',
    breathing: '',
    coaching_cues: '',
    common_mistakes: '',
    easier_variation_id: '',
    harder_variation_id: ''
  },
  secondary_muscles: [],
  goal_type: [],
  training_locations: [],
  min_experience_months: '0',
  progression_level: '1',
  contraindications: '',
  estimated_duration_seconds: '',
  calories_per_minute: '',
  movement_pattern: ''
};

const emptyFoodForm: FoodForm = {
  name: '',
  category: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  serving_unit: '100g',
  image_url: '',
  meal_type: '',
  goal_type: '',
  allergens: '',
  dietary_tags: '',
  ingredient_metadata: '',
  animal_source: '',
  is_active: true,
  price_level: '',
  cooking_time_minutes: '',
  region: 'Vietnam',
  is_easy_to_prepare: true
};

const tabs: Array<{ id: AdminTab; label: string; icon: ElementType }> = [
  { id: 'overview', label: 'Tổng quan', icon: BarChart3 },
  { id: 'users', label: 'Người dùng', icon: Users },
  { id: 'exercises', label: 'Bài tập', icon: Dumbbell },
  { id: 'foods', label: 'Thực đơn', icon: Utensils }
  ,{ id: 'recipes', label: 'Recipes', icon: Utensils }
];
const ADMIN_TABLE_PAGE_SIZE = 8;

const goalLabels: Record<(typeof GOAL_TYPES)[number], string> = {
  general_fitness: 'Sức khỏe tổng quát',
  weight_loss: 'Giảm cân',
  muscle_gain: 'Tăng cơ',
  strength: 'Sức mạnh',
  endurance: 'Sức bền',
  mobility: 'Linh hoạt',
  recovery: 'Phục hồi'
};

const bodyPartOptions: ExerciseOption[] = BODY_PARTS.map((value) => ({
  value,
  label: EXERCISE_LABELS.bodyPart[value]
}));

const equipmentOptions: ExerciseOption[] = EQUIPMENT_TYPES.map((value) => ({
  value,
  label: EXERCISE_LABELS.equipment[value]
}));

const difficultyOptions: ExerciseOption[] = EXERCISE_DIFFICULTIES.map((value) => ({
  value,
  label: EXERCISE_LABELS.difficulty[value]
}));

const movementPatternOptions: ExerciseOption[] = MOVEMENT_PATTERNS.map((value) => ({
  value,
  label: EXERCISE_LABELS.movementPattern[value]
}));

const goalOptions: ExerciseOption[] = GOAL_TYPES.map((value) => ({
  value,
  label: goalLabels[value]
}));

const trainingLocationOptions: ExerciseOption[] = TRAINING_LOCATIONS.map((value) => ({
  value,
  label: EXERCISE_LABELS.trainingLocation[value]
}));

const formatDate = (value: string | null | undefined) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(value));
};

const formatList = (value: unknown) => {
  if (Array.isArray(value)) return value.join(', ');
  return String(value || '');
};

const uniqueValues = (values: string[]) => Array.from(new Set(values));

const parseDelimitedList = (value: string): string[] => uniqueValues(
  value
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
);

const toMultilineText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  return normalizeStringArray(value).join('\n');
};

const normalizeBodyPartValues = (value: unknown): string[] => {
  const normalized: string[] = [];
  normalizeStringArray(value).forEach((item) => {
    const bodyPart = normalizeBodyPart(item);
    if (bodyPart && !normalized.includes(bodyPart)) normalized.push(bodyPart);
  });
  return normalized;
};

const normalizeGoalValues = (value: unknown): string[] => {
  const normalized: string[] = [];
  normalizeStringArray(value).forEach((item) => {
    const goal = normalizeGoalType(item);
    if (goal && !normalized.includes(goal)) normalized.push(goal);
  });
  return normalized;
};

const normalizeLocationValues = (value: unknown): string[] => {
  const normalized: string[] = [];
  const values = Array.isArray(value) ? value : typeof value === 'string' ? parseDelimitedList(value) : [];
  values.forEach((item) => {
    const location = normalizeTrainingLocation(item);
    if (location && !normalized.includes(location)) normalized.push(location);
  });
  return normalized;
};

const toInstructionForm = (value: unknown): ExerciseInstructionsForm => {
  const instructions = normalizeExerciseInstructions(value);
  return {
    setup: toMultilineText(instructions.setup),
    steps: toMultilineText(instructions.steps),
    breathing: toMultilineText(instructions.breathing),
    coaching_cues: toMultilineText(instructions.coaching_cues),
    common_mistakes: toMultilineText(instructions.common_mistakes),
    easier_variation_id: instructions.easier_variation_id || '',
    harder_variation_id: instructions.harder_variation_id || ''
  };
};

const asOptionalNumberText = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

const toExerciseForm = (row?: ExerciseRow | null): ExerciseForm => {
  if (!row) {
    return {
      ...emptyExerciseForm,
      instructions: { ...emptyExerciseForm.instructions },
      secondary_muscles: [],
      goal_type: [],
      training_locations: []
    };
  }
  const normalized = normalizeExercise(row);
  return {
    id: row.id || '',
    name: row.name || '',
    body_part: normalizeBodyPart(row.body_part) || '',
    equipment: normalizeEquipment(row.equipment) || '',
    target_muscle: normalizeBodyPart(row.target_muscle) || '',
    video_url: row.video_url || '',
    difficulty: normalizeDifficulty(row.difficulty) || '',
    instructions: toInstructionForm(row.instructions),
    secondary_muscles: normalizeBodyPartValues(row.secondary_muscles),
    goal_type: normalizeGoalValues(row.goal_type),
    training_locations: normalizeLocationValues(row.training_locations).length > 0
      ? normalizeLocationValues(row.training_locations)
      : normalized.training_locations,
    min_experience_months: asOptionalNumberText(
      row.min_experience_months ?? normalized.min_experience_months
    ),
    progression_level: asOptionalNumberText(row.progression_level ?? normalized.progression_level),
    contraindications: toMultilineText(row.contraindications),
    estimated_duration_seconds: asOptionalNumberText(row.estimated_duration_seconds),
    calories_per_minute: asOptionalNumberText(row.calories_per_minute),
    movement_pattern: normalizeMovementPattern(row.movement_pattern) || ''
  };
};

const appendExerciseFormError = (errors: ExerciseFieldErrors, field: string, message: string) => {
  if (!errors[field]) errors[field] = [];
  errors[field].push(message);
};

const isOptionalHttpUrl = (value: string): boolean => {
  const url = value.trim();
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const validateExerciseForm = (form: ExerciseForm, isEditing: boolean): ExerciseFieldErrors => {
  const errors: ExerciseFieldErrors = {};
  const id = form.id.trim();
  const targetMuscle = normalizeBodyPart(form.target_muscle);

  if (!isEditing) {
    if (!id) appendExerciseFormError(errors, 'id', 'Nhập ID bài tập.');
    else if (!isExerciseId(id)) appendExerciseFormError(errors, 'id', 'ID dùng lowercase kebab-case, ví dụ: dumbbell-goblet-squat.');
  }
  if (!form.name.trim()) appendExerciseFormError(errors, 'name', 'Nhập tên bài tập.');

  const requiredTaxonomies: Array<[keyof Pick<ExerciseForm, 'body_part' | 'target_muscle' | 'equipment' | 'difficulty' | 'movement_pattern'>, (value: unknown) => string | null]> = [
    ['body_part', normalizeBodyPart],
    ['target_muscle', normalizeBodyPart],
    ['equipment', normalizeEquipment],
    ['difficulty', normalizeDifficulty],
    ['movement_pattern', normalizeMovementPattern]
  ];
  requiredTaxonomies.forEach(([field, normalize]) => {
    if (!normalize(form[field])) appendExerciseFormError(errors, field, 'Chọn một giá trị trong taxonomy chuẩn.');
  });

  const locations = normalizeLocationValues(form.training_locations);
  if (locations.length === 0) appendExerciseFormError(errors, 'training_locations', 'Chọn ít nhất một nơi tập.');

  const experienceMonths = Number(form.min_experience_months);
  if (!form.min_experience_months.trim() || !Number.isInteger(experienceMonths) || experienceMonths < 0 || experienceMonths > 120) {
    appendExerciseFormError(errors, 'min_experience_months', 'Nhập số tháng nguyên từ 0 đến 120.');
  }
  const progressionLevel = Number(form.progression_level);
  if (!form.progression_level.trim() || !Number.isInteger(progressionLevel) || progressionLevel < 1 || progressionLevel > 5) {
    appendExerciseFormError(errors, 'progression_level', 'Chọn cấp độ tiến triển từ 1 đến 5.');
  }

  if (form.secondary_muscles.some((item) => !normalizeBodyPart(item))) {
    appendExerciseFormError(errors, 'secondary_muscles', 'Cơ phụ phải dùng taxonomy chuẩn.');
  }
  if (targetMuscle && normalizeBodyPartValues(form.secondary_muscles).includes(targetMuscle)) {
    appendExerciseFormError(errors, 'secondary_muscles', 'Cơ phụ không được trùng cơ chính.');
  }
  if (form.goal_type.some((item) => !normalizeGoalType(item))) {
    appendExerciseFormError(errors, 'goal_type', 'Mục tiêu phải dùng taxonomy chuẩn.');
  }

  if (!isOptionalHttpUrl(form.video_url)) appendExerciseFormError(errors, 'video_url', 'Dùng URL video http(s) hợp lệ hoặc để trống.');

  if (form.estimated_duration_seconds.trim()) {
    const duration = Number(form.estimated_duration_seconds);
    if (!Number.isInteger(duration) || duration <= 0) {
      appendExerciseFormError(errors, 'estimated_duration_seconds', 'Nhập số giây nguyên dương hoặc để trống.');
    }
  }
  if (form.calories_per_minute.trim()) {
    const calories = Number(form.calories_per_minute);
    if (!Number.isFinite(calories) || calories < 0) {
      appendExerciseFormError(errors, 'calories_per_minute', 'Nhập kcal/phút không âm hoặc để trống.');
    }
  }

  (['easier_variation_id', 'harder_variation_id'] as const).forEach((field) => {
    const variationId = form.instructions[field].trim();
    if (!variationId) return;
    const errorField = `instructions.${field}`;
    if (!isExerciseId(variationId)) {
      appendExerciseFormError(errors, errorField, 'ID biến thể dùng lowercase kebab-case.');
    } else if (variationId === id) {
      appendExerciseFormError(errors, errorField, 'Không thể tham chiếu chính bài tập này.');
    }
  });

  return errors;
};

const toExercisePayload = (form: ExerciseForm, isEditing: boolean): Record<string, unknown> => {
  const instructions: ExerciseInstructions = {
    setup: parseDelimitedList(form.instructions.setup),
    steps: parseDelimitedList(form.instructions.steps),
    breathing: parseDelimitedList(form.instructions.breathing),
    coaching_cues: parseDelimitedList(form.instructions.coaching_cues),
    common_mistakes: parseDelimitedList(form.instructions.common_mistakes)
  };
  const easierVariationId = form.instructions.easier_variation_id.trim();
  const harderVariationId = form.instructions.harder_variation_id.trim();
  if (easierVariationId) instructions.easier_variation_id = easierVariationId;
  if (harderVariationId) instructions.harder_variation_id = harderVariationId;

  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    body_part: normalizeBodyPart(form.body_part),
    target_muscle: normalizeBodyPart(form.target_muscle),
    secondary_muscles: normalizeBodyPartValues(form.secondary_muscles),
    equipment: normalizeEquipment(form.equipment),
    training_locations: normalizeLocationValues(form.training_locations),
    difficulty: normalizeDifficulty(form.difficulty),
    min_experience_months: Number(form.min_experience_months),
    progression_level: Number(form.progression_level),
    movement_pattern: normalizeMovementPattern(form.movement_pattern),
    goal_type: normalizeGoalValues(form.goal_type),
    contraindications: parseDelimitedList(form.contraindications),
    estimated_duration_seconds: form.estimated_duration_seconds.trim() ? Number(form.estimated_duration_seconds) : null,
    calories_per_minute: form.calories_per_minute.trim() ? Number(form.calories_per_minute) : null,
    video_url: form.video_url.trim() || null,
    instructions
  };
  if (!isEditing) payload.id = form.id.trim();
  return payload;
};

const extractExerciseFieldErrors = (value: unknown): ExerciseFieldErrors => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const fields: ExerciseFieldErrors = {};
  Object.entries(value as Record<string, unknown>).forEach(([field, messages]) => {
    const normalizedMessages = Array.isArray(messages)
      ? messages.filter((message): message is string => typeof message === 'string' && Boolean(message.trim()))
      : typeof messages === 'string' && messages.trim() ? [messages.trim()] : [];
    if (normalizedMessages.length > 0) fields[field] = normalizedMessages;
  });
  return fields;
};

class AdminRequestError extends Error {
  readonly fields: ExerciseFieldErrors;

  constructor(message: string, fields: ExerciseFieldErrors = {}) {
    super(message);
    this.name = 'AdminRequestError';
    this.fields = fields;
  }
}

const toFoodForm = (row?: FoodRow | null): FoodForm => {
  if (!row) return emptyFoodForm;
  return {
    name: row.name || '',
    category: row.category || '',
    calories: row.calories !== null && row.calories !== undefined ? String(row.calories) : '',
    protein: row.protein !== null && row.protein !== undefined ? String(row.protein) : '',
    carbs: row.carbs !== null && row.carbs !== undefined ? String(row.carbs) : '',
    fat: row.fat !== null && row.fat !== undefined ? String(row.fat) : '',
    serving_unit: row.serving_unit || '100g',
    image_url: row.image_url || '',
    meal_type: formatList(row.meal_type),
    goal_type: formatList(row.goal_type),
    allergens: formatList(row.allergens),
    dietary_tags: formatList(row.dietary_tags),
    ingredient_metadata: formatList(row.ingredient_metadata),
    animal_source: formatList(row.animal_source),
    price_level: row.price_level || '',
    cooking_time_minutes: row.cooking_time_minutes ? String(row.cooking_time_minutes) : '',
    region: row.region || 'Vietnam',
    is_easy_to_prepare: row.is_easy_to_prepare !== false,
    is_active: row.is_active !== false
  };
};

export default function AdminPanel() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [foods, setFoods] = useState<FoodRow[]>([]);
  const [recipes, setRecipes] = useState<AdminRecipe[]>([]);
  const [exercisePage, setExercisePage] = useState(1);
  const [foodPage, setFoodPage] = useState(1);
  const [editingExercise, setEditingExercise] = useState<ExerciseRow | null>(null);
  const [isExerciseFormOpen, setIsExerciseFormOpen] = useState(false);
  const [exerciseForm, setExerciseForm] = useState<ExerciseForm>(emptyExerciseForm);
  const [exerciseFieldErrors, setExerciseFieldErrors] = useState<ExerciseFieldErrors>({});
  const [editingFood, setEditingFood] = useState<FoodRow | null>(null);
  const [isFoodFormOpen, setIsFoodFormOpen] = useState(false);
  const [foodForm, setFoodForm] = useState<FoodForm>(emptyFoodForm);

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    params.set('limit', '160');
    return `?${params.toString()}`;
  }, [search]);

  const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchWithAuth(path, init);
    const responseText = await response.text();
    let payload: any = {};
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const fallbackByStatus: Record<number, string> = {
        401: 'Phiên đăng nhập đã hết hạn hoặc thiếu token.',
        403: 'Tài khoản hiện tại chưa có quyền quản trị.',
        404: 'Backend hiện tại chưa có API quản trị. Hãy kiểm tra deploy Render.',
        500: 'Backend gặp lỗi khi tải dữ liệu quản trị.',
        503: 'Backend Render đang không sẵn sàng hoặc service đang lỗi.'
      };
      const message = getApiErrorMessage({
        status: response.status,
        payload,
        responseText,
        fallbackMessage: 'Không thể tải dữ liệu quản trị',
        fallbackByStatus
      });
      throw new AdminRequestError(message, extractExerciseFieldErrors(payload?.fields));
    }
    return payload.data ?? payload;
  };

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'overview') {
        setOverview(await requestJson<OverviewStats>('/api/admin/overview'));
      }
      if (activeTab === 'users') {
        setUsers(await requestJson<AdminUser[]>(`/api/admin/users${querySuffix}`));
      }
      if (activeTab === 'exercises') {
        setExercises(await requestJson<ExerciseRow[]>(`/api/admin/exercises${querySuffix}`));
        setExercisePage(1);
      }
      if (activeTab === 'foods') {
        setFoods(await requestJson<FoodRow[]>(`/api/admin/foods${querySuffix}`));
        setFoodPage(1);
      }
      if (activeTab === 'recipes') {
        const [recipeRows, foodRows] = await Promise.all([
          requestJson<AdminRecipe[]>(`/api/admin/recipes${querySuffix}`),
          requestJson<FoodRow[]>('/api/admin/foods?limit=300'),
        ]);
        setRecipes(recipeRows);
        setFoods(foodRows);
      }
    } catch (err: any) {
      setError(err?.message || 'Không thể tải dữ liệu quản trị');
    } finally {
      setLoading(false);
    }
  }, [activeTab, isAdmin, querySuffix]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  const openNewExerciseForm = () => {
    setEditingExercise(null);
    setExerciseForm(toExerciseForm());
    setExerciseFieldErrors({});
    setIsExerciseFormOpen(true);
  };

  const openEditExerciseForm = (row: ExerciseRow) => {
    setEditingExercise(row);
    setExerciseForm(toExerciseForm(row));
    setExerciseFieldErrors({});
    setIsExerciseFormOpen(true);
  };

  const submitExercise = async (event: FormEvent) => {
    event.preventDefault();
    const validationErrors = validateExerciseForm(exerciseForm, Boolean(editingExercise));
    if (Object.keys(validationErrors).length > 0) {
      setExerciseFieldErrors(validationErrors);
      return;
    }
    setSaving(true);
    setError('');
    setExerciseFieldErrors({});
    try {
      const path = editingExercise ? `/api/admin/exercises/${editingExercise.id}` : '/api/admin/exercises';
      const method = editingExercise ? 'PUT' : 'POST';
      await requestJson<ExerciseRow>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toExercisePayload(exerciseForm, Boolean(editingExercise)))
      });
      setIsExerciseFormOpen(false);
      await loadData();
    } catch (err: any) {
      if (err instanceof AdminRequestError && Object.keys(err.fields).length > 0) {
        setExerciseFieldErrors(err.fields);
      } else {
        setError(err?.message || 'Không thể lưu bài tập');
      }
    } finally {
      setSaving(false);
    }
  };

  const updateExerciseForm = (patch: Partial<ExerciseForm>) => {
    setExerciseForm((previous) => ({ ...previous, ...patch }));
    setExerciseFieldErrors({});
  };

  const deleteExercise = async (row: ExerciseRow) => {
    if (!confirm(`Xóa bài tập "${row.name}"?`)) return;
    setSaving(true);
    setError('');
    try {
      await requestJson(`/api/admin/exercises/${row.id}`, { method: 'DELETE' });
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Không thể xóa bài tập');
    } finally {
      setSaving(false);
    }
  };

  const openNewFoodForm = () => {
    setEditingFood(null);
    setFoodForm(emptyFoodForm);
    setIsFoodFormOpen(true);
  };

  const openEditFoodForm = (row: FoodRow) => {
    setEditingFood(row);
    setFoodForm(toFoodForm(row));
    setIsFoodFormOpen(true);
  };

  const submitFood = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const path = editingFood ? `/api/admin/foods/${editingFood.id}` : '/api/admin/foods';
      const method = editingFood ? 'PUT' : 'POST';
      await requestJson<FoodRow>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(foodForm)
      });
      setIsFoodFormOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu món ăn');
    } finally {
      setSaving(false);
    }
  };

  const deleteFood = async (row: FoodRow) => {
    if (!confirm(`Xóa món ăn "${row.name}"?`)) return;
    setSaving(true);
    setError('');
    try {
      await requestJson(`/api/admin/foods/${row.id}`, { method: 'DELETE' });
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Không thể xóa món ăn');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="dashboard-page-shell flex min-h-[50vh] items-center justify-center">
        <div className="rounded-xl border border-border-primary bg-bg-secondary p-6 text-center">
          <Shield className="mx-auto h-8 w-8 text-danger" />
          <h2 className="mt-3 text-lg font-bold text-text-primary">Không có quyền truy cập</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-black text-text-primary">Quản trị viên</h1>
          <p className="mt-1 text-sm font-semibold text-text-secondary">Người dùng, bài tập, thực đơn và vận hành hệ thống.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-black text-text-primary transition-colors hover:border-accent/40 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Làm mới
        </button>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border-primary bg-bg-secondary/80 p-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setSearch('');
                setExercisePage(1);
                setFoodPage(1);
                setError('');
              }}
              className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-black transition-colors ${
                isActive
                  ? 'bg-accent text-text-inverse'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab !== 'overview' && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-primary bg-bg-secondary/80 p-3 md:flex-row md:items-center md:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setExercisePage(1);
                setFoodPage(1);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void loadData();
              }}
              placeholder="Tìm kiếm..."
              className="h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary pl-10 pr-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
            />
          </div>
          <div className="flex gap-2">
            {activeTab === 'exercises' && (
              <button type="button" onClick={openNewExerciseForm} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover">
                <Plus className="h-4 w-4" />
                Thêm
              </button>
            )}
            {activeTab === 'foods' && (
              <button type="button" onClick={openNewFoodForm} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover">
                <Plus className="h-4 w-4" />
                Thêm
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <AdminTabSkeleton activeTab={activeTab} />
      ) : (
        <>
          {activeTab === 'overview' && <OverviewTab overview={overview} />}
          {activeTab === 'users' && <UsersTab users={users} />}
          {activeTab === 'exercises' && (
            <ExercisesTab
              rows={exercises}
              page={exercisePage}
              onPageChange={setExercisePage}
              onEdit={openEditExerciseForm}
              onDelete={deleteExercise}
              saving={saving}
            />
          )}
          {activeTab === 'foods' && (
            <FoodsTab
              rows={foods}
              page={foodPage}
              onPageChange={setFoodPage}
              onEdit={openEditFoodForm}
              onDelete={deleteFood}
              saving={saving}
            />
          )}
          {activeTab === 'recipes' && <AdminRecipesPanel rows={recipes} foods={foods} onChanged={loadData} />}
        </>
      )}

      {isExerciseFormOpen && (
        <ExerciseFormPanel
          form={exerciseForm}
          isEditing={!!editingExercise}
          saving={saving}
          fieldErrors={exerciseFieldErrors}
          onClose={() => {
            setIsExerciseFormOpen(false);
            setExerciseFieldErrors({});
          }}
          onSubmit={submitExercise}
          onChange={updateExerciseForm}
        />
      )}

      {isFoodFormOpen && (
        <FoodFormPanel
          form={foodForm}
          isEditing={!!editingFood}
          saving={saving}
          onClose={() => setIsFoodFormOpen(false)}
          onSubmit={submitFood}
          onChange={(patch) => setFoodForm((prev) => ({ ...prev, ...patch }))}
        />
      )}
    </div>
  );
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <span className={`block rounded-full bg-bg-tertiary ${className}`} />;
}

function AdminOverviewSkeleton() {
  return (
    <div className="grid animate-pulse gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <article key={index} className="rounded-xl border border-border-primary bg-bg-secondary/80 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <SkeletonLine className="h-3 w-24" />
              <SkeletonLine className="mt-4 h-7 w-20" />
            </div>
            <span className="h-11 w-11 rounded-xl bg-bg-tertiary" />
          </div>
        </article>
      ))}
      <article className="rounded-xl border border-border-primary bg-bg-secondary/80 p-5 md:col-span-2 xl:col-span-3">
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 rounded-xl bg-bg-tertiary" />
          <div className="min-w-0 flex-1">
            <SkeletonLine className="h-4 w-44" />
            <SkeletonLine className="mt-2 h-3 w-full max-w-md" />
          </div>
        </div>
      </article>
    </div>
  );
}

function AdminTableSkeleton({
  minWidth,
  columns,
  rows = ADMIN_TABLE_PAGE_SIZE,
  hasActions = false,
}: {
  minWidth: string;
  columns: Array<{ label: string; width: string; secondary?: boolean }>;
  rows?: number;
  hasActions?: boolean;
}) {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl border border-border-primary bg-bg-secondary/80">
      <div className="overflow-x-auto">
        <table className={`w-full ${minWidth} text-left text-sm`}>
          <thead className="border-b border-border-primary bg-bg-tertiary/55 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              {columns.map((column) => (
                <th key={column.label} className={`px-4 py-3 ${column.label === 'Thao tác' ? 'text-right' : ''}`}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary/70">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column, columnIndex) => (
                  <td key={column.label} className="px-4 py-3">
                    {hasActions && columnIndex === columns.length - 1 ? (
                      <div className="flex justify-end gap-2">
                        <span className="h-9 w-9 rounded-lg bg-bg-tertiary" />
                        <span className="h-9 w-9 rounded-lg bg-bg-tertiary" />
                      </div>
                    ) : column.secondary ? (
                      <div>
                        <SkeletonLine className={`h-4 ${column.width}`} />
                        <SkeletonLine className="mt-2 h-3 w-36" />
                      </div>
                    ) : (
                      <SkeletonLine className={`h-4 ${column.width}`} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasActions && (
        <div className="flex flex-col gap-3 border-t border-border-primary px-4 py-3 md:flex-row md:items-center md:justify-between">
          <SkeletonLine className="h-4 w-32" />
          <div className="flex items-center gap-2">
            <span className="h-9 w-16 rounded-lg bg-bg-tertiary" />
            <span className="h-4 w-24 rounded-full bg-bg-tertiary" />
            <span className="h-9 w-12 rounded-lg bg-bg-tertiary" />
          </div>
        </div>
      )}
    </div>
  );
}

function AdminTabSkeleton({ activeTab }: { activeTab: AdminTab }) {
  if (activeTab === 'overview') return <AdminOverviewSkeleton />;

  if (activeTab === 'users') {
    return (
      <AdminTableSkeleton
        minWidth="min-w-[760px]"
        columns={[
          { label: 'Người dùng', width: 'w-44', secondary: true },
          { label: 'Gói', width: 'w-16' },
          { label: 'Role', width: 'w-14' },
          { label: 'Telegram', width: 'w-24' },
          { label: 'Ngày tạo', width: 'w-20' },
        ]}
      />
    );
  }

  if (activeTab === 'exercises') {
    return (
      <AdminTableSkeleton
        minWidth="min-w-[860px]"
        hasActions
        columns={[
          { label: 'Bài tập', width: 'w-52', secondary: true },
          { label: 'Nhóm cơ', width: 'w-28' },
          { label: 'Thiết bị', width: 'w-24' },
          { label: 'Độ khó', width: 'w-20' },
          { label: 'Thao tác', width: 'w-20' },
        ]}
      />
    );
  }

  return (
    <AdminTableSkeleton
      minWidth="min-w-[900px]"
      hasActions
      columns={[
        { label: 'Món ăn', width: 'w-48', secondary: true },
        { label: 'Kcal', width: 'w-12' },
        { label: 'Protein', width: 'w-14' },
        { label: 'Carbs', width: 'w-14' },
        { label: 'Fat', width: 'w-12' },
        { label: 'Thao tác', width: 'w-20' },
      ]}
    />
  );
}

function OverviewTab({ overview }: { overview: OverviewStats | null }) {
  const stats = [
    { label: 'Người dùng', value: overview?.users || 0, icon: Users, tone: 'text-info' },
    { label: 'Plus / Pro', value: overview?.premiumUsers || 0, icon: Crown, tone: 'text-warning' },
    { label: 'User mới 7 ngày', value: overview?.newUsers7d || 0, icon: Activity, tone: 'text-accent' },
    { label: 'Telegram', value: overview?.telegramLinkedUsers || 0, icon: Send, tone: 'text-info' },
    { label: 'Bài tập', value: overview?.exercises || 0, icon: Dumbbell, tone: 'text-accent' },
    { label: 'Thực đơn', value: overview?.foods || 0, icon: Utensils, tone: 'text-warning' }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {stats.map((item) => {
        const Icon = item.icon;
        return (
          <article key={item.label} className="rounded-xl border border-border-primary bg-bg-secondary/80 p-5 shadow-[0_18px_48px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">{item.label}</p>
                <p className="mt-3 text-2xl font-black text-text-primary">{item.value.toLocaleString('vi-VN')}</p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-bg-tertiary">
                <Icon className={`h-5 w-5 ${item.tone}`} />
              </span>
            </div>
          </article>
        );
      })}

      <article className="rounded-xl border border-border-primary bg-bg-secondary/80 p-5 md:col-span-2 xl:col-span-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ai/10">
            <Brain className="h-5 w-5 text-ai" />
          </span>
          <div>
            <p className="text-sm font-black text-text-primary">AI Coach adjustments</p>
            <p className="text-xs font-semibold text-text-tertiary">
              Đề xuất: {overview?.aiAdjustments.proposed || 0} · Đã áp dụng: {overview?.aiAdjustments.applied || 0} · Từ chối: {overview?.aiAdjustments.rejected || 0}
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}

function UsersTab({ users }: { users: AdminUser[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-primary bg-bg-secondary/80">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-border-primary bg-bg-tertiary/55 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-4 py-3">Người dùng</th>
              <th className="px-4 py-3">Gói</th>
              <th className="px-4 py-3">Hạn gói</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Telegram</th>
              <th className="px-4 py-3">Ngày tạo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary/70">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-bg-tertiary/35">
                <td className="px-4 py-3">
                  <p className="font-black text-text-primary">{user.full_name || user.email || 'Chưa có tên'}</p>
                  <p className="text-xs text-text-tertiary">{user.email || user.id}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${['plus', 'pro', 'premium'].includes(String(user.membership_tier || '')) ? 'bg-warning/10 text-warning' : 'bg-bg-tertiary text-text-secondary'}`}>
                    {user.membership_tier || 'free'}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-secondary">{formatDate(user.membership_expires_at)}</td>
                <td className="px-4 py-3 text-text-secondary">{user.role || 'user'}</td>
                <td className="px-4 py-3 text-text-secondary">{user.telegram_chat_id ? 'Đã kết nối' : 'Chưa kết nối'}</td>
                <td className="px-4 py-3 text-text-secondary">{formatDate(user.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExercisesTab({
  rows,
  page,
  onPageChange,
  onEdit,
  onDelete,
  saving
}: {
  rows: ExerciseRow[];
  page: number;
  onPageChange: (page: number) => void;
  onEdit: (row: ExerciseRow) => void;
  onDelete: (row: ExerciseRow) => void;
  saving: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(rows.length / ADMIN_TABLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visibleRows = rows.slice((safePage - 1) * ADMIN_TABLE_PAGE_SIZE, safePage * ADMIN_TABLE_PAGE_SIZE);

  return (
    <div className="overflow-hidden rounded-xl border border-border-primary bg-bg-secondary/80">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-border-primary bg-bg-tertiary/55 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-4 py-3">Bài tập</th>
              <th className="px-4 py-3">Nhóm cơ</th>
              <th className="px-4 py-3">Thiết bị</th>
              <th className="px-4 py-3">Độ khó</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary/70">
            {visibleRows.map((row) => (
              <tr key={row.id} className="hover:bg-bg-tertiary/35">
                <td className="px-4 py-3">
                  <p className="font-black text-text-primary">{row.name}</p>
                  <p className="text-xs text-text-tertiary">{row.id}</p>
                </td>
                <td className="px-4 py-3 text-text-secondary">{row.target_muscle || row.body_part || '-'}</td>
                <td className="px-4 py-3 text-text-secondary">{row.equipment || '-'}</td>
                <td className="px-4 py-3 text-text-secondary">{formatDifficultyLabel(row.difficulty) || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => onEdit(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary text-text-secondary hover:text-accent">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={saving} onClick={() => onDelete(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-danger/20 bg-danger/10 text-danger hover:bg-danger/15 disabled:opacity-60">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationFooter
        page={safePage}
        totalPages={totalPages}
        totalItems={rows.length}
        pageSize={ADMIN_TABLE_PAGE_SIZE}
        onPageChange={onPageChange}
      />
    </div>
  );
}

function FoodsTab({
  rows,
  page,
  onPageChange,
  onEdit,
  onDelete,
  saving
}: {
  rows: FoodRow[];
  page: number;
  onPageChange: (page: number) => void;
  onEdit: (row: FoodRow) => void;
  onDelete: (row: FoodRow) => void;
  saving: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(rows.length / ADMIN_TABLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visibleRows = rows.slice((safePage - 1) * ADMIN_TABLE_PAGE_SIZE, safePage * ADMIN_TABLE_PAGE_SIZE);

  return (
    <div className="overflow-hidden rounded-xl border border-border-primary bg-bg-secondary/80">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border-primary bg-bg-tertiary/55 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-4 py-3">Món ăn</th>
              <th className="px-4 py-3">Kcal</th>
              <th className="px-4 py-3">Protein</th>
              <th className="px-4 py-3">Carbs</th>
              <th className="px-4 py-3">Fat</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary/70">
            {visibleRows.map((row) => (
              <tr key={row.id} className="hover:bg-bg-tertiary/35">
                <td className="px-4 py-3">
                  <p className="font-black text-text-primary">{row.name}</p>
                  <p className="text-xs text-text-tertiary">{row.category || row.serving_unit || row.id}</p>
                </td>
                <td className="px-4 py-3 text-text-secondary">{row.calories || 0}</td>
                <td className="px-4 py-3 text-text-secondary">{row.protein || 0}g</td>
                <td className="px-4 py-3 text-text-secondary">{row.carbs || 0}g</td>
                <td className="px-4 py-3 text-text-secondary">{row.fat || 0}g</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => onEdit(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary text-text-secondary hover:text-accent">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={saving} onClick={() => onDelete(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-danger/20 bg-danger/10 text-danger hover:bg-danger/15 disabled:opacity-60">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationFooter
        page={safePage}
        totalPages={totalPages}
        totalItems={rows.length}
        pageSize={ADMIN_TABLE_PAGE_SIZE}
        onPageChange={onPageChange}
      />
    </div>
  );
}

function PaginationFooter({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex flex-col gap-3 border-t border-border-primary px-4 py-3 text-sm text-text-secondary md:flex-row md:items-center md:justify-between">
      <span className="font-semibold">
        Hiển thị {startItem}-{endItem} / {totalItems}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary px-3 text-sm font-black text-text-primary transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Trước
        </button>
        <span className="min-w-24 text-center text-sm font-black text-text-primary">
          Trang {page}/{totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary px-3 text-sm font-black text-text-primary transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Sau
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
  error,
  hint,
  required = false,
  placeholder,
  min,
  max,
  step,
  pattern
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  pattern?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
        {label}{required ? <span className="ml-1 text-danger">*</span> : null}
      </span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        pattern={pattern}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 h-11 w-full rounded-xl border bg-bg-tertiary px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent disabled:opacity-60 ${error ? 'border-danger focus:border-danger' : 'border-border-primary'}`}
      />
      {hint ? <span className="mt-1 block text-xs font-medium text-text-tertiary">{hint}</span> : null}
      {error ? <span role="alert" className="mt-1 block text-xs font-semibold text-danger">{error}</span> : null}
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 3,
  error,
  hint,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 w-full resize-y rounded-xl border bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent ${error ? 'border-danger focus:border-danger' : 'border-border-primary'}`}
      />
      {hint ? <span className="mt-1 block text-xs font-medium text-text-tertiary">{hint}</span> : null}
      {error ? <span role="alert" className="mt-1 block text-xs font-semibold text-danger">{error}</span> : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  error,
  required = false,
  placeholder = 'Chọn giá trị'
}: {
  label: string;
  value: string;
  options: ExerciseOption[];
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
        {label}{required ? <span className="ml-1 text-danger">*</span> : null}
      </span>
      <select
        value={value}
        required={required}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 h-11 w-full rounded-xl border bg-bg-tertiary px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent ${error ? 'border-danger focus:border-danger' : 'border-border-primary'}`}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {error ? <span role="alert" className="mt-1 block text-xs font-semibold text-danger">{error}</span> : null}
    </label>
  );
}

function MultiSelectField({
  label,
  options,
  values,
  onChange,
  error,
  hint,
  disabledValues = []
}: {
  label: string;
  options: ExerciseOption[];
  values: string[];
  onChange: (values: string[]) => void;
  error?: string;
  hint?: string;
  disabledValues?: string[];
}) {
  const toggleValue = (value: string) => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  return (
    <fieldset className={`min-w-0 rounded-xl border bg-bg-tertiary p-3 ${error ? 'border-danger' : 'border-border-primary'}`}>
      <legend className="px-1 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((option) => {
          const disabled = disabledValues.includes(option.value);
          const checked = values.includes(option.value);
          return (
            <label
              key={option.value}
              className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${checked ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border-primary text-text-secondary'} ${disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:border-accent/40'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggleValue(option.value)}
                className="h-3.5 w-3.5 accent-accent"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {hint ? <p className="mt-2 text-xs font-medium text-text-tertiary">{hint}</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs font-semibold text-danger">{error}</p> : null}
    </fieldset>
  );
}

const fieldError = (errors: ExerciseFieldErrors, field: string): string | undefined =>
  errors[field]?.join(' ');

function InstructionPreview({ instructions }: { instructions: ExerciseInstructionsForm }) {
  const sections = [
    { label: 'Chuẩn bị', values: parseDelimitedList(instructions.setup) },
    { label: 'Các bước', values: parseDelimitedList(instructions.steps) },
    { label: 'Hít thở', values: parseDelimitedList(instructions.breathing) },
    { label: 'Lưu ý kỹ thuật', values: parseDelimitedList(instructions.coaching_cues) },
    { label: 'Lỗi thường gặp', values: parseDelimitedList(instructions.common_mistakes) }
  ].filter((section) => section.values.length > 0);
  const easierVariationId = instructions.easier_variation_id.trim();
  const harderVariationId = instructions.harder_variation_id.trim();

  return (
    <section className="rounded-xl border border-border-primary bg-bg-primary/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-text-primary">Xem trước hướng dẫn</h3>
          <p className="mt-1 text-xs font-medium text-text-tertiary">Nội dung trùng sẽ được gộp trước khi lưu.</p>
        </div>
      </div>
      {sections.length === 0 && !easierVariationId && !harderVariationId ? (
        <p className="mt-3 text-sm text-text-tertiary">Chưa có nội dung hướng dẫn.</p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {sections.map((section) => (
            <div key={section.label} className="rounded-lg bg-bg-tertiary/70 p-3">
              <p className="text-xs font-black uppercase tracking-[0.1em] text-text-tertiary">{section.label}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-text-secondary">
                {section.values.map((value) => <li key={value}>{value}</li>)}
              </ol>
            </div>
          ))}
          {(easierVariationId || harderVariationId) ? (
            <div className="rounded-lg bg-bg-tertiary/70 p-3">
              <p className="text-xs font-black uppercase tracking-[0.1em] text-text-tertiary">Biến thể</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-text-secondary">
                {easierVariationId ? <span className="rounded-full bg-info/10 px-2 py-1 text-info">Dễ hơn: {easierVariationId}</span> : null}
                {harderVariationId ? <span className="rounded-full bg-warning/10 px-2 py-1 text-warning">Khó hơn: {harderVariationId}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ExerciseFormPanel({
  form,
  isEditing,
  saving,
  fieldErrors,
  onClose,
  onSubmit,
  onChange
}: {
  form: ExerciseForm;
  isEditing: boolean;
  saving: boolean;
  fieldErrors: ExerciseFieldErrors;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (patch: Partial<ExerciseForm>) => void;
}) {
  const updateInstructions = (field: keyof ExerciseInstructionsForm, value: string) => {
    onChange({ instructions: { ...form.instructions, [field]: value } });
  };

  return (
    <div className="admin-drawer-backdrop fixed inset-0 z-[70] flex justify-end bg-black/50 backdrop-blur-sm">
      <form noValidate onSubmit={onSubmit} className="admin-drawer-panel flex h-full w-full max-w-4xl flex-col border-l border-border-primary bg-bg-secondary shadow-2xl">
        <PanelHeader title={isEditing ? 'Sửa bài tập' : 'Thêm bài tập'} saving={saving} onClose={onClose} />
        <div className="custom-scrollbar grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2 md:p-5">
          {fieldError(fieldErrors, 'payload') ? (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger md:col-span-2">
              {fieldError(fieldErrors, 'payload')}
            </p>
          ) : null}
          <Field
            label="ID"
            value={form.id}
            disabled={isEditing}
            required={!isEditing}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="dumbbell-goblet-squat"
            hint={isEditing ? 'ID không thể đổi sau khi tạo.' : 'Dùng lowercase kebab-case.'}
            error={fieldError(fieldErrors, 'id')}
            onChange={(value) => onChange({ id: value })}
          />
          <Field
            label="Tên bài tập"
            value={form.name}
            required
            error={fieldError(fieldErrors, 'name')}
            onChange={(value) => onChange({ name: value })}
          />
          <SelectField
            label="Nhóm cơ"
            value={form.body_part}
            options={bodyPartOptions}
            required
            error={fieldError(fieldErrors, 'body_part')}
            onChange={(value) => onChange({ body_part: value })}
          />
          <SelectField
            label="Cơ chính"
            value={form.target_muscle}
            options={bodyPartOptions}
            required
            error={fieldError(fieldErrors, 'target_muscle')}
            onChange={(value) => onChange({
              target_muscle: value,
              secondary_muscles: form.secondary_muscles.filter((muscle) => muscle !== value)
            })}
          />
          <SelectField
            label="Thiết bị"
            value={form.equipment}
            options={equipmentOptions}
            required
            error={fieldError(fieldErrors, 'equipment')}
            onChange={(value) => onChange({ equipment: value })}
          />
          <SelectField
            label="Độ khó"
            value={form.difficulty}
            options={difficultyOptions}
            required
            error={fieldError(fieldErrors, 'difficulty')}
            onChange={(value) => onChange({ difficulty: value })}
          />
          <SelectField
            label="Movement pattern"
            value={form.movement_pattern}
            options={movementPatternOptions}
            required
            error={fieldError(fieldErrors, 'movement_pattern')}
            onChange={(value) => onChange({ movement_pattern: value })}
          />
          <Field
            label="Kinh nghiệm tối thiểu (tháng)"
            type="number"
            min={0}
            max={120}
            step={1}
            value={form.min_experience_months}
            required
            error={fieldError(fieldErrors, 'min_experience_months')}
            onChange={(value) => onChange({ min_experience_months: value })}
          />
          <Field
            label="Cấp độ tiến triển (1–5)"
            type="number"
            min={1}
            max={5}
            step={1}
            value={form.progression_level}
            required
            error={fieldError(fieldErrors, 'progression_level')}
            onChange={(value) => onChange({ progression_level: value })}
          />
          <MultiSelectField
            label="Nơi tập"
            options={trainingLocationOptions}
            values={form.training_locations}
            error={fieldError(fieldErrors, 'training_locations')}
            hint="Chọn ít nhất một nơi bài tập có thể thực hiện."
            onChange={(values) => onChange({ training_locations: values })}
          />
          <MultiSelectField
            label="Mục tiêu"
            options={goalOptions}
            values={form.goal_type}
            error={fieldError(fieldErrors, 'goal_type')}
            hint="Có thể chọn nhiều mục tiêu."
            onChange={(values) => onChange({ goal_type: values })}
          />
          <div className="md:col-span-2">
            <MultiSelectField
              label="Cơ phụ"
              options={bodyPartOptions}
              values={form.secondary_muscles}
              disabledValues={form.target_muscle ? [form.target_muscle] : []}
              error={fieldError(fieldErrors, 'secondary_muscles')}
              hint="Cơ chính không thể đồng thời là cơ phụ."
              onChange={(values) => onChange({ secondary_muscles: values })}
            />
          </div>
          <Field
            label="Video URL"
            value={form.video_url}
            placeholder="https://.../exercise.mp4"
            error={fieldError(fieldErrors, 'video_url')}
            hint="Dùng link trực tiếp tới file MP4 hoặc WebM có thể phát trên trình duyệt."
            onChange={(value) => onChange({ video_url: value })}
          />
          <Field
            label="Thời lượng (giây)"
            type="number"
            min={1}
            step={1}
            value={form.estimated_duration_seconds}
            error={fieldError(fieldErrors, 'estimated_duration_seconds')}
            onChange={(value) => onChange({ estimated_duration_seconds: value })}
          />
          <Field
            label="Kcal/phút"
            type="number"
            min={0}
            step="0.1"
            value={form.calories_per_minute}
            error={fieldError(fieldErrors, 'calories_per_minute')}
            onChange={(value) => onChange({ calories_per_minute: value })}
          />
          <div className="md:col-span-2">
            <TextAreaField
              label="Chống chỉ định"
              value={form.contraindications}
              rows={3}
              hint="Mỗi dòng, dấu phẩy hoặc chấm phẩy là một mục; mục trùng sẽ được loại bỏ."
              error={fieldError(fieldErrors, 'contraindications')}
              onChange={(value) => onChange({ contraindications: value })}
            />
          </div>
          <section className="rounded-xl border border-border-primary bg-bg-primary/35 p-4 md:col-span-2">
            <div>
              <h3 className="text-sm font-black text-text-primary">Hướng dẫn có cấu trúc</h3>
              <p className="mt-1 text-xs font-medium text-text-tertiary">Mỗi dòng là một ý. Các ý trùng được loại bỏ khi lưu.</p>
              {fieldError(fieldErrors, 'instructions') ? <p role="alert" className="mt-2 text-xs font-semibold text-danger">{fieldError(fieldErrors, 'instructions')}</p> : null}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextAreaField
                label="Chuẩn bị / setup"
                value={form.instructions.setup}
                rows={4}
                onChange={(value) => updateInstructions('setup', value)}
              />
              <TextAreaField
                label="Các bước thực hiện"
                value={form.instructions.steps}
                rows={4}
                onChange={(value) => updateInstructions('steps', value)}
              />
              <TextAreaField
                label="Hít thở"
                value={form.instructions.breathing}
                rows={4}
                onChange={(value) => updateInstructions('breathing', value)}
              />
              <TextAreaField
                label="Lưu ý kỹ thuật / coaching cues"
                value={form.instructions.coaching_cues}
                rows={4}
                onChange={(value) => updateInstructions('coaching_cues', value)}
              />
              <div className="md:col-span-2">
                <TextAreaField
                  label="Lỗi thường gặp"
                  value={form.instructions.common_mistakes}
                  rows={4}
                  onChange={(value) => updateInstructions('common_mistakes', value)}
                />
              </div>
              <Field
                label="ID biến thể dễ hơn"
                value={form.instructions.easier_variation_id}
                placeholder="bodyweight-squat"
                hint="Để trống nếu chưa có biến thể."
                error={fieldError(fieldErrors, 'instructions.easier_variation_id')}
                onChange={(value) => updateInstructions('easier_variation_id', value)}
              />
              <Field
                label="ID biến thể khó hơn"
                value={form.instructions.harder_variation_id}
                placeholder="barbell-back-squat"
                hint="ID phải tồn tại trong catalog."
                error={fieldError(fieldErrors, 'instructions.harder_variation_id')}
                onChange={(value) => updateInstructions('harder_variation_id', value)}
              />
            </div>
          </section>
          <div className="md:col-span-2">
            <InstructionPreview instructions={form.instructions} />
          </div>
        </div>
        <PanelFooter saving={saving} onClose={onClose} />
      </form>
    </div>
  );
}

function FoodFormPanel({
  form,
  isEditing,
  saving,
  onClose,
  onSubmit,
  onChange
}: {
  form: FoodForm;
  isEditing: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (patch: Partial<FoodForm>) => void;
}) {
  return (
    <div className="admin-drawer-backdrop fixed inset-0 z-[70] flex justify-end bg-black/50 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="admin-drawer-panel flex h-full w-full max-w-3xl flex-col border-l border-border-primary bg-bg-secondary shadow-2xl">
        <PanelHeader title={isEditing ? 'Sửa món ăn' : 'Thêm món ăn'} saving={saving} onClose={onClose} />
        <div className="custom-scrollbar grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2 md:p-5">
          <Field label="Tên món" value={form.name} onChange={(value) => onChange({ name: value })} />
          <Field label="Danh mục" value={form.category} onChange={(value) => onChange({ category: value })} />
          <Field label="Calories" type="number" value={form.calories} onChange={(value) => onChange({ calories: value })} />
          <Field label="Protein" type="number" value={form.protein} onChange={(value) => onChange({ protein: value })} />
          <Field label="Carbs" type="number" value={form.carbs} onChange={(value) => onChange({ carbs: value })} />
          <Field label="Fat" type="number" value={form.fat} onChange={(value) => onChange({ fat: value })} />
          <Field label="Serving unit" value={form.serving_unit} onChange={(value) => onChange({ serving_unit: value })} />
          <Field label="Ảnh URL" value={form.image_url} onChange={(value) => onChange({ image_url: value })} />
          <Field label="Meal type" value={form.meal_type} onChange={(value) => onChange({ meal_type: value })} />
          <Field label="Goal type" value={form.goal_type} onChange={(value) => onChange({ goal_type: value })} />
          <Field label="Allergens" value={form.allergens} onChange={(value) => onChange({ allergens: value })} />
          <Field label="Dietary tags" value={form.dietary_tags} onChange={(value) => onChange({ dietary_tags: value })} />
          <Field label="Ingredient metadata" value={form.ingredient_metadata} onChange={(value) => onChange({ ingredient_metadata: value })} />
          <Field label="Animal source" value={form.animal_source} onChange={(value) => onChange({ animal_source: value })} />
          <Field label="Price level" value={form.price_level} onChange={(value) => onChange({ price_level: value })} />
          <Field label="Thời gian nấu" type="number" value={form.cooking_time_minutes} onChange={(value) => onChange({ cooking_time_minutes: value })} />
          <Field label="Region" value={form.region} onChange={(value) => onChange({ region: value })} />
          <label className="flex items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary px-3 py-3 md:col-span-2">
            <input
              type="checkbox"
              checked={form.is_easy_to_prepare}
              onChange={(event) => onChange({ is_easy_to_prepare: event.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm font-semibold text-text-primary">Dễ chuẩn bị</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary px-3 py-3 md:col-span-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => onChange({ is_active: event.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm font-semibold text-text-primary">Có hiệu lực trong catalog</span>
          </label>
        </div>
        <PanelFooter saving={saving} onClose={onClose} />
      </form>
    </div>
  );
}

function PanelHeader({ title, saving, onClose }: { title: string; saving: boolean; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-primary px-4 py-4 md:px-5">
      <h2 className="text-lg font-black text-text-primary">{title}</h2>
      <button type="button" disabled={saving} onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary disabled:opacity-60">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function PanelFooter({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-2 border-t border-border-primary px-4 py-4 md:px-5">
      <button type="button" disabled={saving} onClick={onClose} className="inline-flex h-11 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary px-4 text-sm font-black text-text-primary disabled:opacity-60">
        Hủy
      </button>
      <button type="submit" disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Lưu
      </button>
    </div>
  );
}
