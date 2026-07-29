import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { InternalConfigurationError } from '../src/http/errors';
import { errorHandler } from '../src/http/errorHandler';
import { legacyErrorContractMiddleware } from '../src/http/legacyErrorContract';
import { requestIdMiddleware } from '../src/http/requestId';

const app = express();
app.use(requestIdMiddleware);
app.use(legacyErrorContractMiddleware);
app.get('/legacy/:status', (req, res) => {
  res.status(Number(req.params.status)).json({ error: 'provider token=https://secret.example' });
});
app.get('/legacy-config', (_req, res) => res.status(500).json({ error: 'Missing GROQ_API_KEY in server config' }));
app.get('/configuration-error', (_req, _res, next) => next(new InternalConfigurationError()));
app.use(errorHandler);

describe('legacy API error contract boundary', () => {
  it.each([
    [400, 'VALIDATION_ERROR', 'Invalid request'],
    [422, 'VALIDATION_ERROR', 'Invalid request'],
    [401, 'UNAUTHORIZED', 'Unauthorized'],
    [403, 'FORBIDDEN', 'Forbidden'],
    [404, 'NOT_FOUND', 'Not found'],
    [409, 'CONFLICT', 'Conflict'],
    [429, 'QUOTA_EXCEEDED', 'Request limit exceeded'],
    [502, 'EXTERNAL_PROVIDER_ERROR', 'A dependent service is unavailable'],
    [503, 'EXTERNAL_PROVIDER_ERROR', 'A dependent service is unavailable'],
    [500, 'INTERNAL_ERROR', 'Internal server error'],
  ])('normalizes legacy status %i into the public contract', async (status, code, message) => {
    const response = await request(app).get(`/legacy/${status}`);

    expect(response.status).toBe(status === 422 ? 400 : status);
    expect(response.body).toEqual({
      error: { code, message, requestId: response.headers['x-request-id'] },
    });
    expect(JSON.stringify(response.body)).not.toContain('secret.example');
  });

  it('uses the configuration-safe message without exposing missing environment details', async () => {
    const response = await request(app).get('/legacy-config');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_CONFIGURATION_ERROR',
        message: 'Service is temporarily unavailable',
        requestId: response.headers['x-request-id'],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('GROQ_API_KEY');
  });

  it('preserves the configuration-safe AppError contract from the central handler', async () => {
    const response = await request(app).get('/configuration-error');

    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({
      code: 'INTERNAL_CONFIGURATION_ERROR',
      message: 'Service is temporarily unavailable',
    });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });
});
