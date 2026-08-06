import type { RequestHandler, Response } from 'express';

type ErrorPayload = { error: { code: string; message: string; requestId: string } };

const isConfigurationFailure = (body: unknown): boolean => {
  if (typeof body !== 'object' || body === null) return false;
  const value = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
  if (typeof value !== 'string') return false;
  return /\b(missing|not configured|configuration)\b/i.test(value) && /(key|token|url|provider|service|groq|gemini|supabase)/i.test(value);
};

const byStatus = (status: number, body: unknown): Pick<ErrorPayload['error'], 'code' | 'message'> => {
  if (status === 400 || status === 422) return { code: 'VALIDATION_ERROR', message: 'Invalid request' };
  if (status === 401) return { code: 'UNAUTHORIZED', message: 'Unauthorized' };
  if (status === 403) return { code: 'FORBIDDEN', message: 'Forbidden' };
  if (status === 404) return { code: 'NOT_FOUND', message: 'Not found' };
  if (status === 409) return { code: 'CONFLICT', message: 'Conflict' };
  if (status === 429) return { code: 'QUOTA_EXCEEDED', message: 'Request limit exceeded' };
  if (isConfigurationFailure(body)) return { code: 'INTERNAL_CONFIGURATION_ERROR', message: 'Service is temporarily unavailable' };
  if (status === 502 || status === 503) return { code: 'EXTERNAL_PROVIDER_ERROR', message: 'A dependent service is unavailable' };
  return { code: 'INTERNAL_ERROR', message: 'Internal server error' };
};

const isContract = (body: unknown): body is ErrorPayload => {
  const error = (body as ErrorPayload | undefined)?.error;
  return Boolean(error && typeof error === 'object' && typeof error.code === 'string' && typeof error.message === 'string' && typeof error.requestId === 'string');
};

const isLegacyError = (body: unknown, status: number): boolean =>
  status >= 400 && typeof body === 'object' && body !== null && (
    typeof (body as { error?: unknown }).error === 'string' ||
    typeof (body as { message?: unknown }).message === 'string'
  );

const normalizeStatus = (status: number): number => status === 422 ? 400 : status;

export const legacyErrorContractMiddleware: RequestHandler = (req, res, next) => {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let serializingJson = false;
  const sendJson = (body: unknown): Response => {
    serializingJson = true;
    try {
      return originalJson(body);
    } finally {
      serializingJson = false;
    }
  };
  const respond = (status: number, body: unknown): Response => {
    const normalizedStatus = normalizeStatus(status);
    const mapped = byStatus(normalizedStatus, body);
    res.status(normalizedStatus);
    return sendJson({ error: { ...mapped, requestId: req.requestId } });
  };

  res.json = ((body: unknown) => {
    if (!isContract(body) && isLegacyError(body, res.statusCode)) return respond(res.statusCode, body);
    return sendJson(body);
  }) as Response['json'];

  res.send = ((body: unknown) => {
    if (serializingJson) return originalSend(body);
    if (res.statusCode >= 400 && (typeof body === 'string' || isLegacyError(body, res.statusCode))) return respond(res.statusCode, body);
    return originalSend(body);
  }) as Response['send'];
  next();
};
