import { AppError, InternalConfigurationError } from '../../http/errors';

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

type JsonRequest = {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  json?: boolean;
};

/** Bound the whole request so model fallback finishes before the mobile timeout. */
export const callGroqCompletion = async (payload: JsonRequest): Promise<any> => {
  if (!process.env.GROQ_API_KEY) throw new InternalConfigurationError();
  const models = [...new Set([
    process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    DEFAULT_GROQ_MODEL,
    'openai/gpt-oss-20b',
  ])];
  const deadline = Date.now() + 25_000;
  let rateLimited = false;

  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(Math.min(12_000, remaining)),
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: payload.messages,
          temperature: payload.temperature ?? 0.35,
          max_tokens: payload.max_tokens ?? 1400,
          ...(payload.json === false ? {} : { response_format: { type: 'json_object' } }),
        }),
      });
      const result: any = await response.json().catch(() => null);
      if (response.ok && !result?.error && result?.choices?.[0]?.message?.content) return result;

      const code = result?.error?.code;
      rateLimited = response.status === 429;
      // Provider credentials and malformed requests cannot be fixed by another model.
      if (response.status === 401 || response.status === 403) throw new InternalConfigurationError();
      const retryable = response.status === 404 || response.status === 429 || response.status >= 500
        || code === 'model_not_found' || code === 'model_decommissioned';
      if (!retryable) break;
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Network failures and timeouts may recover on the next supported model.
    }
  }

  throw new AppError(503, rateLimited ? 'AI_TOKEN_LIMIT' : 'AI_PROVIDER_ERROR', rateLimited
    ? 'AI đang quá tải. Vui lòng thử lại sau ít phút.'
    : 'AI tạm thời chưa tạo được kế hoạch. Vui lòng thử lại sau.');
};

export const callGroqJson = (payload: Omit<JsonRequest, 'json'>) => callGroqCompletion({ ...payload, json: true });
