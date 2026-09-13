import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { adminSupabase } from '../../config/Supabase';
import { AppError, ForbiddenError } from '../../http/errors';
import { validateBody } from '../../http/validation';

export const feedbackRouter = Router();
feedbackRouter.use('/admin/feedback', requireAuth, async (req, _res, next) => {
  const { data, error } = await adminSupabase.from('profiles').select('role').eq('id', req.auth!.user.id).maybeSingle();
  if (error || data?.role !== 'admin') return next(new ForbiddenError());
  next();
});
feedbackRouter.get('/admin/feedback', async (_req, res, next) => {
  const { data, error } = await adminSupabase.from('app_feedback').select('id, user_id, category, message, context, status, created_at, target_type, target_id').order('created_at', { ascending: false }).limit(100);
  if (error) return next(new AppError(503, 'FEEDBACK_UNAVAILABLE', 'Chưa tải được phản hồi.'));
  return res.json({ data });
});
feedbackRouter.patch('/admin/feedback/:id', validateBody(z.object({ status: z.enum(['new', 'reviewing', 'resolved']) }).strict()), async (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.sendStatus(400);
  const { data, error } = await adminSupabase.from('app_feedback').update({ status: req.body.status }).eq('id', req.params.id).select('id').maybeSingle();
  if (error) return next(new AppError(503, 'FEEDBACK_UNAVAILABLE', 'Chưa cập nhật được phản hồi.'));
  return data ? res.json({ success: true }) : res.sendStatus(404);
});
feedbackRouter.post('/admin/feedback/:id/remove-content', validateBody(z.object({}).strict()), async (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.sendStatus(400);
  const { error } = await adminSupabase.rpc('remove_reported_content', { p_feedback_id: req.params.id });
  if (error) return next(new AppError(503, 'MODERATION_UNAVAILABLE', 'Chưa gỡ được nội dung. Kiểm tra báo cáo rồi thử lại.'));
  return res.json({ success: true });
});
feedbackRouter.post('/feedback', requireAuth, rateLimit({ windowMs: 60 * 60_000, limit: 10, keyGenerator: (req) => req.auth!.user.id }), validateBody(z.object({
  category: z.enum(['support', 'ai_report', 'privacy', 'challenge_report']),
  message: z.string().trim().min(5).max(5000),
  context: z.string().max(5000).optional(),
  target_type: z.enum(['challenge', 'user']).optional(),
  target_id: z.string().uuid().optional(),
}).strict().refine((body) => Boolean(body.target_type) === Boolean(body.target_id))), async (req, res, next) => {
  const { data, error } = await adminSupabase.from('app_feedback').insert({ ...req.body, user_id: req.auth!.user.id }).select('id').single();
  if (error) return next(new AppError(503, 'FEEDBACK_UNAVAILABLE', 'Chưa gửi được phản hồi. Vui lòng thử lại sau.'));
  return res.status(201).json({ id: data.id });
});
