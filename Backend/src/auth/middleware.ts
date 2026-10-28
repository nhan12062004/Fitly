import type { RequestHandler } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { adminSupabase, createUserScopedSupabaseClient, hasUserScopedSupabaseConfiguration } from '../config/Supabase';
import './context';

type AuthDependencies = {
  createUserScopedClient: (accessToken: string) => SupabaseClient;
  hasUserScopedConfiguration: () => boolean;
  verifyAccessToken: (accessToken: string) => Promise<{
    data: { user: User | null };
    error: { status?: number; code?: string; message?: string } | null;
  }>;
};

const extractBearerToken = (authorizationHeader: unknown): string | null => {
  const value = String(authorizationHeader || '').trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return value.slice('bearer '.length).trim() || null;
};

const sendUnauthorized = (res: Parameters<RequestHandler>[1]) =>
  res.status(401).json({ error: 'Unauthorized' });

const logAuthRejection = (reason: string, error?: { status?: number; code?: string; message?: string } | null) => {
  // Do not log the Authorization header or access token. These fields are
  // sufficient to distinguish a missing token from an invalid backend config.
  console.warn(JSON.stringify({
    level: 'warn',
    event: 'auth_rejected',
    reason,
    status: error?.status ?? null,
    code: error?.code ?? null,
  }));
};

export const createRequireAuth = (dependencies: AuthDependencies): RequestHandler => async (req, res, next) => {
  if (req.auth && req.supabase) return next();
  const accessToken = extractBearerToken(req.headers.authorization);
  if (!accessToken) {
    logAuthRejection('missing_bearer_token');
    return sendUnauthorized(res);
  }

  if (!dependencies.hasUserScopedConfiguration()) {
    logAuthRejection('missing_user_scoped_supabase_configuration');
    return res.status(503).json({ error: 'Authentication service is not configured.' });
  }

  try {
    // Supabase disallows auth.getUser() on a client created with the
    // accessToken option. Verify with the server client first, then use the
    // user-scoped client only for RLS-bound database requests.
    const { data, error } = await dependencies.verifyAccessToken(accessToken);
    if (error || !data.user) {
      logAuthRejection('supabase_rejected_access_token', error);
      return sendUnauthorized(res);
    }

    const userSupabase = dependencies.createUserScopedClient(accessToken);

    req.auth = { user: data.user, accessToken };
    req.supabase = userSupabase;
    return next();
  } catch (error: any) {
    logAuthRejection('supabase_auth_request_failed', error);
    return sendUnauthorized(res);
  }
};

export const requireAuth = createRequireAuth({
  createUserScopedClient: createUserScopedSupabaseClient,
  hasUserScopedConfiguration: hasUserScopedSupabaseConfiguration,
  verifyAccessToken: (accessToken) => adminSupabase.auth.getUser(accessToken),
});

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.auth) return sendUnauthorized(res);

  const role = String(req.auth.user.app_metadata?.role || '').trim().toLowerCase();
  if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const requireMfa = process.env.REQUIRE_ADMIN_MFA === 'true'
    || (process.env.NODE_ENV === 'production' && process.env.REQUIRE_ADMIN_MFA !== 'false');
  if (requireMfa) {
    try {
      const claims = JSON.parse(Buffer.from(req.auth.accessToken.split('.')[1],'base64url').toString('utf8'));
      if (claims.aal !== 'aal2') return res.status(403).json({ error:'Mở Quản trị viên → Bảo mật để xác minh hai bước trước khi tiếp tục.', code:'ADMIN_MFA_REQUIRED' });
    } catch { return res.status(403).json({ error:'Yêu cầu xác minh hai bước.',code:'ADMIN_MFA_REQUIRED' }); }
  }

  return next();
};
