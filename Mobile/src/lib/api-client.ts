import { apiConfigurationMessage, isApiConfigured, runtimeConfig } from '@/lib/runtime-config';
import { supabase } from '@/lib/supabase';
import { invalidateResources } from '@/lib/query-cache';
import { ensureAiConsent } from '@/lib/ai-consent';

const uncertainRequests = new Map<string, string>();
let requestAccount: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  const account = session?.user.id || null;
  if (account !== requestAccount) uncertainRequests.clear();
  requestAccount = account;
});

const publicErrors: Record<string, string> = {
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Tài khoản chưa có quyền thực hiện thao tác này.',
  QUOTA_EXCEEDED: 'Bạn đã dùng hết lượt hiện có. Vui lòng thử lại sau.',
  EXTERNAL_PROVIDER_ERROR: 'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau ít phút.',
  INTERNAL_CONFIGURATION_ERROR: 'Dịch vụ đang được bảo trì. Vui lòng thử lại sau.',
  INTERNAL_ERROR: 'Có lỗi khi xử lý yêu cầu. Vui lòng thử lại.',
};

type ErrorPayload =
  | { error?: { code?: string; message?: string; requestId?: string } }
  | { error?: string };

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(status: number, payload: ErrorPayload) {
    const normalized = typeof payload.error === 'object' ? payload.error : undefined;
    super(((normalized?.code && publicErrors[normalized.code]) || normalized?.message) ?? (typeof payload.error === 'string' ? payload.error : 'Không thể xử lý yêu cầu.'));
    this.name = 'ApiClientError';
    this.status = status;
    this.code = normalized?.code;
    this.requestId = normalized?.requestId;
  }
}

type ApiRequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export const apiRequest = async <T>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
  if (!isApiConfigured || !runtimeConfig.apiUrl) {
    throw new Error(apiConfigurationMessage ?? 'EXPO_PUBLIC_API_URL is not configured.');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ApiClientError(401, { error: 'Unauthorized' });
  if (options.method === 'POST' && (/^\/api\/ai-coach\/generate-/.test(path) || ['/api/ai/chat', '/api/ai/coach-command'].includes(path))) {
    if (!await ensureAiConsent(session.user.id)) throw new Error('Bạn chưa đồng ý chia sẻ dữ liệu để sử dụng AI.');
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id !== session.user.id) throw new Error('Tài khoản đã thay đổi. Vui lòng thử lại.');
  }

  const durableAction = options.method?.toUpperCase() === 'POST' && (/^\/api\/ai-coach\//.test(path) || ['/api/ai/chat','/api/ai/apply-adjustment','/api/meal-plans/save'].includes(path));
  const retryIdentity = durableAction && !options.headers?.['Idempotency-Key'] ? JSON.stringify([session.user.id,path,options.body ?? null]) : null;
  const requestKey = (retryIdentity && uncertainRequests.get(retryIdentity)) || `request-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  if (retryIdentity) uncertainRequests.set(retryIdentity,requestKey);

  const { timeoutMs = 15_000, signal: suppliedSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (suppliedSignal?.aborted) abort();
  suppliedSignal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);

  try {
    const response = await fetch(`${runtimeConfig.apiUrl}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase()) ? { 'Idempotency-Key': requestKey } : {}),
        Authorization: `Bearer ${session.access_token}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch {
      throw new ApiClientError(response.status >= 400 ? response.status : 502, { error: 'Máy chủ chưa phản hồi đúng định dạng. Vui lòng thử lại sau.' });
    }
    if (retryIdentity && (response.ok || (response.status < 500 && response.status !== 409) || response.headers.get('Idempotency-Replayed') === 'true')) uncertainRequests.delete(retryIdentity);
    if (!response.ok) throw new ApiClientError(response.status, payload);
    if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
      if (path === '/api/ai/chat') void invalidateResources('home', 'wellness', 'progress', 'quota');
      else if (path === '/api/workout/daily-exercises/from-plan') void invalidateResources('home', 'progress');
      else if (/workout|apply-adjustment/.test(path)) void invalidateResources('workout', 'meals', 'home', 'progress', 'quota', 'challenges', 'challenge');
      else if (/ai|nutrition/.test(path)) void invalidateResources('quota');
      if (/profile|subscription/.test(path)) void invalidateResources('account', 'profile', 'quota', 'home');
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Kết nối mất nhiều thời gian hơn dự kiến. Vui lòng thử lại.');
    if (error instanceof TypeError) throw new Error('Không thể kết nối. Hãy kiểm tra Internet rồi thử lại.');
    throw error;
  } finally {
    clearTimeout(timeout);
    suppliedSignal?.removeEventListener('abort', abort);
  }
};
