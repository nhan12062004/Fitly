import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/http/errorHandler';
import { requestIdMiddleware } from '../src/http/requestId';

describe('global error handler', () => {
  it('returns a generic 500 with a request ID for unknown errors', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get('/unexpected', () => { throw new Error('provider token=https://secret.example'); });
    app.use(errorHandler);

    const response = await request(app).get('/unexpected');

    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(response.body)).not.toContain('secret.example');
  });
});
