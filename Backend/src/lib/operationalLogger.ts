type OperationalLevel = 'info' | 'warn' | 'error';

type OperationalLog = {
  level: OperationalLevel;
  event: string;
  timestamp: string;
  message?: string;
  status?: string;
  errorCode?: string;
  requestId?: string;
  correlationId?: string;
  jobName?: string;
  durationMs?: number;
};

type OperationalLogInput = Omit<OperationalLog, 'timestamp' | 'message'> & { message?: unknown };

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /(?:supabase|service[_-]?role|api[_-]?key|token|jwt|password)\s*[=:]\s*[^\s,;]+/gi,
  /https?:\/\/[^\s]+/gi,
];

export const sanitizeOperationalMessage = (value: unknown): string => {
  // Free-text Error.message may contain a failing health row or provider echo.
  // Error codes and correlation IDs carry operational context without it.
  let message = String(value instanceof Error ? value.name : value || 'unknown_error');
  for (const pattern of SECRET_PATTERNS) message = message.replace(pattern, '[redacted]');
  return message.replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown_error';
};

export const logOperational = (entry: OperationalLogInput): void => {
  const { message, ...rest } = entry;
  const payload: OperationalLog = {
    ...rest,
    timestamp: new Date().toISOString(),
    ...(message ? { message: sanitizeOperationalMessage(message) } : {}),
  };
  const output = JSON.stringify(payload);
  if (entry.level === 'error') console.error(output);
  else if (entry.level === 'warn') console.warn(output);
  else console.log(output);
};
