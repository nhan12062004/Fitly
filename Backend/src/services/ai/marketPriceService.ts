import { normalizeVietnameseText } from './aiRouterService';

export type MarketPriceSearchResult = {
  query: string;
  searchedAt: string;
  snippets: string[];
  summary: string;
};

const VIETNAM_FOOD_PRICE_KEYWORDS = [
  'gia thit lon',
  'gia thit heo',
  'gia thit bo',
  'gia uc ga',
  'gia trung ga',
  'gia thuc pham',
  'gia cho',
  'gia thi truong',
  'bao nhieu 1kg',
  'bao nhieu tien 1kg',
  'gia hom nay',
];

export const isMarketPriceQuery = (userMessage: string): boolean => {
  const normalized = normalizeVietnameseText(userMessage);
  return VIETNAM_FOOD_PRICE_KEYWORDS.some((kw) => normalized.includes(kw));
};

const cleanHtmlTags = (html: string): string =>
  html
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const SEARCH_FOODS = [
  ['thit lon', 'thịt lợn'], ['thit heo', 'thịt heo'], ['thit bo', 'thịt bò'],
  ['uc ga', 'ức gà'], ['thit ga', 'thịt gà'], ['trung ga', 'trứng gà'],
  ['ca hoi', 'cá hồi'], ['ca thu', 'cá thu'], ['dau phu', 'đậu phụ'],
  ['gao', 'gạo'], ['yen mach', 'yến mạch'], ['khoai lang', 'khoai lang'],
] as const;

/** Construct a query from constants only. Names, diagnoses, medication, free
 * text and chat history can never reach the search provider through this path. */
export const buildMarketPriceSearchQuery = (message: string): string | null => {
  const normalized = ` ${normalizeVietnameseText(message).replace(/[^a-z0-9 ]/g, ' ')} `;
  const foods = SEARCH_FOODS.filter(([term]) => normalized.includes(` ${term} `)).map(([, label]) => label);
  return foods.length ? `giá ${[...new Set(foods)].join(', ')} hôm nay thị trường Việt Nam` : null;
};

const priceCache = new Map<string, { expiresAt: number; result: MarketPriceSearchResult }>();

export const fetchRealtimeMarketPrices = async (userQuery: string): Promise<MarketPriceSearchResult | null> => {
  if (process.env.MARKET_PRICE_SEARCH_ENABLED !== 'true') return null;
  const searchQuery = buildMarketPriceSearchQuery(userQuery);
  if (!searchQuery) return null;
  const cached = priceCache.get(searchQuery);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  try {
    const todayStr = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(searchUrl, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      console.warn('[marketPriceService] Web search request failed:', response.status);
      return null;
    }

    const htmlText = await response.text();
    const cleanText = cleanHtmlTags(htmlText);

    // Extract text snippets mentioning price units like "đồng", "đ/kg", "000đ", "ngàn"
    const sentences = cleanText
      .split(/[.!?\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15 && s.length < 250)
      .filter((s) => /đồng|đ\/kg|k\/kg|000|ngàn|triệu|thịt|giá/i.test(s));

    const uniqueSnippets = Array.from(new Set(sentences)).slice(0, 6);

    if (uniqueSnippets.length === 0) {
      return null;
    }

    const result = {
      query: searchQuery,
      searchedAt: todayStr,
      snippets: uniqueSnippets,
      summary: uniqueSnippets.join(' | '),
    };
    if (priceCache.size >= 64) priceCache.delete(priceCache.keys().next().value!);
    priceCache.set(searchQuery, { result, expiresAt: Date.now() + 10 * 60_000 });
    return result;
  } catch (error: any) {
    console.warn('[marketPriceService] Search unavailable');
    return null;
  }
};
