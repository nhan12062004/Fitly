import crypto from 'node:crypto';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

type TelegramLinkTokenPayload = {
  userId: string;
  exp: number;
  nonce?: string;
};

const getTelegramLinkSecret = () =>
  process.env.TELEGRAM_LINK_SECRET ||
  process.env.CRON_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'fitly_telegram_link_secret_fallback_key';

export const createTelegramLinkToken = (userId: string, ttlMs = DEFAULT_TTL_MS): string => {
  const secret = getTelegramLinkSecret();
  const expSec = Math.floor((Date.now() + ttlMs) / 1000);

  const cleanHex = String(userId || '').replace(/-/g, '');
  let userBuf: Buffer;
  let isUuid = false;

  if (/^[0-9a-fA-F]{32}$/.test(cleanHex)) {
    userBuf = Buffer.from(cleanHex, 'hex');
    isUuid = true;
  } else {
    userBuf = Buffer.from(String(userId || ''), 'utf8');
  }

  const headerByte = (isUuid ? 0x80 : 0x00) | (userBuf.length & 0x7f);
  const headerBuf = Buffer.from([headerByte]);

  const expBuf = Buffer.alloc(4);
  expBuf.writeUInt32BE(expSec, 0);

  const payloadBuf = Buffer.concat([headerBuf, expBuf, userBuf]);

  const hmac = crypto.createHmac('sha256', secret).update(payloadBuf).digest();
  const sigBuf = hmac.subarray(0, 12);

  return Buffer.concat([payloadBuf, sigBuf]).toString('base64url');
};

export const verifyTelegramLinkToken = (token: string): TelegramLinkTokenPayload | null => {
  if (!token || typeof token !== 'string') return null;

  const cleanToken = token.trim();
  if (cleanToken.length === 0 || cleanToken.length > 64) return null;

  try {
    const rawBuf = Buffer.from(cleanToken, 'base64url');
    if (rawBuf.length < 18) return null;

    const sigBuf = rawBuf.subarray(rawBuf.length - 12);
    const payloadBuf = rawBuf.subarray(0, rawBuf.length - 12);

    const secret = getTelegramLinkSecret();
    const expectedHmac = crypto.createHmac('sha256', secret).update(payloadBuf).digest();
    const expectedSigBuf = expectedHmac.subarray(0, 12);

    if (
      sigBuf.length !== expectedSigBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedSigBuf)
    ) {
      return null;
    }

    const headerByte = payloadBuf[0];
    const isUuid = Boolean(headerByte & 0x80);
    const userLen = headerByte & 0x7f;

    const expSec = payloadBuf.readUInt32BE(1);
    const expMs = expSec * 1000;

    if (expMs < Date.now()) {
      return null;
    }

    const userBuf = payloadBuf.subarray(5, 5 + userLen);
    let userId: string;

    if (isUuid && userBuf.length === 16) {
      const hex = userBuf.toString('hex');
      userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    } else {
      userId = userBuf.toString('utf8');
    }

    if (!userId) return null;

    return {
      userId,
      exp: expMs,
      nonce: '',
    };
  } catch {
    return null;
  }
};
