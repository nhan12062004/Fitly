import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import '../auth/context';

const VALID_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const candidate = Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id'];
  req.requestId = candidate && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};
