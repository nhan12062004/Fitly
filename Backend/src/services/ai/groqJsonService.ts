import { AppError, InternalConfigurationError } from '../../http/errors';
import { adminSupabase } from '../../config/Supabase';
import { aiOperationContext } from '../../lib/aiExecutionContext';

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

type JsonRequest = {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  json?: boolean;
};

/** Bound the whole request so model fallback finishes before the mobile timeout. */
export const callGroqCompletion = async (payload: JsonRequest): Promise<any> => {
  if (process.env.AI_ENABLED === 'false') throw new AppError(503,'AI_DISABLED','AI đang tạm dừng.');
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
    const positive = (value: string | undefined, fallback: number) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
    // UTF-8 bytes plus output allowance conservatively bound token usage when
    // a provider timeout leaves the actual billable usage unknown.
    const estimate = Buffer.byteLength(JSON.stringify(payload.messages),'utf8') + (payload.max_tokens ?? 1400) + 512;
    const admitted = await adminSupabase.rpc('reserve_ai_provider_call', {
      p_tokens: estimate, p_daily_calls: positive(process.env.AI_DAILY_PROVIDER_CALL_LIMIT,10000),
      p_daily_tokens: positive(process.env.AI_DAILY_TOKEN_LIMIT,10_000_000),
      p_concurrent: positive(process.env.AI_MAX_CONCURRENT,8),
    });
    if (admitted.error || !admitted.data) throw new AppError(503,'AI_CAPACITY_LIMIT','AI đang bận hoặc đã đạt ngân sách xử lý. Vui lòng thử lại sau.');
    let actualTokens: number | null = null;
    try {
      const remainingAfterAdmission = deadline-Date.now();
      if (remainingAfterAdmission <= 0) break;
      const execution = aiOperationContext.getStore();
      const providerTimeout = AbortSignal.timeout(Math.min(12_000,remainingAfterAdmission));
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: execution ? AbortSignal.any([execution.signal,providerTimeout]) : providerTimeout,
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
      if (response.ok && !result?.error && result?.choices?.[0]?.message?.content) {
        if (Number.isSafeInteger(result.usage?.total_tokens) && result.usage.total_tokens > 0) actualTokens = result.usage.total_tokens;
        return result;
      }

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
    } finally {
      // A failed release only keeps this two-minute lease occupied; it cannot
      // create additional admission or reset the conservative daily charge.
      try { await adminSupabase.from('ai_provider_calls').update({ active:false, actual_tokens:actualTokens }).eq('id',admitted.data); }
      catch { /* The bounded lease expires; the conservative token charge stays. */ }
    }
  }

  throw new AppError(503, rateLimited ? 'AI_TOKEN_LIMIT' : 'AI_PROVIDER_ERROR', rateLimited
    ? 'AI đang quá tải. Vui lòng thử lại sau ít phút.'
    : 'AI tạm thời chưa tạo được kế hoạch. Vui lòng thử lại sau.');
};

export const callGroqJson = (payload: Omit<JsonRequest, 'json'>) => callGroqCompletion({ ...payload, json: true });
