import { supabase } from '../config/Supabase';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
type PriceLevel = 'Tiết kiệm' | 'Trung bình' | 'Thoải mái';

type FoodSeed = {
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_unit: string;
  image_url: string | null;
  meal_type: MealType[];
  goal_type: string[];
  allergens: string[];
  price_level: PriceLevel;
  cooking_time_minutes: number;
  region: string;
  is_easy_to_prepare: boolean;
};

type ExistingFood = {
  id: string;
  name: string | null;
  category: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  serving_unit: string | null;
  meal_type: string[] | null;
  goal_type: string[] | null;
  allergens: string[] | null;
  price_level: string | null;
  cooking_time_minutes: number | null;
  region: string | null;
  is_easy_to_prepare: boolean | null;
};

const DEFAULT_TARGET_COUNT = 2300;
const BATCH_SIZE = 400;
const FOOD_SELECT = 'id, name, category, calories, protein, carbs, fat, serving_unit, meal_type, goal_type, allergens, price_level, cooking_time_minutes, region, is_easy_to_prepare';
const INSERT_CATEGORY_SHARES: Array<[string, number]> = [
  ['Rau củ', 0.22],
  ['Carbs', 0.20],
  ['Trái cây', 0.16],
  ['Bữa phụ', 0.14],
  ['Sữa', 0.10],
  ['Chất đạm', 0.12],
  ['Món chay', 0.06],
];

const DIET_GOALS = {
  normal: 'Bình thường',
  vegetarian: 'Ăn chay',
  clean: 'Eat Clean',
  highProtein: 'Ăn nhiều đạm (High Protein)',
  lowCarb: 'Keto / Low Carb',
  fatLoss: 'Giảm cân',
  muscleGain: 'Tăng cơ',
  maintain: 'Giữ dáng',
};

const REGIONS = ['Miền Bắc', 'Miền Trung', 'Miền Nam', 'Hà Nội', 'Huế', 'Đà Nẵng', 'Sài Gòn', 'Miền Tây'];

const normalizeText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const foodKey = (value: Pick<FoodSeed, 'name' | 'serving_unit'> | ExistingFood) =>
  `${normalizeText(value.name)}|${normalizeText(value.serving_unit || '100g')}`;

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const uniqueStrings = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const item = String(value || '').trim();
    if (!item || seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });
  return result;
};

const priceRank: Record<PriceLevel, number> = {
  'Tiết kiệm': 0,
  'Trung bình': 1,
  'Thoải mái': 2,
};

const priceByRank = (rank: number): PriceLevel => {
  if (rank <= 0) return 'Tiết kiệm';
  if (rank >= 2) return 'Thoải mái';
  return 'Trung bình';
};

const mergePrice = (...levels: PriceLevel[]) =>
  priceByRank(Math.max(...levels.map((level) => priceRank[level])));

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const stableShuffle = <T extends { name: string }>(rows: T[]) =>
  [...rows].sort((a, b) => stableHash(a.name) - stableHash(b.name));

const hasAny = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(normalizeText(keyword)));

const inferAllergens = (name: string, baseAllergens: string[] = []) => {
  const text = normalizeText(name);
  const paddedText = ` ${text} `;
  const containsFoodTerm = (term: string) => paddedText.includes(` ${normalizeText(term)} `) || text.includes(normalizeText(term));
  const allergens = [...baseAllergens];
  if (['tôm', 'mực', 'cua', 'ghẹ', 'nghêu', 'sò', 'ốc', 'hải sản'].some(containsFoodTerm)) allergens.push('hải sản');
  if (['cá hồi', 'cá ngừ', 'cá thu', 'cá basa', 'cá nục', 'chả cá', 'bún cá'].some(containsFoodTerm)) allergens.push('cá');
  if (['trứng'].some(containsFoodTerm)) allergens.push('trứng');
  if (['sữa', 'yogurt', 'sữa chua', 'phô mai'].some(containsFoodTerm)) allergens.push('sữa');
  if (['đậu hũ', 'đậu nành', 'tempeh', 'sữa đậu'].some(containsFoodTerm)) allergens.push('đậu nành');
  if (['đậu phộng', 'bơ đậu phộng'].some(containsFoodTerm)) allergens.push('đậu phộng');
  if (['mì trứng', 'bánh mì', 'pasta', 'nui'].some(containsFoodTerm)) allergens.push('gluten');
  return uniqueStrings(allergens);
};

const isVegetarianName = (name: string) => {
  const text = normalizeText(name);
  return hasAny(text, [
    'chay',
    'đậu hũ',
    'đậu phụ',
    'tempeh',
    'nấm',
    'đậu lăng',
    'đậu gà',
    'đậu đen',
    'đậu xanh',
    'rau',
    'trứng',
    'sữa chua',
    'yogurt',
    'phô mai',
  ]) && !hasAny(text, ['thịt', 'heo', 'bò', 'gà', 'vịt', 'cá hồi', 'cá ngừ', 'cá thu', 'cá basa', 'cá nục', 'tôm', 'mực', 'cua', 'nghêu', 'sò']);
};

const inferMealTypes = (name: string, category?: string | null): MealType[] => {
  const text = normalizeText(`${category || ''} ${name}`);
  if (hasAny(text, ['trái cây', 'sinh tố', 'sữa chua', 'yogurt', 'hạt', 'bữa phụ', 'snack', 'chè'])) {
    return ['snack', 'breakfast'];
  }
  if (hasAny(text, ['xôi', 'cháo', 'bánh mì', 'bánh cuốn', 'yến mạch', 'trứng', 'sữa', 'khoai lang'])) {
    return ['breakfast', 'snack'];
  }
  if (hasAny(text, ['phở', 'bún', 'miến', 'mì', 'hủ tiếu', 'cơm', 'canh', 'lẩu', 'gỏi', 'salad', 'rau', 'đạm', 'thịt', 'cá', 'đậu hũ'])) {
    return ['lunch', 'dinner'];
  }
  return ['lunch', 'dinner', 'breakfast'];
};

const inferPriceLevel = (name: string, current?: string | null): PriceLevel => {
  if (current === 'Tiết kiệm' || current === 'Trung bình' || current === 'Thoải mái') return current;
  const text = normalizeText(name);
  if (hasAny(text, ['cá hồi', 'bò thăn', 'thăn bò', 'tôm sú', 'cua', 'ghẹ', 'sò điệp', 'ức vịt', 'hạnh nhân', 'óc chó'])) {
    return 'Thoải mái';
  }
  if (hasAny(text, ['trứng', 'đậu hũ', 'đậu phụ', 'đậu đen', 'đậu xanh', 'rau', 'khoai', 'cơm trắng', 'cá basa', 'cá nục'])) {
    return 'Tiết kiệm';
  }
  return 'Trung bình';
};

const inferGoalTypes = (food: Pick<ExistingFood, 'name' | 'category' | 'calories' | 'protein' | 'carbs' | 'fat'>) => {
  const name = String(food.name || '');
  const text = normalizeText(`${food.category || ''} ${name}`);
  const goals = [DIET_GOALS.normal, DIET_GOALS.maintain];
  const protein = Number(food.protein || 0);
  const carbs = Number(food.carbs || 0);
  const fat = Number(food.fat || 0);
  const calories = Number(food.calories || 0);

  if (isVegetarianName(name) || hasAny(text, ['chay'])) goals.push(DIET_GOALS.vegetarian);
  if (protein >= 18 || protein >= carbs * 0.8) goals.push(DIET_GOALS.highProtein, DIET_GOALS.muscleGain);
  if (calories <= 350 && fat <= 12) goals.push(DIET_GOALS.clean, DIET_GOALS.fatLoss);
  if (carbs <= 12 && protein >= 10) goals.push(DIET_GOALS.lowCarb);
  if (hasAny(text, ['gạo lứt', 'ít dầu', 'salad', 'luộc', 'hấp', 'yến mạch', 'eat clean'])) goals.push(DIET_GOALS.clean);

  return uniqueStrings(goals);
};

const inferCookingTime = (name: string, category?: string | null, current?: number | null) => {
  if (Number(current || 0) > 0) return Number(current);
  const text = normalizeText(`${category || ''} ${name}`);
  if (hasAny(text, ['trái cây', 'sữa chua', 'hạt', 'salad'])) return 5;
  if (hasAny(text, ['luộc', 'hấp', 'áp chảo', 'trứng', 'bánh mì', 'khoai'])) return 12;
  if (hasAny(text, ['cơm', 'bún', 'phở', 'cháo', 'canh', 'xào'])) return 25;
  if (hasAny(text, ['lẩu', 'hầm', 'kho', 'nướng'])) return 40;
  return 20;
};

const makeFood = (input: FoodSeed): FoodSeed => ({
  ...input,
  name: input.name.replace(/\s+/g, ' ').trim(),
  calories: round1(Math.max(1, input.calories)),
  protein: round1(Math.max(0, input.protein)),
  carbs: round1(Math.max(0, input.carbs)),
  fat: round1(Math.max(0, input.fat)),
  allergens: inferAllergens(input.name, input.allergens),
  goal_type: uniqueStrings(input.goal_type),
});

const scaleMacros = (
  base: Pick<FoodSeed, 'calories' | 'protein' | 'carbs' | 'fat'>,
  factor: number,
  extra: Partial<Pick<FoodSeed, 'calories' | 'protein' | 'carbs' | 'fat'>> = {},
) => ({
  calories: round1(base.calories * factor + Number(extra.calories || 0)),
  protein: round1(base.protein * factor + Number(extra.protein || 0)),
  carbs: round1(base.carbs * factor + Number(extra.carbs || 0)),
  fat: round1(base.fat * factor + Number(extra.fat || 0)),
});

type ProteinBase = {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  vegetarian: boolean;
  price: PriceLevel;
  allergens?: string[];
  breakfast?: boolean;
  clean?: boolean;
  lowCarb?: boolean;
};

const PROTEINS: ProteinBase[] = [
  { name: 'Ức gà', calories: 165, protein: 31, carbs: 0, fat: 3.6, vegetarian: false, price: 'Trung bình', clean: true, lowCarb: true },
  { name: 'Đùi gà lọc da', calories: 190, protein: 27, carbs: 0, fat: 8, vegetarian: false, price: 'Trung bình', clean: true, lowCarb: true },
  { name: 'Gà xé', calories: 170, protein: 30, carbs: 0, fat: 4, vegetarian: false, price: 'Trung bình', clean: true, lowCarb: true },
  { name: 'Thịt heo nạc', calories: 180, protein: 27, carbs: 0, fat: 7, vegetarian: false, price: 'Trung bình', lowCarb: true },
  { name: 'Thăn bò', calories: 210, protein: 29, carbs: 0, fat: 10, vegetarian: false, price: 'Thoải mái', lowCarb: true },
  { name: 'Bò bắp', calories: 190, protein: 28, carbs: 0, fat: 8, vegetarian: false, price: 'Thoải mái', lowCarb: true },
  { name: 'Cá basa', calories: 130, protein: 22, carbs: 0, fat: 4, vegetarian: false, price: 'Tiết kiệm', allergens: ['cá'], clean: true, lowCarb: true },
  { name: 'Cá nục', calories: 160, protein: 24, carbs: 0, fat: 7, vegetarian: false, price: 'Tiết kiệm', allergens: ['cá'], lowCarb: true },
  { name: 'Cá thu', calories: 205, protein: 24, carbs: 0, fat: 12, vegetarian: false, price: 'Trung bình', allergens: ['cá'], lowCarb: true },
  { name: 'Cá hồi', calories: 208, protein: 22, carbs: 0, fat: 13, vegetarian: false, price: 'Thoải mái', allergens: ['cá'], clean: true, lowCarb: true },
  { name: 'Cá ngừ', calories: 145, protein: 29, carbs: 0, fat: 2.5, vegetarian: false, price: 'Trung bình', allergens: ['cá'], clean: true, lowCarb: true },
  { name: 'Tôm', calories: 99, protein: 24, carbs: 0.2, fat: 0.3, vegetarian: false, price: 'Trung bình', allergens: ['hải sản'], clean: true, lowCarb: true },
  { name: 'Mực', calories: 92, protein: 16, carbs: 3, fat: 1.4, vegetarian: false, price: 'Trung bình', allergens: ['hải sản'], clean: true, lowCarb: true },
  { name: 'Trứng gà', calories: 155, protein: 13, carbs: 1.1, fat: 11, vegetarian: true, price: 'Tiết kiệm', allergens: ['trứng'], breakfast: true, lowCarb: true },
  { name: 'Lòng trắng trứng', calories: 52, protein: 11, carbs: 0.7, fat: 0.2, vegetarian: true, price: 'Tiết kiệm', allergens: ['trứng'], breakfast: true, clean: true, lowCarb: true },
  { name: 'Đậu hũ trắng', calories: 85, protein: 8, carbs: 2, fat: 5, vegetarian: true, price: 'Tiết kiệm', allergens: ['đậu nành'], clean: true, lowCarb: true },
  { name: 'Đậu hũ non', calories: 65, protein: 6, carbs: 2, fat: 3.5, vegetarian: true, price: 'Tiết kiệm', allergens: ['đậu nành'], clean: true, lowCarb: true },
  { name: 'Tempeh', calories: 193, protein: 20, carbs: 9, fat: 11, vegetarian: true, price: 'Trung bình', allergens: ['đậu nành'], clean: true },
  { name: 'Nấm đùi gà', calories: 45, protein: 3.5, carbs: 7, fat: 0.4, vegetarian: true, price: 'Tiết kiệm', clean: true },
  { name: 'Nấm rơm', calories: 35, protein: 3, carbs: 5, fat: 0.3, vegetarian: true, price: 'Tiết kiệm', clean: true },
  { name: 'Nấm hương', calories: 55, protein: 3, carbs: 10, fat: 0.5, vegetarian: true, price: 'Trung bình', clean: true },
  { name: 'Đậu lăng', calories: 116, protein: 9, carbs: 20, fat: 0.4, vegetarian: true, price: 'Trung bình', clean: true },
  { name: 'Đậu gà', calories: 164, protein: 9, carbs: 27, fat: 2.6, vegetarian: true, price: 'Trung bình', clean: true },
  { name: 'Đậu đen', calories: 132, protein: 9, carbs: 24, fat: 0.5, vegetarian: true, price: 'Tiết kiệm', clean: true },
  { name: 'Sữa chua Hy Lạp', calories: 97, protein: 10, carbs: 3.6, fat: 5, vegetarian: true, price: 'Trung bình', allergens: ['sữa'], breakfast: true, clean: true },
  { name: 'Phô mai tươi ít béo', calories: 98, protein: 11, carbs: 3.4, fat: 4.3, vegetarian: true, price: 'Trung bình', allergens: ['sữa'], breakfast: true, clean: true, lowCarb: true },
];

const PROTEIN_METHODS = [
  { name: 'luộc sả gừng', cal: 0, carbs: 0, fat: 0, time: 15, clean: true },
  { name: 'hấp hành gừng', cal: 0, carbs: 0, fat: 0, time: 16, clean: true },
  { name: 'áp chảo ít dầu', cal: 25, carbs: 0, fat: 2.8, time: 14, clean: true },
  { name: 'nướng sả ớt', cal: 20, carbs: 1.5, fat: 1.5, time: 28, clean: false },
  { name: 'kho tiêu', cal: 35, carbs: 3, fat: 2.5, time: 35, clean: false },
  { name: 'kho nghệ', cal: 30, carbs: 3, fat: 2, time: 35, clean: false },
  { name: 'sốt cà chua', cal: 28, carbs: 5, fat: 1.5, time: 20, clean: true },
  { name: 'xào nấm', cal: 45, carbs: 4, fat: 4, time: 18, clean: false },
  { name: 'sốt chanh dây', cal: 38, carbs: 7, fat: 1, time: 18, clean: true },
  { name: 'rim nước mắm', cal: 45, carbs: 6, fat: 2.5, time: 22, clean: false },
  { name: 'trộn rau thơm', cal: 18, carbs: 2, fat: 1, time: 10, clean: true },
  { name: 'cuốn rau sống', cal: 22, carbs: 3, fat: 1, time: 12, clean: true },
];

const PROTEIN_SEASONINGS = ['kiểu nhà làm', 'ít muối', 'vị truyền thống', 'vị cay nhẹ', 'ăn kèm dưa leo'];

type CarbBase = {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  price: PriceLevel;
  clean?: boolean;
  breakfast?: boolean;
  allergens?: string[];
};

const CARBS: CarbBase[] = [
  { name: 'Cơm trắng', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, price: 'Tiết kiệm' },
  { name: 'Cơm gạo lứt', calories: 112, protein: 2.6, carbs: 23, fat: 0.9, price: 'Trung bình', clean: true },
  { name: 'Gạo lứt đỏ', calories: 115, protein: 2.8, carbs: 24, fat: 0.9, price: 'Trung bình', clean: true },
  { name: 'Bún tươi', calories: 110, protein: 1.7, carbs: 25, fat: 0.2, price: 'Tiết kiệm' },
  { name: 'Phở tươi', calories: 120, protein: 2.3, carbs: 26, fat: 0.4, price: 'Tiết kiệm' },
  { name: 'Miến dong', calories: 120, protein: 0.2, carbs: 29, fat: 0.1, price: 'Trung bình' },
  { name: 'Mì trứng', calories: 138, protein: 4.5, carbs: 25, fat: 2.1, price: 'Tiết kiệm', allergens: ['trứng', 'gluten'] },
  { name: 'Nui gạo', calories: 135, protein: 3, carbs: 27, fat: 1, price: 'Tiết kiệm' },
  { name: 'Khoai lang mật', calories: 86, protein: 1.6, carbs: 20, fat: 0.1, price: 'Tiết kiệm', clean: true, breakfast: true },
  { name: 'Khoai lang tím', calories: 90, protein: 1.6, carbs: 21, fat: 0.1, price: 'Tiết kiệm', clean: true, breakfast: true },
  { name: 'Khoai tây', calories: 77, protein: 2, carbs: 17, fat: 0.1, price: 'Tiết kiệm', clean: true },
  { name: 'Bắp nếp', calories: 96, protein: 3.4, carbs: 21, fat: 1.5, price: 'Tiết kiệm', breakfast: true },
  { name: 'Yến mạch', calories: 389, protein: 17, carbs: 66, fat: 7, price: 'Trung bình', clean: true, breakfast: true },
  { name: 'Bánh mì nguyên cám', calories: 247, protein: 13, carbs: 41, fat: 4.2, price: 'Trung bình', clean: true, breakfast: true, allergens: ['gluten'] },
  { name: 'Bánh mì Việt Nam', calories: 270, protein: 8, carbs: 56, fat: 1.5, price: 'Tiết kiệm', breakfast: true, allergens: ['gluten'] },
  { name: 'Xôi đậu xanh', calories: 230, protein: 6, carbs: 45, fat: 3, price: 'Tiết kiệm', breakfast: true },
  { name: 'Xôi gấc', calories: 250, protein: 5, carbs: 48, fat: 4, price: 'Trung bình', breakfast: true },
  { name: 'Cháo trắng', calories: 70, protein: 1.5, carbs: 15, fat: 0.2, price: 'Tiết kiệm', breakfast: true },
  { name: 'Cháo yến mạch', calories: 145, protein: 5, carbs: 25, fat: 3, price: 'Trung bình', clean: true, breakfast: true },
  { name: 'Bánh hỏi', calories: 130, protein: 2, carbs: 28, fat: 0.5, price: 'Trung bình' },
  { name: 'Bánh cuốn vỏ mỏng', calories: 165, protein: 4, carbs: 32, fat: 2, price: 'Tiết kiệm', breakfast: true },
  { name: 'Bún gạo lứt', calories: 118, protein: 3, carbs: 24, fat: 0.8, price: 'Trung bình', clean: true },
];

const CARB_STYLES = [
  { name: 'hấp nóng', cal: 0, protein: 0, carbs: 0, fat: 0, time: 8, clean: true },
  { name: 'mè rang', cal: 32, protein: 1, carbs: 1, fat: 2.6, time: 8, clean: true },
  { name: 'hành lá', cal: 18, protein: 0.3, carbs: 1, fat: 1.3, time: 8, clean: false },
  { name: 'rau thơm', cal: 5, protein: 0.2, carbs: 1, fat: 0, time: 5, clean: true },
  { name: 'ít dầu', cal: 18, protein: 0, carbs: 0, fat: 2, time: 10, clean: true },
  { name: 'đậu xanh', cal: 45, protein: 3, carbs: 8, fat: 0.5, time: 12, clean: true },
  { name: 'nấm băm', cal: 18, protein: 1.2, carbs: 3, fat: 0.2, time: 12, clean: true },
  { name: 'suất nhỏ giảm cân', cal: -25, protein: 0, carbs: -6, fat: 0, time: 8, clean: true },
];

const VEGETABLES = [
  { name: 'Rau muống', calories: 25, protein: 2.6, carbs: 4, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Cải thìa', calories: 18, protein: 1.5, carbs: 2.2, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Cải ngọt', calories: 20, protein: 1.8, carbs: 3, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Bông cải xanh', calories: 34, protein: 2.8, carbs: 7, fat: 0.4, price: 'Trung bình' as PriceLevel },
  { name: 'Bí đỏ', calories: 45, protein: 1, carbs: 11, fat: 0.1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Bí xanh', calories: 17, protein: 0.8, carbs: 3.5, fat: 0.1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Mồng tơi', calories: 19, protein: 1.8, carbs: 3, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Rau dền', calories: 23, protein: 2.5, carbs: 4, fat: 0.3, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Đậu que', calories: 31, protein: 1.8, carbs: 7, fat: 0.1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Su su', calories: 19, protein: 0.8, carbs: 4.5, fat: 0.1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Cà rốt', calories: 41, protein: 0.9, carbs: 10, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Dưa leo', calories: 15, protein: 0.7, carbs: 3.6, fat: 0.1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Cà chua', calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Nấm kim châm', calories: 37, protein: 2.7, carbs: 7.8, fat: 0.3, price: 'Trung bình' as PriceLevel },
  { name: 'Mướp hương', calories: 20, protein: 1.2, carbs: 4, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Bắp cải', calories: 25, protein: 1.3, carbs: 6, fat: 0.1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Cải bó xôi', calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4, price: 'Trung bình' as PriceLevel },
  { name: 'Khổ qua', calories: 17, protein: 1, carbs: 3.7, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Giá đỗ', calories: 30, protein: 3, carbs: 6, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Rau lang', calories: 22, protein: 2.5, carbs: 4, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Hoa thiên lý', calories: 32, protein: 3, carbs: 6, fat: 0.4, price: 'Trung bình' as PriceLevel },
  { name: 'Hoa chuối', calories: 51, protein: 1.6, carbs: 9, fat: 0.6, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Xà lách', calories: 15, protein: 1.4, carbs: 2.9, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Rau củ thập cẩm', calories: 45, protein: 2, carbs: 9, fat: 0.3, price: 'Trung bình' as PriceLevel },
  { name: 'Củ sen', calories: 74, protein: 2.6, carbs: 17, fat: 0.1, price: 'Trung bình' as PriceLevel },
];

const VEGETABLE_METHODS = [
  { name: 'luộc', cal: 0, carbs: 0, fat: 0, time: 8 },
  { name: 'hấp gừng', cal: 0, carbs: 0, fat: 0, time: 10 },
  { name: 'xào tỏi ít dầu', cal: 35, carbs: 1, fat: 3.5, time: 10 },
  { name: 'nấu canh', cal: 8, carbs: 1, fat: 0.3, time: 15 },
  { name: 'trộn gỏi chanh', cal: 18, carbs: 3, fat: 0.5, time: 12 },
  { name: 'sốt mè rang', cal: 48, carbs: 2, fat: 4.2, time: 10 },
  { name: 'áp chảo tiêu', cal: 25, carbs: 1, fat: 2.2, time: 10 },
  { name: 'xào nấm chay', cal: 32, carbs: 3, fat: 2.4, time: 12 },
];

const FRUITS = [
  { name: 'Chuối cau', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Táo', calories: 52, protein: 0.3, carbs: 14, fat: 0.2, price: 'Trung bình' as PriceLevel },
  { name: 'Cam sành', calories: 47, protein: 0.9, carbs: 12, fat: 0.1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Bưởi da xanh', calories: 38, protein: 0.8, carbs: 10, fat: 0.1, price: 'Trung bình' as PriceLevel },
  { name: 'Ổi', calories: 68, protein: 2.6, carbs: 14, fat: 1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Thanh long', calories: 60, protein: 1.2, carbs: 13, fat: 0.4, price: 'Trung bình' as PriceLevel },
  { name: 'Dưa hấu', calories: 30, protein: 0.6, carbs: 8, fat: 0.2, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Dứa', calories: 50, protein: 0.5, carbs: 13, fat: 0.1, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Xoài chín', calories: 60, protein: 0.8, carbs: 15, fat: 0.4, price: 'Trung bình' as PriceLevel },
  { name: 'Dâu tây Đà Lạt', calories: 32, protein: 0.7, carbs: 8, fat: 0.3, price: 'Thoải mái' as PriceLevel },
  { name: 'Nho', calories: 69, protein: 0.7, carbs: 18, fat: 0.2, price: 'Thoải mái' as PriceLevel },
  { name: 'Đu đủ', calories: 43, protein: 0.5, carbs: 11, fat: 0.3, price: 'Tiết kiệm' as PriceLevel },
  { name: 'Mãng cầu', calories: 75, protein: 1.6, carbs: 18, fat: 0.7, price: 'Trung bình' as PriceLevel },
  { name: 'Lê', calories: 57, protein: 0.4, carbs: 15, fat: 0.1, price: 'Trung bình' as PriceLevel },
  { name: 'Kiwi', calories: 61, protein: 1.1, carbs: 15, fat: 0.5, price: 'Thoải mái' as PriceLevel },
];

const FRUIT_STYLES = [
  { name: 'ăn tươi', cal: 0, protein: 0, carbs: 0, fat: 0 },
  { name: 'dầm sữa chua không đường', cal: 65, protein: 5, carbs: 5, fat: 2, allergen: 'sữa' },
  { name: 'salad bạc hà', cal: 10, protein: 0, carbs: 2, fat: 0 },
  { name: 'sinh tố không đường', cal: 20, protein: 0, carbs: 5, fat: 0 },
  { name: 'ăn kèm hạt chia', cal: 35, protein: 1.2, carbs: 3, fat: 2.2 },
];

const SNACKS = [
  { name: 'Sữa chua không đường', category: 'Sữa', calories: 61, protein: 3.5, carbs: 4.7, fat: 3.3, price: 'Tiết kiệm' as PriceLevel, allergens: ['sữa'] },
  { name: 'Sữa đậu nành không đường', category: 'Sữa', calories: 54, protein: 3.3, carbs: 6, fat: 1.8, price: 'Tiết kiệm' as PriceLevel, allergens: ['đậu nành'] },
  { name: 'Sữa tươi ít béo', category: 'Sữa', calories: 50, protein: 3.4, carbs: 5, fat: 1.5, price: 'Trung bình' as PriceLevel, allergens: ['sữa'] },
  { name: 'Hạt điều rang nhạt', category: 'Bữa phụ', calories: 553, protein: 18, carbs: 30, fat: 44, price: 'Thoải mái' as PriceLevel, allergens: ['hạt'] },
  { name: 'Đậu phộng rang', category: 'Bữa phụ', calories: 567, protein: 26, carbs: 16, fat: 49, price: 'Tiết kiệm' as PriceLevel, allergens: ['đậu phộng'] },
  { name: 'Hạnh nhân', category: 'Bữa phụ', calories: 579, protein: 21, carbs: 22, fat: 50, price: 'Thoải mái' as PriceLevel, allergens: ['hạt'] },
  { name: 'Trứng luộc', category: 'Chất đạm', calories: 155, protein: 13, carbs: 1.1, fat: 11, price: 'Tiết kiệm' as PriceLevel, allergens: ['trứng'] },
  { name: 'Bắp luộc', category: 'Carbs', calories: 96, protein: 3.4, carbs: 21, fat: 1.5, price: 'Tiết kiệm' as PriceLevel, allergens: [] },
  { name: 'Khoai lang hấp', category: 'Carbs', calories: 86, protein: 1.6, carbs: 20, fat: 0.1, price: 'Tiết kiệm' as PriceLevel, allergens: [] },
  { name: 'Rong biển cuộn cơm gạo lứt', category: 'Bữa phụ', calories: 160, protein: 4, carbs: 31, fat: 2, price: 'Trung bình' as PriceLevel, allergens: [] },
  { name: 'Yến mạch qua đêm', category: 'Bữa phụ', calories: 180, protein: 8, carbs: 30, fat: 4, price: 'Trung bình' as PriceLevel, allergens: ['gluten'] },
  { name: 'Pudding hạt chia sữa chua', category: 'Bữa phụ', calories: 150, protein: 7, carbs: 12, fat: 8, price: 'Trung bình' as PriceLevel, allergens: ['sữa'] },
];

const COMPLETE_STARCHES = ['Cơm trắng', 'Cơm gạo lứt', 'Bún tươi', 'Phở tươi', 'Miến dong', 'Bánh hỏi', 'Khoai lang hấp'];
const COMPLETE_VEGETABLE_SIDES = ['rau luộc', 'salad dưa leo', 'canh rau ngót', 'rau xào ít dầu', 'gỏi bắp cải', 'cải thìa hấp'];
const COMPLETE_STYLES = ['suất văn phòng', 'suất nhà nấu', 'suất ít dầu', 'suất nhiều rau', 'suất luyện tập'];

const SOUP_BASES = ['Phở', 'Bún', 'Miến', 'Hủ tiếu', 'Bánh canh', 'Mì Quảng', 'Cháo', 'Nui'];
const SOUP_PROTEINS = ['gà xé', 'bò tái', 'bò chín', 'cá basa', 'tôm thịt', 'đậu hũ nấm', 'trứng', 'heo nạc'];
const SOUP_REGIONS = ['Hà Nội', 'Huế', 'Nam Bộ', 'Đà Nẵng', 'Sài Gòn'];

const generateFoods = () => {
  const rows = new Map<string, FoodSeed>();
  const add = (food: FoodSeed) => {
    const normalized = makeFood(food);
    const key = foodKey(normalized);
    if (!normalized.name || rows.has(key)) return;
    rows.set(key, normalized);
  };

  PROTEINS.forEach((protein) => {
    PROTEIN_METHODS.forEach((method) => {
      PROTEIN_SEASONINGS.forEach((seasoning) => {
        const goals = [
          DIET_GOALS.normal,
          DIET_GOALS.maintain,
          protein.vegetarian ? DIET_GOALS.vegetarian : null,
          protein.clean || method.clean ? DIET_GOALS.clean : null,
          protein.protein >= 18 ? DIET_GOALS.highProtein : null,
          protein.protein >= 18 ? DIET_GOALS.muscleGain : null,
          protein.lowCarb && protein.carbs + method.carbs <= 8 ? DIET_GOALS.lowCarb : null,
        ];
        add({
          name: `${protein.name} ${method.name} ${seasoning}`,
          category: 'Chất đạm',
          calories: protein.calories + method.cal,
          protein: protein.protein,
          carbs: protein.carbs + method.carbs,
          fat: protein.fat + method.fat,
          serving_unit: '100g',
          image_url: null,
          meal_type: protein.breakfast ? ['breakfast', 'snack'] : ['lunch', 'dinner'],
          goal_type: uniqueStrings(goals),
          allergens: protein.allergens || [],
          price_level: protein.price,
          cooking_time_minutes: method.time,
          region: REGIONS[stableHash(`${protein.name}-${method.name}`) % REGIONS.length],
          is_easy_to_prepare: method.time <= 20,
        });
      });
    });
  });

  CARBS.forEach((carb) => {
    CARB_STYLES.forEach((style) => {
      add({
        name: `${carb.name} ${style.name}`,
        category: 'Carbs',
        calories: clamp(carb.calories + style.cal, 25, 430),
        protein: clamp(carb.protein + style.protein, 0, 30),
        carbs: clamp(carb.carbs + style.carbs, 1, 75),
        fat: clamp(carb.fat + style.fat, 0, 20),
        serving_unit: '100g',
        image_url: null,
        meal_type: carb.breakfast ? ['breakfast', 'snack', 'lunch'] : ['lunch', 'dinner', 'breakfast'],
        goal_type: uniqueStrings([
          DIET_GOALS.normal,
          DIET_GOALS.maintain,
          carb.clean || style.clean ? DIET_GOALS.clean : null,
          style.name.includes('suất nhỏ') ? DIET_GOALS.fatLoss : null,
          carb.name.includes('gạo lứt') || carb.name.includes('Yến mạch') ? DIET_GOALS.clean : null,
        ]),
        allergens: carb.allergens || [],
        price_level: carb.price,
        cooking_time_minutes: style.time,
        region: REGIONS[stableHash(`${carb.name}-${style.name}`) % REGIONS.length],
        is_easy_to_prepare: true,
      });
    });
  });

  VEGETABLES.forEach((vegetable) => {
    VEGETABLE_METHODS.forEach((method) => {
      add({
        name: `${vegetable.name} ${method.name}`,
        category: 'Rau củ',
        calories: vegetable.calories + method.cal,
        protein: vegetable.protein,
        carbs: vegetable.carbs + method.carbs,
        fat: vegetable.fat + method.fat,
        serving_unit: '100g',
        image_url: null,
        meal_type: ['lunch', 'dinner'],
        goal_type: [DIET_GOALS.normal, DIET_GOALS.vegetarian, DIET_GOALS.clean, DIET_GOALS.fatLoss, DIET_GOALS.maintain],
        allergens: [],
        price_level: vegetable.price,
        cooking_time_minutes: method.time,
        region: REGIONS[stableHash(`${vegetable.name}-${method.name}`) % REGIONS.length],
        is_easy_to_prepare: method.time <= 12,
      });
    });
  });

  FRUITS.forEach((fruit) => {
    FRUIT_STYLES.forEach((style) => {
      add({
        name: `${fruit.name} ${style.name}`,
        category: 'Trái cây',
        calories: fruit.calories + style.cal,
        protein: fruit.protein + style.protein,
        carbs: fruit.carbs + style.carbs,
        fat: fruit.fat + style.fat,
        serving_unit: '100g',
        image_url: null,
        meal_type: ['snack', 'breakfast'],
        goal_type: [DIET_GOALS.normal, DIET_GOALS.vegetarian, DIET_GOALS.clean, DIET_GOALS.maintain],
        allergens: style.allergen ? [style.allergen] : [],
        price_level: fruit.price,
        cooking_time_minutes: 5,
        region: REGIONS[stableHash(`${fruit.name}-${style.name}`) % REGIONS.length],
        is_easy_to_prepare: true,
      });
    });
  });

  SNACKS.forEach((snack) => {
    ['suất nhỏ', 'suất vừa', 'ăn sau tập', 'ít đường', 'eat clean'].forEach((style, index) => {
      const factor = index === 0 ? 0.65 : index === 1 ? 1 : index === 2 ? 1.2 : 0.85;
      const macros = scaleMacros(snack, factor);
      add({
        name: `${snack.name} ${style}`,
        category: snack.category,
        ...macros,
        serving_unit: '1 phần',
        image_url: null,
        meal_type: ['snack', 'breakfast'],
        goal_type: uniqueStrings([
          DIET_GOALS.normal,
          DIET_GOALS.vegetarian,
          style.includes('eat clean') || style.includes('ít đường') ? DIET_GOALS.clean : null,
          snack.protein >= 10 || style.includes('sau tập') ? DIET_GOALS.highProtein : null,
          style.includes('suất nhỏ') ? DIET_GOALS.fatLoss : null,
          DIET_GOALS.maintain,
        ]),
        allergens: snack.allergens,
        price_level: snack.price,
        cooking_time_minutes: 5,
        region: 'Vietnam',
        is_easy_to_prepare: true,
      });
    });
  });

  const mealProteins = PROTEINS.filter((item) => !item.breakfast);
  COMPLETE_STARCHES.forEach((starch) => {
    mealProteins.forEach((protein) => {
      COMPLETE_VEGETABLE_SIDES.forEach((side) => {
        COMPLETE_STYLES.forEach((style) => {
          const isClean = style.includes('ít dầu') || style.includes('nhiều rau') || starch.includes('gạo lứt') || protein.clean;
          const goals = [
            DIET_GOALS.normal,
            DIET_GOALS.maintain,
            protein.vegetarian ? DIET_GOALS.vegetarian : null,
            isClean ? DIET_GOALS.clean : null,
            protein.protein >= 18 ? DIET_GOALS.highProtein : null,
            protein.protein >= 18 ? DIET_GOALS.muscleGain : null,
            style.includes('ít dầu') || style.includes('nhiều rau') ? DIET_GOALS.fatLoss : null,
          ];
          add({
            name: `${starch} ${protein.name.toLowerCase()} ${side} ${style}`,
            category: protein.vegetarian ? 'Món chay' : 'Cơm',
            calories: 420 + protein.calories * 0.75 + (starch.includes('Khoai') ? -80 : 0) + (style.includes('luyện tập') ? 90 : 0),
            protein: 14 + protein.protein * 0.75,
            carbs: 55 + (starch.includes('Khoai') ? -18 : 0) + (style.includes('luyện tập') ? 15 : 0),
            fat: 8 + protein.fat * 0.6 + (style.includes('ít dầu') ? -3 : 0),
            serving_unit: '1 phần',
            image_url: null,
            meal_type: ['lunch', 'dinner'],
            goal_type: uniqueStrings(goals),
            allergens: protein.allergens || [],
            price_level: mergePrice(protein.price, starch.includes('gạo lứt') ? 'Trung bình' : 'Tiết kiệm'),
            cooking_time_minutes: style.includes('văn phòng') ? 20 : 30,
            region: REGIONS[stableHash(`${starch}-${protein.name}-${side}-${style}`) % REGIONS.length],
            is_easy_to_prepare: style.includes('văn phòng') || style.includes('ít dầu'),
          });
        });
      });
    });
  });

  SOUP_BASES.forEach((base) => {
    SOUP_PROTEINS.forEach((proteinName) => {
      SOUP_REGIONS.forEach((region) => {
        ['tô nhỏ', 'tô vừa', 'nhiều rau', 'ít bánh', 'thêm đạm'].forEach((style) => {
          const isVeg = proteinName.includes('đậu hũ');
          const isHighProtein = style.includes('thêm đạm') || !isVeg;
          add({
            name: `${base} ${proteinName} ${region} ${style}`,
            category: isVeg ? 'Món chay' : 'Món nước',
            calories: 360 + (style.includes('tô nhỏ') ? -80 : 0) + (style.includes('thêm đạm') ? 90 : 0) + (base === 'Cháo' ? -90 : 0),
            protein: 18 + (style.includes('thêm đạm') ? 12 : 0) + (isVeg ? -4 : 6),
            carbs: 45 + (style.includes('ít bánh') ? -15 : 0) + (base === 'Cháo' ? -12 : 0),
            fat: 8 + (proteinName.includes('bò') ? 5 : 0) + (proteinName.includes('đậu hũ') ? 1 : 0),
            serving_unit: '1 tô',
            image_url: null,
            meal_type: base === 'Cháo' ? ['breakfast', 'dinner'] : ['breakfast', 'lunch', 'dinner'],
            goal_type: uniqueStrings([
              DIET_GOALS.normal,
              DIET_GOALS.maintain,
              isVeg ? DIET_GOALS.vegetarian : null,
              style.includes('nhiều rau') || style.includes('ít bánh') ? DIET_GOALS.clean : null,
              style.includes('ít bánh') ? DIET_GOALS.fatLoss : null,
              isHighProtein ? DIET_GOALS.highProtein : null,
            ]),
            allergens: inferAllergens(proteinName),
            price_level: inferPriceLevel(proteinName),
            cooking_time_minutes: 30,
            region,
            is_easy_to_prepare: false,
          });
        });
      });
    });
  });

  return stableShuffle([...rows.values()]);
};

const inferExistingFoodPatch = (food: ExistingFood) => {
  const name = String(food.name || '');
  const patch: Partial<FoodSeed> = {};

  if (!Array.isArray(food.meal_type) || food.meal_type.length === 0) {
    patch.meal_type = inferMealTypes(name, food.category);
  }
  if (!Array.isArray(food.goal_type) || food.goal_type.length === 0) {
    patch.goal_type = inferGoalTypes(food);
  }
  if (!Array.isArray(food.allergens) || food.allergens.length === 0) {
    const allergens = inferAllergens(name);
    if (allergens.length > 0) patch.allergens = allergens;
  }
  if (!food.price_level) {
    patch.price_level = inferPriceLevel(name);
  }
  if (!food.cooking_time_minutes) {
    patch.cooking_time_minutes = inferCookingTime(name, food.category);
  }
  if (!food.region) {
    patch.region = 'Vietnam';
  }
  if (food.is_easy_to_prepare === null) {
    patch.is_easy_to_prepare = inferCookingTime(name, food.category) <= 20;
  }

  return patch;
};

const fetchExistingFoods = async () => {
  const rows: ExistingFood[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('foods')
      .select(FOOD_SELECT)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data || []) as ExistingFood[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
};

const updateExistingMetadata = async (foods: ExistingFood[]) => {
  let updated = 0;
  for (const food of foods) {
    const patch = inferExistingFoodPatch(food);
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase.from('foods').update(patch).eq('id', food.id);
    if (error) throw error;
    updated += 1;
  }
  return updated;
};

const insertInBatches = async (rows: FoodSeed[]) => {
  let inserted = 0;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const { error } = await supabase.from('foods').insert(batch);
    if (error) throw error;
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${rows.length} foods...`);
  }
  return inserted;
};

const summarizeRows = (rows: FoodSeed[]) => {
  const byPrice = new Map<string, number>();
  const byDiet = new Map<string, number>();
  rows.forEach((row) => {
    byPrice.set(row.price_level, (byPrice.get(row.price_level) || 0) + 1);
    row.goal_type.forEach((goal) => {
      if ([DIET_GOALS.normal, DIET_GOALS.vegetarian, DIET_GOALS.clean, DIET_GOALS.highProtein, DIET_GOALS.lowCarb].includes(goal)) {
        byDiet.set(goal, (byDiet.get(goal) || 0) + 1);
      }
    });
  });

  return {
    price: Object.fromEntries(byPrice),
    diet: Object.fromEntries(byDiet),
  };
};

const selectRowsToInsert = (candidates: FoodSeed[], count: number) => {
  if (count <= 0) return [];

  const selected: FoodSeed[] = [];
  const selectedKeys = new Set<string>();
  const addRows = (rows: FoodSeed[], maxRows: number) => {
    for (const row of rows) {
      if (selected.length >= count || maxRows <= 0) return;
      const key = foodKey(row);
      if (selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selected.push(row);
      maxRows -= 1;
    }
  };

  INSERT_CATEGORY_SHARES.forEach(([category, share]) => {
    addRows(candidates.filter((row) => row.category === category), Math.round(count * share));
  });

  addRows(candidates, count - selected.length);
  return selected.slice(0, count);
};

const parseTargetCount = () => {
  const raw = process.argv[2] || process.env.SEED_VIETNAMESE_FOODS_TARGET || String(DEFAULT_TARGET_COUNT);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 200) return DEFAULT_TARGET_COUNT;
  return parsed;
};

const run = async () => {
  const targetCount = parseTargetCount();
  const existingFoods = await fetchExistingFoods();
  const existingKeys = new Set(existingFoods.map(foodKey));
  const generated = generateFoods();
  const insertCandidates = generated.filter((food) => !existingKeys.has(foodKey(food)));
  const missingCount = Math.max(0, targetCount - existingFoods.length);
  const rowsToInsert = selectRowsToInsert(insertCandidates, missingCount);

  console.log(`Existing foods: ${existingFoods.length}`);
  console.log(`Generated candidate foods: ${generated.length}`);
  console.log(`Target total foods: ${targetCount}`);
  console.log(`Rows planned for insert: ${rowsToInsert.length}`);
  console.log(`Planned insert summary: ${JSON.stringify(summarizeRows(rowsToInsert), null, 2)}`);

  const updated = await updateExistingMetadata(existingFoods);
  console.log(`Updated existing food metadata rows: ${updated}`);

  if (rowsToInsert.length > 0) {
    await insertInBatches(rowsToInsert);
  }

  const { count, error } = await supabase.from('foods').select('id', { count: 'exact', head: true });
  if (error) throw error;

  console.log(`Final foods count: ${count || 0}`);
};

run().catch((error) => {
  console.error('Failed to seed Vietnamese foods:', error?.message || error);
  process.exit(1);
});
