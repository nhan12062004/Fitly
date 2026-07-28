import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserScopedSupabaseClient, hasUserScopedSupabaseConfiguration } from '../config/Supabase';
import './context';

type AuthDependencies = {
  createUserScopedClient: (accessToken: string) => SupabaseClient;
  hasUserScopedConfiguration: () => boolean;
};

const extractBearerToken = (authorizationHeader: unknown): string | null => {
  const value = String(authorizationHeader || '').trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return value.slice('bearer '.length).trim() || null;
};

const sendUnauthorized = (res: Parameters<RequestHandler>[1]) =>
  res.status(401).json({ error: 'Unauthorized' });

export const createRequireAuth = (dependencies: AuthDependencies): RequestHandler => async (req, res, next) => {
  const accessToken = extractBearerToken(req.headers.authorization);
  if (!accessToken) return sendUnauthorized(res);

  if (!dependencies.hasUserScopedConfiguration()) {
    return res.status(503).json({ error: 'Authentication service is not configured.' });
  }

  try {
    const userSupabase = dependencies.createUserScopedClient(accessToken);
    const { data, error } = await userSupabase.auth.getUser(accessToken);
    if (error || !data.user) return sendUnauthorized(res);

    req.auth = { user: data.user, accessToken };
    req.supabase = userSupabase;
    return next();
  } catch {
    return sendUnauthorized(res);
  }
};

export const requireAuth = createRequireAuth({
  createUserScopedClient: createUserScopedSupabaseClient,
  hasUserScopedConfiguration: hasUserScopedSupabaseConfiguration,
});

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.auth) return sendUnauthorized(res);

  const role = String(req.auth.user.app_metadata?.role || '').trim().toLowerCase();
  if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  return next();
};
