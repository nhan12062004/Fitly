export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly expose = true,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError { constructor(message = 'Invalid request') { super(400, 'VALIDATION_ERROR', message); } }
export class UnauthorizedError extends AppError { constructor() { super(401, 'UNAUTHORIZED', 'Unauthorized'); } }
export class ForbiddenError extends AppError { constructor() { super(403, 'FORBIDDEN', 'Forbidden'); } }
export class NotFoundError extends AppError { constructor(message = 'Not found') { super(404, 'NOT_FOUND', message); } }
export class ConflictError extends AppError { constructor(message = 'Conflict') { super(409, 'CONFLICT', message); } }
export class QuotaExceededError extends AppError { constructor(message = 'Quota exceeded') { super(429, 'QUOTA_EXCEEDED', message); } }
export class ExternalProviderError extends AppError { constructor() { super(502, 'EXTERNAL_PROVIDER_ERROR', 'A dependent service is unavailable', false); } }
