import { createHash, randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { adminSupabase } from '../../config/Supabase';
import { AppError, ExternalProviderError, ValidationError } from '../../http/errors';
import { logOperational } from '../../lib/operationalLogger';
import { aiOperationContext, type AiExecution } from '../../lib/aiExecutionContext';
export { aiOperationContext } from '../../lib/aiExecutionContext';

import type { AiQuotaKey } from '../../../../shared/aiQuota';
export type { AiQuotaKey } from '../../../../shared/aiQuota';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bounded = (value: string | undefined, fallback: number, max: number) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= max ? number : fallback;
};

export type OperationAccess = {
  quotaWindow: { startsAt: string; endsAt: string | null };
  quotas: { limits: Record<AiQuotaKey, number> };
};

/** Capture a JSON handler's response, commit its result, then acknowledge it.
 * A disconnected client can retry its key without executing an action twice.
 * A process crash leaves the reservation charged (unknown outcome), never
 * refunds it automatically and never re-executes the same key.
 */
export function createAiOperationWrapper(getAccess: (userId: string) => Promise<OperationAccess>) {
  return (handler: RequestHandler, quota: AiQuotaKey | null | ((req: Request) => Promise<AiQuotaKey>)): RequestHandler => async (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
    if (process.env.AI_ENABLED === 'false') return next(new AppError(503, 'AI_DISABLED', 'AI đang tạm dừng. Vui lòng thử lại sau.'));
    const suppliedKey = req.get('Idempotency-Key');
    if (suppliedKey && (suppliedKey.length > 200 || !/^[\w:.-]+$/.test(suppliedKey))) return next(new ValidationError('Idempotency-Key không hợp lệ.'));
    // Calls without a key receive one; only an explicit key supports replay.
    const key = suppliedKey || randomUUID();
    res.setHeader('Idempotency-Key', key);
    let operationId: string | undefined;
    try {
      const userId = req.auth.user.id;
      const quotaKey = typeof quota === 'function' ? await quota(req) : quota;
      const access = await getAccess(userId);
      const { data: operation, error } = await adminSupabase.rpc('begin_api_operation', {
        p_user_id: userId, p_action: req.path,
        p_key_hash: hash(key), p_request_hash: hash(JSON.stringify({ path: req.path, body: req.body ?? null })),
        p_quota_key: quotaKey, p_limit: quotaKey ? access.quotas.limits[quotaKey] : null,
        p_starts_at: access.quotaWindow.startsAt, p_ends_at: access.quotaWindow.endsAt,
        p_max_concurrent: bounded(process.env.AI_MAX_CONCURRENT, 8, 100),
        p_daily_limit: bounded(process.env.AI_DAILY_REQUEST_LIMIT, 5000, 1_000_000),
      });
      if (error || !operation) throw new ExternalProviderError();
      if (operation.kind === 'replay') {
        if (!operation.body) return next(new AppError(410, 'RESULT_EXPIRED', 'Kết quả cũ đã hết hạn lưu. Hãy tải lại dữ liệu.'));
        res.setHeader('Idempotency-Replayed', 'true');
        return res.status(operation.status).json(operation.body);
      }
      const rejected: Record<string, AppError> = {
        conflict: new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Mã yêu cầu đã được dùng cho nội dung khác.'),
        busy: new AppError(409, 'AI_REQUEST_IN_PROGRESS', 'Một yêu cầu đang xử lý. Hãy chờ rồi tải lại dữ liệu.'),
        overloaded: new AppError(503, 'AI_BUSY', 'AI đang bận. Vui lòng thử lại sau.'),
        budget: new AppError(503, 'AI_DAILY_LIMIT', 'AI đã đạt giới hạn xử lý hôm nay. Vui lòng thử lại sau.'),
        exhausted: new AppError(403, 'AI_QUOTA_EXCEEDED', 'Bạn đã dùng hết lượt AI của gói hiện tại.'),
      };
      if (rejected[operation.kind]) return next(rejected[operation.kind]);
      if (operation.kind !== 'started' || typeof operation.id !== 'string') throw new ExternalProviderError();
      operationId = operation.id;
      let status = 200;
      let body: any;
      let failure: unknown;
      const captured = new Proxy(res, {
        get(target, property) {
          if (property === 'status') return (value: number) => { status = value; return captured; };
          if (property === 'json') return (value: unknown) => { body = value; return captured; };
          return Reflect.get(target, property);
        },
      });
      const execution: AiExecution = { id:operationId!, userId, quotaKey, signal:AbortSignal.timeout(90_000), mutationMayHaveCommitted:false, mutationAttempts:0 };
      await aiOperationContext.run(execution, async () => {
        await handler(req, captured, (error?: unknown) => { failure = error || new Error('Handler did not return a response'); });
      });
      if (failure) {
        const appError = failure instanceof AppError ? failure : new ExternalProviderError();
        status = appError.status;
        body = { error: { code: appError.code, message: appError.expose ? appError.publicMessage : 'Dịch vụ tạm thời không khả dụng.', requestId: req.requestId } };
      }
      if (body === undefined) throw new Error('AI handler must return JSON');
      const unused = body?.alreadyApplied === true || body?.data?.source === 'existing' || body?.data?.alreadyGenerated === true;
      const { error: finishError } = await adminSupabase.rpc('finish_api_operation', {
        p_id: operationId, p_status: status, p_body: body,
        p_charge: !unused && (status < 400 || (status >= 500 && execution.mutationMayHaveCommitted)),
      });
      if (finishError) throw new ExternalProviderError();
      return res.status(status).json(body);
    } catch (error) {
      // Keep an unknown operation charged/pending: refunding after a possibly
      // committed mutation would allow free duplicate work on a fresh key.
      logOperational({ level: 'error', event: 'ai_operation_failed', requestId: req.requestId, message: error });
      return next(error instanceof AppError ? error : new ExternalProviderError());
    }
  };
}

export const resolveAdjustmentQuota = async (req: Request): Promise<AiQuotaKey> => {
  const { data, error } = await adminSupabase.from('ai_plan_adjustments').select('plan_type')
    .eq('id', String(req.body?.adjustmentId || '')).eq('user_id', req.auth!.user.id).maybeSingle();
  if (error || !data) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy đề xuất.');
  return data.plan_type === 'meal' ? 'mealAdjustments' : 'workoutAdjustments';
};
