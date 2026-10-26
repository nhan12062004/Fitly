import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMarketPriceSearchQuery, fetchRealtimeMarketPrices } from '../src/services/ai/marketPriceService';
import { hasRecentAuthentication } from '../src/auth/recentAuthentication';
import { sanitizeSentryEvent } from '../src/lib/observability';
import { sanitizeOperationalMessage } from '../src/lib/operationalLogger';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('privacy boundaries', () => {
  it('only sends allowlisted food labels to search, stripping all personal free text', () => {
    const query = buildMarketPriceSearchQuery('Tôi là Nguyễn Văn A, đang uống insulin vì tiểu đường; giá thịt bò hôm nay bao nhiêu?');
    expect(query).toBe('giá thịt bò hôm nay thị trường Việt Nam');
    expect(buildMarketPriceSearchQuery('Tên tôi là An, thuốc của tôi giá bao nhiêu?')).toBeNull();
  });
  it('does not call search by default or send an unrecognized query when enabled', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch',fetch); vi.stubEnv('MARKET_PRICE_SEARCH_ENABLED','false');
    await expect(fetchRealtimeMarketPrices('giá thịt bò')).resolves.toBeNull();
    vi.stubEnv('MARKET_PRICE_SEARCH_ENABLED','true');
    await expect(fetchRealtimeMarketPrices('giá thuốc bí mật của tôi')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires a recent authentication method, not a freshly refreshed token', () => {
    const now = 1_800_000_000_000;
    const token = (payload: object) => `verified.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
    expect(hasRecentAuthentication(token({iat:now/1000,amr:[{method:'password',timestamp:now/1000-30}]}),now)).toBe(true);
    expect(hasRecentAuthentication(token({iat:now/1000,amr:[{method:'password',timestamp:now/1000-3600}]}),now)).toBe(false);
    expect(hasRecentAuthentication(token({iat:now/1000}),now)).toBe(false);
    expect(hasRecentAuthentication(token({amr:[{method:'password',timestamp:now/1000+3600}]}),now)).toBe(false);
  });
  it('removes sensitive messages, request content, breadcrumbs and arbitrary SDK context from error reporting', () => {
    const secret = 'private-health-information';
    const cleaned = sanitizeSentryEvent({
      type:undefined,event_id:'test',request:{data:secret,url:`https://example.invalid/?query=${secret}`},message:secret,
      user:{email:secret},extra:{secret},breadcrumbs:[{message:secret}],tags:{code:'INTERNAL_ERROR'},
      exception:{values:[{type:'Error',value:secret,stacktrace:{frames:[{filename:'app.ts',lineno:1,vars:{secret}}]}}]},
    });
    expect(JSON.stringify(cleaned)).not.toContain(secret);
    expect(cleaned.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe('app.ts');
    expect(sanitizeOperationalMessage(new Error(secret))).not.toContain(secret);
  });
});
