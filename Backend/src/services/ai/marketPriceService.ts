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

export const fetchRealtimeMarketPrices = async (userQuery: string): Promise<MarketPriceSearchResult | null> => {
  try {
    const todayStr = new Date().toLocaleDateString('vi-VN');
    const searchQuery = `${userQuery} hôm nay giá thị trường Việt Nam`;
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(searchUrl, {
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

    return {
      query: searchQuery,
      searchedAt: todayStr,
      snippets: uniqueSnippets,
      summary: uniqueSnippets.join(' | '),
    };
  } catch (error: any) {
    console.error('[marketPriceService] Real-time price search error:', error?.message || error);
    return null;
  }
};
