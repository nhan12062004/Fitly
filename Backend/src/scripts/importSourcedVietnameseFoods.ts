import { supabase } from '../config/Supabase';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
type PriceLevel = 'Tiết kiệm' | 'Trung bình' | 'Thoải mái';

type FoodPayload = {
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

type SourceDish = {
  name: string;
  source: 'wikidata' | 'wikipedia';
  url: string;
  description?: string;
};

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'FitlyDataImport/1.0 (local development; source-backed food catalog)';

const WIKIPEDIA_CATEGORIES = [
  'Category:Vietnamese cuisine',
  'Category:Vietnamese noodles',
  'Category:Vietnamese soups',
  'Category:Vietnamese desserts',
  'Category:Vietnamese snack foods',
  'Category:Street food in Vietnam',
];

const TITLE_MAP: Record<string, string> = {
  'Balut (food)': 'Hột vịt lộn',
  'Broken rice': 'Cơm tấm',
  'Cooked rice': 'Cơm trắng',
  'Egg coffee': 'Cà phê trứng',
  'Fish sauce': 'Nước mắm',
  'Grass jelly': 'Sương sáo',
  'Vietnamese iced coffee': 'Cà phê sữa đá',
  'Vietnamese noodles': 'Mì Việt Nam',
  'Vietnamese spring roll': 'Gỏi cuốn',
  'Vietnamese steamed rice rolls': 'Bánh cuốn',
  'Vietnamese sandwich': 'Bánh mì',
  'Sticky rice': 'Xôi',
};

const EXTRA_CANONICAL_DISHES = [
  'Phở bò',
  'Phở gà',
  'Bún bò Huế',
  'Bún riêu',
  'Bún mắm',
  'Bún thang',
  'Bún chả',
  'Bún thịt nướng',
  'Bún đậu mắm tôm',
  'Bún ốc',
  'Hủ tiếu Nam Vang',
  'Hủ tiếu gõ',
  'Mì Quảng',
  'Cao lầu',
  'Bánh canh cua',
  'Bánh canh giò heo',
  'Bánh mì thịt',
  'Bánh mì chay',
  'Bánh xèo',
  'Bánh khọt',
  'Bánh bèo',
  'Bánh bột lọc',
  'Bánh nậm',
  'Bánh căn',
  'Bánh cuốn',
  'Bánh ướt',
  'Bánh chưng',
  'Bánh tét',
  'Bánh giò',
  'Bánh bao',
  'Bánh cam',
  'Bánh bò',
  'Bánh chuối',
  'Bánh da lợn',
  'Bánh đậu xanh',
  'Bánh tráng trộn',
  'Bánh tráng nướng',
  'Gỏi cuốn',
  'Chả giò',
  'Nem rán',
  'Nem chua',
  'Nem lụi',
  'Chả cá Lã Vọng',
  'Chả lụa',
  'Giò thủ',
  'Cơm tấm sườn',
  'Cơm gà Hội An',
  'Cơm hến',
  'Cơm lam',
  'Cơm cháy',
  'Cơm rang dưa bò',
  'Cơm chiên Dương Châu',
  'Xôi xéo',
  'Xôi gấc',
  'Xôi mặn',
  'Xôi vò',
  'Cháo lòng',
  'Cháo gà',
  'Cháo vịt',
  'Cháo cá',
  'Miến gà',
  'Miến lươn',
  'Miến ngan',
  'Bò kho',
  'Bò lúc lắc',
  'Bò lá lốt',
  'Thịt kho tàu',
  'Cá kho tộ',
  'Canh chua cá',
  'Canh bí đỏ',
  'Canh rau ngót',
  'Canh khổ qua nhồi thịt',
  'Gỏi gà',
  'Gỏi ngó sen',
  'Gỏi xoài',
  'Nộm hoa chuối',
  'Rau muống xào tỏi',
  'Đậu hũ sốt cà chua',
  'Đậu hũ chiên sả',
  'Phở chay',
  'Bún Huế chay',
  'Cơm chay',
  'Gỏi cuốn chay',
  'Chè ba màu',
  'Chè đậu đen',
  'Chè đậu xanh',
  'Chè trôi nước',
  'Chè thái',
  'Tàu hũ nước đường',
  'Sữa chua nếp cẩm',
  'Cà phê trứng',
  'Cà phê sữa đá',
  'Nước sâm',
  'Trà đá',
];

const DENY_TITLE_KEYWORDS = [
  'cuisine',
  'company',
  'consumption',
  'district',
  'history',
  'industry',
  'list of',
  'province',
  'street',
  'vietnam',
  'wikipedia',
];

const NAME_PREFIXES = [
  'bánh',
  'bún',
  'phở',
  'gỏi',
  'cơm',
  'chè',
  'chả',
  'cháo',
  'nem',
  'xôi',
  'mì',
  'miến',
  'hủ tiếu',
  'lẩu',
  'bò',
  'cá',
  'canh',
  'nộm',
  'rau',
  'đậu',
  'thịt',
  'cà phê',
  'sữa',
  'nước',
  'cao lầu',
  'cốm',
];

const normalizeText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const unique = <T,>(rows: T[], keyFn: (item: T) => string) => {
  const seen = new Set<string>();
  const result: T[] = [];
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }

  return response.json() as Promise<T>;
};

const mediaWikiUrl = (params: Record<string, string | number>) => {
  const searchParams = new URLSearchParams({
    format: 'json',
    origin: '*',
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
  });
  return `${WIKIPEDIA_API}?${searchParams.toString()}`;
};

const sourceUrlFromTitle = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;

const canonicalNameFromTitle = (title: string) => {
  const mapped = TITLE_MAP[title] || title;
  return mapped
    .replace(/\s+\([^)]*\)$/g, '')
    .replace(/^Vietnamese\s+/i, '')
    .trim();
};

const looksLikeDishName = (name: string) => {
  const normalized = normalizeText(name);
  if (!normalized || normalized.length < 3) return false;
  if (DENY_TITLE_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)))) return false;
  return NAME_PREFIXES.some((prefix) => normalized.startsWith(normalizeText(prefix)));
};

const getWikipediaCategoryDishes = async () => {
  const dishes: SourceDish[] = [];

  for (const category of WIKIPEDIA_CATEGORIES) {
    let cmcontinue = '';
    do {
      const data = await fetchJson<any>(mediaWikiUrl({
        action: 'query',
        list: 'categorymembers',
        cmtitle: category,
        cmlimit: 500,
        cmcontinue,
      }));

      const members = data?.query?.categorymembers || [];
      members.forEach((member: any) => {
        if (Number(member.ns) !== 0) return;
        const name = canonicalNameFromTitle(String(member.title || ''));
        if (!looksLikeDishName(name)) return;
        dishes.push({
          name,
          source: 'wikipedia',
          url: sourceUrlFromTitle(String(member.title || '')),
        });
      });

      cmcontinue = data?.continue?.cmcontinue || '';
    } while (cmcontinue);
  }

  return dishes;
};

const getWikipediaListDishes = async () => {
  const data = await fetchJson<any>(mediaWikiUrl({
    action: 'parse',
    page: 'List of Vietnamese dishes',
    prop: 'links',
  }));

  return ((data?.parse?.links || []) as any[])
    .map((link) => String(link['*'] || ''))
    .map((title) => ({
      title,
      name: canonicalNameFromTitle(title),
    }))
    .filter((item) => looksLikeDishName(item.name))
    .map((item): SourceDish => ({
      name: item.name,
      source: 'wikipedia',
      url: sourceUrlFromTitle(item.title),
    }));
};

const getWikidataDishes = async () => {
  const query = `
SELECT ?item ?itemLabel ?itemDescription WHERE {
  ?item wdt:P495 wd:Q881.
  ?item wdt:P31 wd:Q746549.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "vi,en". }
}
LIMIT 300
`;
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}&format=json`;
  const data = await fetchJson<any>(url);

  return ((data?.results?.bindings || []) as any[])
    .map((row): SourceDish => ({
      name: String(row.itemLabel?.value || '').trim(),
      source: 'wikidata',
      url: String(row.item?.value || ''),
      description: row.itemDescription?.value ? String(row.itemDescription.value) : undefined,
    }))
    .filter((item) => looksLikeDishName(item.name));
};

const getExtraCanonicalDishes = () =>
  EXTRA_CANONICAL_DISHES.map((name): SourceDish => ({
    name,
    source: 'wikipedia',
    url: 'https://en.wikipedia.org/wiki/List_of_Vietnamese_dishes',
  }));

const containsAny = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(normalizeText(keyword)));

const inferCategory = (name: string) => {
  const text = normalizeText(name);
  if (containsAny(text, ['pho', 'bun', 'mi', 'mien', 'hu tieu', 'banh canh', 'cao lau'])) return 'Món nước';
  if (containsAny(text, ['com', 'xoi'])) return 'Cơm/Xôi';
  if (containsAny(text, ['banh mi'])) return 'Bánh mì';
  if (containsAny(text, ['banh'])) return 'Bánh';
  if (containsAny(text, ['che', 'tau hu', 'sua chua'])) return 'Tráng miệng';
  if (containsAny(text, ['goi', 'nom'])) return 'Gỏi/Nộm';
  if (containsAny(text, ['canh', 'lau'])) return 'Canh/Lẩu';
  if (containsAny(text, ['chay', 'dau hu'])) return 'Món chay';
  if (containsAny(text, ['ca phe', 'nuoc', 'tra'])) return 'Đồ uống';
  if (containsAny(text, ['bo', 'thit', 'ca ', 'cha', 'nem'])) return 'Món mặn';
  return 'Món Việt';
};

const inferMealTypes = (name: string, category: string): MealType[] => {
  const text = normalizeText(`${category} ${name}`);
  if (containsAny(text, ['ca phe', 'nuoc', 'tra', 'che', 'sua chua', 'banh cam', 'banh bo', 'banh chuoi', 'banh da lon'])) return ['snack', 'breakfast'];
  if (containsAny(text, ['xoi', 'banh mi', 'banh cuon', 'banh bao', 'banh gio', 'chao', 'pho'])) return ['breakfast', 'lunch', 'dinner'];
  if (containsAny(text, ['com', 'bun', 'mi', 'mien', 'hu tieu', 'canh', 'lau', 'goi', 'nom'])) return ['lunch', 'dinner'];
  return ['lunch', 'dinner'];
};

const inferServingUnit = (name: string, category: string) => {
  const text = normalizeText(`${category} ${name}`);
  if (containsAny(text, ['pho', 'bun', 'mi', 'mien', 'hu tieu', 'banh canh', 'chao', 'canh', 'lau', 'che'])) return '1 tô';
  if (containsAny(text, ['ca phe', 'nuoc', 'tra'])) return '1 ly';
  if (containsAny(text, ['banh', 'goi cuon', 'nem', 'cha gio'])) return '1 phần';
  return '1 phần';
};

const inferGoals = (name: string, category: string) => {
  const text = normalizeText(`${category} ${name}`);
  const goals = ['Bình thường', 'Giữ dáng'];
  if (containsAny(text, ['chay', 'dau hu', 'rau', 'nom', 'goi'])) goals.push('Ăn chay');
  if (containsAny(text, ['goi', 'nom', 'rau', 'canh', 'dau hu', 'pho ga', 'chao', 'cuon'])) goals.push('Eat Clean');
  if (containsAny(text, ['bo', 'ga', 'ca', 'tom', 'thit', 'cha', 'trung', 'dau hu'])) goals.push('Ăn nhiều đạm (High Protein)', 'Tăng cơ');
  if (containsAny(text, ['goi', 'nom', 'rau', 'canh'])) goals.push('Giảm cân');
  return [...new Set(goals)];
};

const inferAllergens = (name: string) => {
  const text = normalizeText(name);
  const allergens: string[] = [];
  if (containsAny(text, ['tom', 'muc', 'cua', 'ghe', 'ngheu', 'so', 'oc'])) allergens.push('hải sản');
  if (containsAny(text, ['ca ', 'cha ca'])) allergens.push('cá');
  if (containsAny(text, ['trung', 'ca phe trung'])) allergens.push('trứng');
  if (containsAny(text, ['sua', 'sua chua'])) allergens.push('sữa');
  if (containsAny(text, ['dau hu', 'dau phu'])) allergens.push('đậu nành');
  if (containsAny(text, ['banh mi', 'mi quang', 'mi vit'])) allergens.push('gluten');
  return allergens;
};

const inferPrice = (name: string): PriceLevel => {
  const text = normalizeText(name);
  if (containsAny(text, ['ca hoi', 'cua', 'ghe', 'tom', 'bo luc lac', 'lau'])) return 'Thoải mái';
  if (containsAny(text, ['xoi', 'chao', 'dau hu', 'rau', 'com trang', 'banh mi', 'che', 'tra da'])) return 'Tiết kiệm';
  return 'Trung bình';
};

const inferNutrition = (name: string, category: string) => {
  const text = normalizeText(`${category} ${name}`);
  if (containsAny(text, ['ca phe', 'nuoc', 'tra'])) return { calories: 90, protein: 1, carbs: 18, fat: 2 };
  if (containsAny(text, ['che', 'sua chua', 'banh cam', 'banh bo', 'banh chuoi', 'banh da lon'])) return { calories: 280, protein: 6, carbs: 48, fat: 7 };
  if (containsAny(text, ['pho', 'bun', 'mi', 'mien', 'hu tieu', 'banh canh', 'cao lau'])) return { calories: 520, protein: 26, carbs: 68, fat: 14 };
  if (containsAny(text, ['com', 'xoi'])) return { calories: 620, protein: 28, carbs: 78, fat: 20 };
  if (containsAny(text, ['banh mi'])) return { calories: 480, protein: 22, carbs: 58, fat: 18 };
  if (containsAny(text, ['goi', 'nom', 'cuon'])) return { calories: 280, protein: 18, carbs: 28, fat: 9 };
  if (containsAny(text, ['canh'])) return { calories: 180, protein: 12, carbs: 16, fat: 7 };
  if (containsAny(text, ['bo', 'thit', 'ca', 'cha', 'nem'])) return { calories: 430, protein: 30, carbs: 24, fat: 23 };
  if (containsAny(text, ['chay', 'dau hu'])) return { calories: 360, protein: 18, carbs: 42, fat: 13 };
  return { calories: 380, protein: 18, carbs: 45, fat: 13 };
};

const enrichDish = (dish: SourceDish): FoodPayload => {
  const category = inferCategory(dish.name);
  const nutrition = inferNutrition(dish.name, category);
  return {
    name: dish.name,
    category,
    ...nutrition,
    serving_unit: inferServingUnit(dish.name, category),
    image_url: null,
    meal_type: inferMealTypes(dish.name, category),
    goal_type: inferGoals(dish.name, category),
    allergens: inferAllergens(dish.name),
    price_level: inferPrice(dish.name),
    cooking_time_minutes: category === 'Đồ uống' || category === 'Tráng miệng' ? 5 : 25,
    region: 'Vietnam',
    is_easy_to_prepare: ['Đồ uống', 'Tráng miệng', 'Gỏi/Nộm'].includes(category),
  };
};

const loadSourceCatalog = async () => {
  const sourceGroups = await Promise.allSettled([
    getWikidataDishes(),
    getWikipediaCategoryDishes(),
    getWikipediaListDishes(),
  ]);

  const loaded = sourceGroups.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failed = sourceGroups
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason?.message || String(result.reason));
  const sourceDishes = unique([...loaded, ...getExtraCanonicalDishes()], (item) => normalizeText(item.name));
  const foods = sourceDishes.map(enrichDish);
  return { sourceDishes, foods, failed };
};

const parseFlags = () => {
  const args = new Set(process.argv.slice(2));
  return {
    apply: args.has('--apply'),
    replace: args.has('--replace'),
    force: args.has('--force'),
  };
};

const countReferences = async () => {
  const [weeklyRes, dailyRes] = await Promise.all([
    supabase.from('weekly_food_items').select('id', { count: 'exact', head: true }),
    supabase.from('daily_meal_logs').select('id', { count: 'exact', head: true }),
  ]);
  if (weeklyRes.error) throw weeklyRes.error;
  if (dailyRes.error) throw dailyRes.error;
  return {
    weeklyFoodItems: weeklyRes.count || 0,
    dailyMealLogs: dailyRes.count || 0,
  };
};

const applyImport = async (foods: FoodPayload[], options: ReturnType<typeof parseFlags>) => {
  if (options.replace) {
    const refs = await countReferences();
    if ((refs.weeklyFoodItems > 0 || refs.dailyMealLogs > 0) && !options.force) {
      throw new Error(
        `Refusing replace: foods are referenced by ${refs.weeklyFoodItems} weekly_food_items and ${refs.dailyMealLogs} daily_meal_logs. Re-run with --replace --force only if you accept broken old references.`
      );
    }

    const deleteRes = await supabase.from('foods').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteRes.error) throw deleteRes.error;
  }

  const existingRes = await supabase.from('foods').select('id, name');
  if (existingRes.error) throw existingRes.error;
  const existingByName = new Map((existingRes.data || []).map((row: any) => [normalizeText(row.name), String(row.id)]));

  let inserted = 0;
  let updated = 0;
  for (const food of foods) {
    const existingId = existingByName.get(normalizeText(food.name));
    if (existingId) {
      const updateRes = await supabase.from('foods').update(food).eq('id', existingId);
      if (updateRes.error) throw updateRes.error;
      updated += 1;
      continue;
    }

    const insertRes = await supabase.from('foods').insert(food);
    if (insertRes.error) throw insertRes.error;
    inserted += 1;
  }

  return { inserted, updated };
};

const summarize = (foods: FoodPayload[]) => {
  const byCategory = new Map<string, number>();
  const byPrice = new Map<string, number>();
  const byMeal = new Map<string, number>();

  foods.forEach((food) => {
    byCategory.set(food.category, (byCategory.get(food.category) || 0) + 1);
    byPrice.set(food.price_level, (byPrice.get(food.price_level) || 0) + 1);
    food.meal_type.forEach((meal) => byMeal.set(meal, (byMeal.get(meal) || 0) + 1));
  });

  const sorted = (map: Map<string, number>) =>
    Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));

  return {
    byCategory: sorted(byCategory),
    byPrice: sorted(byPrice),
    byMeal: sorted(byMeal),
  };
};

const run = async () => {
  const options = parseFlags();
  const { sourceDishes, foods, failed } = await loadSourceCatalog();
  const refs = await countReferences();

  console.log(`Loaded source dishes: ${sourceDishes.length}`);
  console.log(`Food payload rows: ${foods.length}`);
  console.log(`Reference counts: ${JSON.stringify(refs)}`);
  console.log(`Summary: ${JSON.stringify(summarize(foods), null, 2)}`);
  console.log(`Sample: ${JSON.stringify(foods.slice(0, 12).map((food) => food.name), null, 2)}`);
  if (failed.length > 0) console.warn(`Source warnings: ${failed.join(' | ')}`);

  if (!options.apply) {
    console.log('Dry run only. Re-run with --apply to upsert. Use --apply --replace to clear foods first.');
    return;
  }

  const result = await applyImport(foods, options);
  console.log(`Import applied: ${JSON.stringify(result)}`);
};

run().catch((error) => {
  console.error('Failed to import sourced Vietnamese foods:', error?.message || error);
  process.exit(1);
});
