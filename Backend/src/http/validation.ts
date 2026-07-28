import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from './errors';

export const validateBody = <T>(schema: ZodType<T>): RequestHandler => (req, _res, next) => {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return next(new ValidationError());
  req.body = parsed.data;
  next();
};
