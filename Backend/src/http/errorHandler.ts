import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFoundError } from './errors';
import { reportException } from '../lib/observability';
import '../auth/context';

export const notFoundHandler: RequestHandler = (req, _res, next) => next(new NotFoundError('Route not found'));

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError = error instanceof AppError ? error : null;
  const status = appError?.status ?? 500;
  const code = appError?.code ?? 'INTERNAL_ERROR';
  const message = appError?.expose ? appError.publicMessage : 'Internal server error';
  if (status >= 500) reportException(error, { requestId: req.requestId, method: req.method, path: req.route?.path || 'unmatched', status, code, errorCode: code });
  res.status(status).json({ error: { code, message, requestId: req.requestId } });
};
