import express from 'express';
import { expect, it } from 'vitest';
import { legacyErrorContractMiddleware } from '../src/http/legacyErrorContract';

it('keeps the MFA requirement code when formatting a forbidden admin response', async () => {
  const app = express();
  app.use((req, _res, next) => { req.requestId = 'test-request'; next(); });
  app.use(legacyErrorContractMiddleware);
  app.get('/mfa', (_req, res) => res.status(403).json({ error: 'Xác minh hai bước để tiếp tục.', code: 'ADMIN_MFA_REQUIRED' }));
  app.get('/forbidden', (_req, res) => res.status(403).json({ error: 'Forbidden' }));

  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const mfaResponse = await fetch(`${baseUrl}/mfa`);
    expect(mfaResponse.status).toBe(403);
    expect(await mfaResponse.json()).toEqual({
      error: { code: 'ADMIN_MFA_REQUIRED', message: 'Xác minh hai bước để tiếp tục.', requestId: 'test-request' },
    });

    const forbiddenResponse = await fetch(`${baseUrl}/forbidden`);
    expect(await forbiddenResponse.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: 'test-request' },
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
