import crypto from 'node:crypto';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

type TelegramLinkTokenPayload = {
  userId: string;
  exp: number;
  nonce: string;
};

const getTelegramLinkSecret = () =>
  process.env.TELEGRAM_LINK_SECRET ||
  process.env.CRON_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const encodeBase64Url = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const decodeBase64Url = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

const signPayload = (payload: string) => {
  const secret = getTelegramLinkSecret();
  if (!secret) {
    throw new Error('Missing TELEGRAM_LINK_SECRET, CRON_SECRET, or SUPABASE_SERVICE_ROLE_KEY');
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
};

export const createTelegramLinkToken = (userId: string, ttlMs = DEFAULT_TTL_MS) => {
  const payload: TelegramLinkTokenPayload = {
    userId,
    exp: Date.now() + ttlMs,
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export const verifyTelegramLinkToken = (token: string): TelegramLinkTokenPayload | null => {
  const [encodedPayload, signature] = String(token || '').split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload);
  const providedSignature = Buffer.from(signature, 'utf8');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');
  if (
    providedSignature.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(providedSignature, expectedSignatureBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as TelegramLinkTokenPayload;
    if (!payload?.userId || !payload?.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};
