/** Shared dietary and allergy contract. Store canonical values at write boundaries. */
export const DIETARY_RESTRICTIONS = ['vegetarian', 'vegan'] as const;
export const DIET_STYLES = ['balanced', 'clean', 'high_protein', 'low_carb'] as const;
export const BUDGET_LEVELS = ['low', 'medium', 'high'] as const;
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout'] as const;
export const COOKING_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const ALLERGENS = ['peanut', 'tree_nuts', 'milk', 'egg', 'soy', 'wheat', 'fish', 'shellfish', 'sesame'] as const;

export type DietaryRestriction = typeof DIETARY_RESTRICTIONS[number];
export type DietStyle = typeof DIET_STYLES[number];
export type BudgetLevel = typeof BUDGET_LEVELS[number];
export type MealType = typeof MEAL_TYPES[number];
export type CookingDifficulty = typeof COOKING_DIFFICULTIES[number];
export type Allergen = typeof ALLERGENS[number];
/** @deprecated Use Allergen. Kept for Phase 1 compatibility. */
export type CanonicalAllergy = Allergen;

export const DIETARY_RESTRICTION_LABELS_VI: Record<DietaryRestriction, string> = { vegetarian: 'Ăn chay', vegan: 'Thuần chay' };
export const DIET_STYLE_LABELS_VI: Record<DietStyle, string> = { balanced: 'Cân bằng', clean: 'Eat clean', high_protein: 'Giàu protein', low_carb: 'Ít carb' };
export const BUDGET_LEVEL_LABELS_VI: Record<BudgetLevel, string> = { low: 'Tiết kiệm', medium: 'Bình thường', high: 'Thoải mái' };
export const MEAL_TYPE_LABELS_VI: Record<MealType, string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ', pre_workout: 'Trước tập', post_workout: 'Sau tập' };
export const COOKING_DIFFICULTY_LABELS_VI: Record<CookingDifficulty, string> = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };
export const ALLERGEN_LABELS_VI: Record<Allergen, string> = { peanut: 'Đậu phộng', tree_nuts: 'Hạt cây', milk: 'Sữa', egg: 'Trứng', soy: 'Đậu nành', wheat: 'Lúa mì', fish: 'Cá', shellfish: 'Giáp xác', sesame: 'Mè' };

const normalizeText = (value: unknown): string => String(value ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const asValues = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(asValues);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && trimmed.length > 1) {
      try { return asValues(JSON.parse(trimmed)); } catch { /* fall through to delimited legacy text */ }
    }
  }
  return String(value ?? '').split(/[|,;/\n]+/).map((item) => item.trim()).filter(Boolean);
};

const unique = <T extends string>(values: T[]) => Array.from(new Set(values));
/** Exact normalized phrase/token matching only; never use substring/fuzzy matching for safety taxonomy. */
const matches = (text: string, values: string[]) => values.some((value) => {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(text);
});

export const normalizeTaxonomyValues = (value: unknown): string[] => unique(asValues(value).map(normalizeText).filter(Boolean));

export const isDietaryRestriction = (value: unknown): value is DietaryRestriction => DIETARY_RESTRICTIONS.includes(value as DietaryRestriction);
export const isDietStyle = (value: unknown): value is DietStyle => DIET_STYLES.includes(value as DietStyle);
export const isBudgetLevel = (value: unknown): value is BudgetLevel => BUDGET_LEVELS.includes(value as BudgetLevel);
export const isMealType = (value: unknown): value is MealType => MEAL_TYPES.includes(value as MealType);
export const isCookingDifficulty = (value: unknown): value is CookingDifficulty => COOKING_DIFFICULTIES.includes(value as CookingDifficulty);
export const isAllergen = (value: unknown): value is Allergen => ALLERGENS.includes(value as Allergen);

export const normalizeDietaryRestrictions = (...values: unknown[]): DietaryRestriction[] => unique(
  values.flatMap(asValues).flatMap((value) => {
    const text = normalizeText(value);
    const restrictions: DietaryRestriction[] = [];
    if (matches(text, ['vegan', 'thuan chay'])) restrictions.push('vegan');
    if (matches(text, ['vegetarian', 'an chay', 'chay'])) restrictions.push('vegetarian');
    return restrictions;
  }),
);

export const normalizeDietStyles = (...values: unknown[]): DietStyle[] => unique(
  values.flatMap(asValues).flatMap((value) => {
    const text = normalizeText(value);
    const styles: DietStyle[] = [];
    if (matches(text, ['clean', 'eat clean'])) styles.push('clean');
    if (matches(text, ['high protein', 'highprotein', 'giau protein', 'nhieu dam'])) styles.push('high_protein');
    if (matches(text, ['low carb', 'lowcarb', 'keto'])) styles.push('low_carb');
    if (matches(text, ['balanced', 'normal', 'binh thuong', 'can bang'])) styles.push('balanced');
    return styles;
  }),
);

export const normalizeBudgetLevel = (value: unknown): BudgetLevel | null => {
  const text = normalizeText(value);
  if (matches(text, ['low', 'cheap', 'budget', 'low budget', 'tiet kiem', 'sinh vien', 'gia re'])) return 'low';
  if (matches(text, ['medium', 'normal', 'standard', 'binh thuong', 'trung binh'])) return 'medium';
  if (matches(text, ['high', 'premium', 'comfortable', 'thoai mai', 'cao cap'])) return 'high';
  return null;
};

export const normalizeMealTypes = (...values: unknown[]): MealType[] => unique(values.flatMap(asValues).flatMap((value) => {
  const text = normalizeText(value);
  if (['breakfast', 'bua sang'].includes(text)) return ['breakfast'];
  if (['lunch', 'bua trua'].includes(text)) return ['lunch'];
  if (['dinner', 'bua toi'].includes(text)) return ['dinner'];
  if (['snack', 'bua phu'].includes(text)) return ['snack'];
  if (['pre workout', 'preworkout', 'truoc tap'].includes(text)) return ['pre_workout'];
  if (['post workout', 'postworkout', 'sau tap'].includes(text)) return ['post_workout'];
  return [];
}));

export const normalizeCookingDifficulty = (value: unknown): CookingDifficulty | null => {
  const text = normalizeText(value);
  if (['easy', 'de'].includes(text)) return 'easy';
  if (['medium', 'trung binh'].includes(text)) return 'medium';
  if (['hard', 'kho'].includes(text)) return 'hard';
  return null;
};

const ALLERGY_ALIASES: Array<[CanonicalAllergy, string[]]> = [
  ['peanut', ['peanut', 'dau phong', 'lac']],
  ['tree_nuts', ['tree nuts', 'tree nut', 'nuts', 'hat dieu', 'cashew', 'hanh nhan', 'almond', 'walnut']],
  ['milk', ['milk', 'dairy', 'sua', 'lactose']],
  ['egg', ['egg', 'trung']],
  ['soy', ['soy', 'soya', 'dau nanh']],
  ['wheat', ['wheat', 'gluten', 'lua mi']],
  ['fish', ['fish', 'ca hoi', 'ca ngu', 'ca thu', 'salmon']],
  ['shellfish', ['shellfish', 'shrimp', 'tom', 'cua']],
  ['sesame', ['sesame', 'me']],
];

export const normalizeAllergies = (...values: unknown[]): string[] => unique(
  values.flatMap(asValues).flatMap((value) => {
    const text = normalizeText(value);
    if (!text || matches(text, ['none', 'no allergy', 'khong di ung', 'khong co di ung'])) return [];
    const known = ALLERGY_ALIASES.filter(([, aliases]) => matches(text, aliases)).map(([canonical]) => canonical);
    // Preserve an unrecognised, explicit allergy value for later user/admin correction.
    return known.length ? known : [text];
  }),
);

export const normalizeCanonicalAllergens = (...values: unknown[]): Allergen[] =>
  normalizeAllergies(...values).filter(isAllergen);

export const isCanonicalAllergy = (value: unknown): value is CanonicalAllergy => isAllergen(value);

export const formatBudgetLevelVi = (value: BudgetLevel | null | undefined): string => BUDGET_LEVEL_LABELS_VI[value || 'medium'];
