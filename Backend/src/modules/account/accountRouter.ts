import express, { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRecentAuthentication } from '../../auth/recentAuthentication';
import { requireAuth } from '../../auth/middleware';
import { adminSupabase } from '../../config/Supabase';
import { ExternalProviderError, NotFoundError, UnauthorizedError, ValidationError } from '../../http/errors';
import { validateBody } from '../../http/validation';
import { performAccountDeletion } from '../../services/accountDeletionService';

const accountDeletionSchema = z.object({ confirmation: z.literal('DELETE') }).strict();
const SELF_SERVICE_PROFILE_COLUMNS = 'id, full_name, email, gender, birthday, avatar_url, membership_tier, membership_expires_at, exp, level, ref_code, referral_count, created_at, updated_at';
const SELF_SERVICE_PROFILE_FIELDS = [
  'full_name',
  'email',
  'gender',
  'birthday',
] as const;
const profileUpdateSchema = z.object({
  full_name: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  gender: z.enum(['Nam', 'Nữ', 'Khác']).nullable().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict().refine((body) => Object.keys(body).length > 0);
const AVATAR_CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

type AccountRouterDependencies = {
  serviceRoleClient?: SupabaseClient;
};

const getAuthenticatedContext = (req: express.Request) => {
  if (!req.auth || !req.supabase) throw new UnauthorizedError();
  return { userId: req.auth.user.id, supabase: req.supabase };
};

const getDirectChildPaths = (userId: string, items: Array<{ name?: string | null }>) =>
  items
    .filter((item) => item.name && !item.name.includes('/'))
    .map((item) => `${userId}/${item.name}`);

export const createAccountRouter = ({ serviceRoleClient = adminSupabase }: AccountRouterDependencies = {}) => {
  const router = Router();

  router.get('/profile', requireAuth, async (req, res, next) => {
    try {
      const { userId, supabase } = getAuthenticatedContext(req);
      const { data, error } = await supabase
        .from('profiles')
        .select(SELF_SERVICE_PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return next(new NotFoundError('Profile not found.'));
      return res.json({ data });
    } catch (error) {
      return next(error instanceof UnauthorizedError ? error : new ExternalProviderError());
    }
  });

  router.patch('/profile', requireAuth, validateBody(profileUpdateSchema), async (req, res, next) => {
    let context: ReturnType<typeof getAuthenticatedContext>;
    try {
      context = getAuthenticatedContext(req);
    } catch (error) {
      return next(error);
    }

    const updates: Record<string, string | boolean | null> = {};
    for (const field of SELF_SERVICE_PROFILE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        updates[field] = req.body[field] ?? null;
      }
    }
    if (Object.keys(updates).length === 0) return next(new ValidationError());

    try {
      const { data, error } = await context.supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', context.userId)
        .select(SELF_SERVICE_PROFILE_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!data) return next(new NotFoundError('Profile not found.'));
      return res.json({ data });
    } catch {
      return next(new ExternalProviderError());
    }
  });

  router.put('/profile/avatar', requireAuth, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: MAX_AVATAR_BYTES }), async (req, res, next) => {
    let context: ReturnType<typeof getAuthenticatedContext>;
    try {
      context = getAuthenticatedContext(req);
    } catch (error) {
      return next(error);
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';')[0];
    const extension = AVATAR_CONTENT_TYPES.get(contentType);
    if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > MAX_AVATAR_BYTES) {
      return res.status(400).json({ error: 'Avatar must be a JPEG, PNG, WebP, or GIF image no larger than 5 MB.' });
    }

    const avatarPath = `${context.userId}/avatar.${extension}`;
    try {
      const bucket = context.supabase.storage.from('avatars');
      const upload = await bucket.upload(avatarPath, req.body, { upsert: true, contentType });
      if (upload.error) throw upload.error;
      const { data: publicUrlData } = bucket.getPublicUrl(avatarPath);
      const avatarUrl = publicUrlData.publicUrl;
      const update = await context.supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq('id', context.userId);
      if (update.error) throw update.error;
      return res.json({ avatarUrl });
    } catch {
      return res.status(500).json({ error: 'Unable to update avatar.' });
    }
  });

  router.delete('/profile/avatar', requireAuth, async (req, res, next) => {
    let context: ReturnType<typeof getAuthenticatedContext>;
    try {
      context = getAuthenticatedContext(req);
    } catch (error) {
      return next(error);
    }

    try {
      const bucket = context.supabase.storage.from('avatars');
      const listed = await bucket.list(context.userId, { limit: 100 });
      if (listed.error) throw listed.error;
      const paths = getDirectChildPaths(context.userId, listed.data || []);
      if (paths.length > 0) {
        const removed = await bucket.remove(paths);
        if (removed.error) throw removed.error;
      }
      const update = await context.supabase
        .from('profiles')
        .update({ avatar_url: null, updated_at: new Date().toISOString() })
        .eq('id', context.userId);
      if (update.error) throw update.error;
      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: 'Unable to delete avatar.' });
    }
  });

  router.delete('/account', validateBody(accountDeletionSchema), requireAuth, requireRecentAuthentication, async (req, res, next) => {
    let userId: string;
    try {
      ({ userId } = getAuthenticatedContext(req));

      await performAccountDeletion(userId, serviceRoleClient);

      return res.json({ success: true });
    } catch (error) {
      return next(error instanceof UnauthorizedError ? error : new ExternalProviderError());
    }
  });

  return router;
};

export const accountRouter = createAccountRouter();
