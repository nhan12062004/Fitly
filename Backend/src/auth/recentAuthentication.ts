import type { RequestHandler } from 'express';
import { AppError } from '../http/errors';

/** Call only after requireAuth has verified the complete access token. Token
 * refresh/iat are deliberately not accepted as proof of a fresh sign-in. */
export function hasRecentAuthentication(verifiedToken: string, now = Date.now()): boolean {
  try {
    const payload = JSON.parse(Buffer.from(verifiedToken.split('.')[1], 'base64url').toString('utf8'));
    const allowed = new Set(['password','oauth','otp','totp','webauthn','sso/saml']);
    return Array.isArray(payload.amr) && payload.amr.some((entry: any) =>
      allowed.has(entry?.method) && Number.isFinite(entry.timestamp)
      && entry.timestamp * 1000 <= now + 30_000 && now - entry.timestamp * 1000 <= 10 * 60_000);
  } catch { return false; }
}

export const requireRecentAuthentication: RequestHandler = (req, _res, next) => {
  if (!req.auth || !hasRecentAuthentication(req.auth.accessToken)) {
    return next(new AppError(403,'REAUTH_REQUIRED','Hãy đăng nhập lại trước khi thực hiện thao tác này.'));
  }
  return next();
};
