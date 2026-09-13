import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { validateBody } from '../../http/validation';
import { AppError, UnauthorizedError } from '../../http/errors';
import { syncStoreSubscription } from '../../services/storeSubscriptionService';

export function validWebhookAuthorization(value: string | undefined, secret = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION) {
  if (!value || !secret) return false;
  const left = Buffer.from(value);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const storeRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
storeRouter.post('/subscriptions/sync', limiter, requireAuth, validateBody(z.object({}).strict()), async (req, res, next) => {
  try { res.json({ data: await syncStoreSubscription(req.auth!.user.id) }); }
  catch (error) { next(error instanceof AppError ? error : new AppError(503, 'SUBSCRIPTION_UNAVAILABLE', 'Chưa đồng bộ được gói đăng ký. Vui lòng thử lại.')); }
});

const webhookSchema = z.object({ event: z.object({
  type: z.string(), app_user_id: z.string().optional(),
  transferred_from: z.array(z.string()).optional(), transferred_to: z.array(z.string()).optional(),
}) });
storeRouter.post('/subscriptions/webhook', async (req, res, next) => {
  if (!validWebhookAuthorization(req.headers.authorization)) return next(new UnauthorizedError());
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) return res.sendStatus(400);
  const event = parsed.data.event;
  if (event.type === 'TEST') return res.json({ success: true });
  const ids = [...new Set([event.app_user_id, ...(event.transferred_from || []), ...(event.transferred_to || [])])]
    .filter((id): id is string => Boolean(id && z.string().uuid().safeParse(id).success));
  try {
    // Fetch current rights instead of trusting event order or granting from event fields.
    for (const id of ids) await syncStoreSubscription(id);
    return res.json({ success: true });
  } catch (error) { return next(error); } // Non-2xx causes provider delivery retry.
});
