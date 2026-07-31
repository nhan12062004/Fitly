import { apiConfigurationMessage, isApiConfigured, runtimeConfig } from '@/lib/runtime-config';
import { supabase } from '@/lib/supabase';

type ErrorPayload =
  | { error?: { code?: string; message?: string; requestId?: string } }
  | { error?: string };

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(status: number, payload: ErrorPayload) {
    const normalized = typeof payload.error === 'object' ? payload.error : undefined;
    super(normalized?.message ?? (typeof payload.error === 'string' ? payload.error : 'Request failed'));
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

  const { timeoutMs, signal: suppliedSignal, ...fetchOptions } = options;
  const controller = !suppliedSignal && timeoutMs ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(`${runtimeConfig.apiUrl}${path}`, {
      ...fetchOptions,
      signal: suppliedSignal ?? controller?.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) throw new ApiClientError(response.status, payload);
    return payload as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
